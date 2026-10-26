// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ReactNode } from 'react';

const llamarRpc = vi.fn();
const leerAcceso = vi.fn();
const montajes = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));
vi.mock('@/lib/acceso', () => ({ leerAcceso: () => leerAcceso() }));
vi.mock('@/state/SalonProvider', () => ({
  SalonProvider: ({ children }: { children: ReactNode }) => {
    useEffect(() => montajes(), []);
    return <>{children}</>;
  },
  useSalon: () => ({ filas: {}, claveInvalida: false, cargando: false, conexion: 'connected', error: null, limpiarError: vi.fn() }),
}));

import { ClaveInvalidaError } from '@/lib/rpc';
import { SupervisorShell, useSupervisor } from './SupervisorShell';
import { usePreparacion } from './usePreparacion';

const CLAVES = { success: true, clave_ujier: 'UJIER1', clave_supervisor: 'SUPER1' };
const MAPA = { success: true, fecha_limite: null, sectores: [], sedes: [], sesiones: [] };
const RESERVAS = { success: true, liberacion_min: 10, sectores: [], sesiones: [] };

function responder(overrides: Record<string, unknown> = {}) {
  llamarRpc.mockImplementation(async (rpc: string) => {
    const r = { obtener_claves: CLAVES, obtener_mapa_supervisor: MAPA, obtener_reservas: RESERVAS, ...overrides }[rpc];
    if (r instanceof Error) throw r;
    return r;
  });
}
const veces = (rpc: string) => llamarRpc.mock.calls.filter((c) => c[0] === rpc).length;

function Sonda() {
  const { claves, origen, renovar } = useSupervisor();
  const { estado, pasos, recargar } = usePreparacion();
  const [n, setN] = useState(0);
  return (
    <div>
      <p data-testid="claves">{`${claves.claveUjier}/${claves.claveSupervisor}`}</p>
      <p data-testid="origen">{origen}</p>
      <p data-testid="estado">{estado}</p>
      <p data-testid="pasos">{pasos.length}</p>
      <p data-testid="completos">{pasos.filter((p) => p.completo).length}</p>
      <p data-testid="n">{n}</p>
      <button onClick={() => setN(n + 1)}>sumar</button>
      <button onClick={recargar}>recargar</button>
      <button onClick={() => renovar({ claveUjier: 'UJIER2', claveSupervisor: 'SUPER2' })}>renovar</button>
    </div>
  );
}

const montar = () =>
  render(
    <SupervisorShell>
      <Sonda />
    </SupervisorShell>,
  );

beforeEach(() => {
  leerAcceso.mockReturnValue({ clave: 'SUPER0' });
});
afterEach(() => {
  cleanup();
  llamarRpc.mockReset();
  montajes.mockReset();
});

describe('SupervisorShell', () => {
  it('pide claves, luego mapa y reservas con la clave de supervisor, y entrega 6 pasos', async () => {
    responder();
    montar();
    expect(screen.getByText('Preparando…')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('listo'));
    expect(llamarRpc.mock.calls[0]).toEqual(['obtener_claves', { p_clave: 'SUPER0' }]);
    expect(llamarRpc).toHaveBeenCalledWith('obtener_mapa_supervisor', { p_clave: 'SUPER1' });
    expect(llamarRpc).toHaveBeenCalledWith('obtener_reservas', { p_clave: 'SUPER1' });
    expect(screen.getByTestId('pasos').textContent).toBe('6');
    expect(screen.getByTestId('claves').textContent).toBe('UJIER1/SUPER1');
    expect(screen.getByTestId('origen').textContent).toBe(window.location.origin);
  });

  it.each([
    ['el mapa devuelve success:false', { obtener_mapa_supervisor: { success: false, error: 'X' } }],
    ['las reservas fallan por red', { obtener_reservas: new Error('red') }],
    ['el mapa falla por clave inválida', { obtener_mapa_supervisor: new ClaveInvalidaError() }],
  ])('si %s: estado error y ningún paso completo', async (_n, fallo) => {
    responder(fallo);
    montar();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('error'));
    expect(screen.getByTestId('pasos').textContent).toBe('6');
    expect(screen.getByTestId('completos').textContent).toBe('0');
  });

  it('recargar vuelve a pedir mapa y reservas, sin tocar lo que ya se ve', async () => {
    responder();
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('listo'));
    await user.click(screen.getByText('sumar'));
    await user.click(screen.getByText('recargar'));
    await waitFor(() => expect(veces('obtener_mapa_supervisor')).toBe(2));
    expect(veces('obtener_reservas')).toBe(2);
    expect(veces('obtener_claves')).toBe(1);
    expect(screen.getByTestId('n').textContent).toBe('1');
    expect(screen.getByTestId('estado').textContent).toBe('listo');
  });

  it('si tras cargar bien una recarga falla pasa a error y ningún paso queda completo', async () => {
    responder({ obtener_reservas: { ...RESERVAS, sesiones: [{ id: 's1', nombre: 'Jueves', inicio_at: '2099-01-01T00:00:00Z', reservas: [] }] } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('listo'));
    expect(screen.getByTestId('completos').textContent).toBe('1'); // Sesiones
    responder({ obtener_reservas: new Error('red') });
    await user.click(screen.getByText('recargar'));
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('error'));
    expect(screen.getByTestId('completos').textContent).toBe('0');
  });

  it('recargar tras un error vuelve a listo', async () => {
    responder({ obtener_reservas: new Error('red') });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('error'));
    responder();
    await user.click(screen.getByText('recargar'));
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('listo'));
  });

  it('renovar cambia las claves, remonta el provider y vuelve a pedir el estado con la clave nueva', async () => {
    responder();
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('listo'));
    await user.click(screen.getByText('sumar'));
    expect(montajes).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('renovar'));
    await waitFor(() => expect(screen.getByTestId('claves').textContent).toBe('UJIER2/SUPER2'));
    expect(montajes).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('n').textContent).toBe('0'); // los hijos se remontaron
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('obtener_reservas', { p_clave: 'SUPER2' }));
  });

  it('si obtener_claves falla muestra el error con "Probar de nuevo" y no renderiza los hijos', async () => {
    responder({ obtener_claves: new Error('red') });
    const user = userEvent.setup();
    montar();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('claves')).toBeNull();
    responder();
    await user.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    await waitFor(() => expect(screen.getByTestId('claves')).toBeTruthy());
  });

  it('un error del servidor en obtener_claves se muestra traducido', async () => {
    responder({ obtener_claves: { success: false, error: 'CLAVE_INVALIDA' } });
    montar();
    expect((await screen.findByRole('alert')).textContent).toContain('msg:CLAVE_INVALIDA');
    expect(screen.queryByTestId('claves')).toBeNull();
  });

  it('sin acceso guardado no llama a la red ni renderiza los hijos', () => {
    leerAcceso.mockReturnValue(null);
    responder();
    montar();
    expect(llamarRpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId('claves')).toBeNull();
  });

  it('con clave inválida muestra la pantalla de clave inválida', async () => {
    responder({ obtener_claves: new ClaveInvalidaError() });
    montar();
    expect(await screen.findByRole('heading', { name: /QR nuevo/i })).toBeTruthy();
    expect(screen.queryByTestId('claves')).toBeNull();
  });
});
