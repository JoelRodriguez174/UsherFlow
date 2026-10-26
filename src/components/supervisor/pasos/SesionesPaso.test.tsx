// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASOS } from '@/domain/preparacion';

const llamarRpc = vi.fn();
const usePreparacion = vi.fn();
const recargar = vi.fn();

vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));
vi.mock('@/components/supervisor/SupervisorShell', () => ({
  useSupervisor: () => ({ claves: { claveUjier: 'UJIER1', claveSupervisor: 'SUPER1' }, origen: 'https://usherflow.test', renovar: vi.fn() }),
}));
vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { SesionesPaso } from './SesionesPaso';

const OBTENER = {
  success: true,
  liberacion_min: 20,
  sesiones: [{ id: 's1', nombre: 'Domingo 10', inicio_at: '2026-10-25T13:00:00Z', reservas: [] }],
};

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}

function pasosCon(sesionesCompleto: boolean) {
  return PASOS.map((p) => ({
    ...p,
    completo: p.id === 'sesiones' ? sesionesCompleto : true,
    bloqueado: false,
    resumen: '',
    requisitos: p.id === 'sesiones' ? [{ texto: 'Al menos una sesión', ok: sesionesCompleto }] : [],
    avisos: [],
  }));
}

beforeEach(() => {
  llamarRpc.mockReset();
  recargar.mockReset();
  llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_reservas' ? OBTENER : { success: true }));
  usePreparacion.mockReturnValue({ estado: 'listo', pasos: pasosCon(true), recargar });
});
afterEach(cleanup);

describe('SesionesPaso', () => {
  // Copiados (adaptados) de ReservasPanel.test.tsx
  it('muestra la sesión en hora de Argentina y la liberación', async () => {
    render(<SesionesPaso />);
    expect(await screen.findByText(/Domingo 10 · .*10:00/)).toBeTruthy();
    expect((screen.getByLabelText('Minutos de liberación') as HTMLInputElement).value).toBe('20');
  });

  it('guarda una sesión nueva con la hora de Argentina (-03:00)', async () => {
    const user = userEvent.setup();
    render(<SesionesPaso />);
    await user.type(await screen.findByLabelText('Nombre de la sesión'), 'Domingo 18');
    await user.type(screen.getByLabelText('Inicio'), '2026-10-25T18:30');
    await user.click(screen.getByRole('button', { name: 'Guardar sesión' }));
    await waitFor(() => expect(llamadas('guardar_sesion')).toHaveLength(1));
    expect(llamadas('guardar_sesion')[0][1]).toEqual({
      p_clave: 'SUPER1',
      p_nombre: 'Domingo 18',
      p_inicio_at: '2026-10-25T18:30:00-03:00',
    });
  });

  it('borrar una sesión pide confirmación', async () => {
    const user = userEvent.setup();
    render(<SesionesPaso />);
    await user.click(await screen.findByRole('button', { name: 'Borrar Domingo 10' }));
    expect(llamadas('borrar_sesion')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, borrar' }));
    await waitFor(() => expect(llamadas('borrar_sesion')).toHaveLength(1));
    expect(llamadas('borrar_sesion')[0][1]).toEqual({ p_clave: 'SUPER1', p_sesion_id: 's1' });
  });

  // Nuevos
  it('guarda la liberación', async () => {
    const user = userEvent.setup();
    render(<SesionesPaso />);
    const campo = await screen.findByLabelText('Minutos de liberación');
    await user.clear(campo);
    await user.type(campo, '30');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(llamadas('guardar_liberacion')).toHaveLength(1));
    expect(llamadas('guardar_liberacion')[0][1]).toEqual({ p_clave: 'SUPER1', p_minutos: 30 });
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
  });

  it('tras guardar o borrar una sesión se recarga el estado de preparación; si el servidor rechaza, no', async () => {
    const user = userEvent.setup();
    render(<SesionesPaso />);
    await user.type(await screen.findByLabelText('Nombre de la sesión'), 'Domingo 18');
    await user.type(screen.getByLabelText('Inicio'), '2026-10-25T18:30');
    await user.click(screen.getByRole('button', { name: 'Guardar sesión' }));
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Borrar Domingo 10' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, borrar' }));
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(2));
    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_reservas' ? OBTENER : { success: false, error: 'X' }));
    await user.click(screen.getByRole('button', { name: 'Borrar Domingo 10' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, borrar' }));
    await screen.findByText('msg:X');
    expect(recargar).toHaveBeenCalledTimes(2);
  });

  it('"Siguiente: Sedes" está habilitado con al menos una sesión y deshabilitado sin ninguna', () => {
    const { unmount } = render(<SesionesPaso />);
    expect(screen.getByRole('link', { name: 'Siguiente: Sedes' }).getAttribute('href')).toBe('/supervisor/sedes');
    unmount();
    usePreparacion.mockReturnValue({ estado: 'listo', pasos: pasosCon(false), recargar });
    render(<SesionesPaso />);
    expect((screen.getByRole('button', { name: 'Siguiente: Sedes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
