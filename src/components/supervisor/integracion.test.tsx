// @vitest-environment jsdom
// Integración: el SupervisorShell REAL con pasos reales; solo se simulan la red (`llamarRpc`) y el SalonProvider.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));
vi.mock('@/state/SalonProvider', () => ({
  SalonProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSalon: () => ({ filas: {}, claveInvalida: false, cargando: false, conexion: 'connected', error: null, limpiarError: vi.fn() }),
}));

import { guardarAcceso, leerAcceso } from '@/lib/acceso';
import { ARMADO_MS } from './useArmado';
import { QrPaso } from './pasos/QrPaso';
import { SalonPaso } from './pasos/SalonPaso';
import { SesionesPaso } from './pasos/SesionesPaso';
import { SupervisorShell } from './SupervisorShell';

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

const montar = (paso: ReactNode) => render(<SupervisorShell>{paso}</SupervisorShell>);
const origen = () => window.location.origin;

beforeEach(() => {
  sessionStorage.clear();
  guardarAcceso('SUPER0', 'supervisor');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  llamarRpc.mockReset();
});

describe('Supervisor: integración Shell + pasos', () => {
  it('con el servidor vacío, Sesiones pide completar Salón y no muestra el formulario', async () => {
    responder();
    montar(<SesionesPaso />);
    expect(await screen.findByText('Completá Salón primero')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a Salón' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /guardar/i })).toBeNull();
  });

  it.each([
    ['obtener_mapa_supervisor responde success:false', { obtener_mapa_supervisor: { success: false, error: 'X' } }],
    ['obtener_reservas falla por red', { obtener_reservas: new Error('red') }],
  ])('si %s, Salón y Sesiones dicen que no pudieron revisar y nunca "Listo"', async (_n, fallo) => {
    responder(fallo);
    for (const Paso of [SalonPaso, SesionesPaso]) {
      const { unmount } = montar(<Paso />);
      expect(await screen.findByText('No pudimos revisar el estado')).toBeTruthy();
      expect(screen.queryByText('Listo')).toBeNull();
      expect(screen.queryByText('Todo listo')).toBeNull();
      unmount();
    }
  });

  it('si falla la carga, QR sigue mostrando los enlaces y "Renovar claves"', async () => {
    responder({ obtener_reservas: new Error('red') });
    montar(<QrPaso />);
    expect(await screen.findByText('No pudimos revisar el estado')).toBeTruthy();
    expect(screen.getByText(`${origen()}/entrar?k=UJIER1&rol=puerta`)).toBeTruthy();
    expect(screen.getByText(`${origen()}/entrar?k=SUPER1&rol=supervisor`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Renovar claves' })).toBeTruthy();
  });

  it('renovar claves desde QR remonta el provider con las claves nuevas y avisa una sola vez', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder({ regenerar_claves: { success: true, clave_ujier: 'UJIER2', clave_supervisor: 'SUPER2' } });
    montar(<QrPaso />);

    await user.click(await screen.findByRole('button', { name: 'Renovar claves' }));
    act(() => {
      vi.advanceTimersByTime(ARMADO_MS);
    });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));

    expect(await screen.findByText(`${origen()}/entrar?k=UJIER2&rol=puerta`)).toBeTruthy();
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('obtener_reservas', { p_clave: 'SUPER2' }));
    expect(screen.getAllByText(/claves renovadas/i)).toHaveLength(1);
    expect(screen.queryByText(`${origen()}/entrar?k=UJIER1&rol=puerta`)).toBeNull();
    expect(leerAcceso()).toEqual({ clave: 'SUPER2', rol: 'supervisor' });
    expect(sessionStorage.getItem('usherflow:claves-renovadas')).toBeNull(); // la bandera se consumió
  });
});
