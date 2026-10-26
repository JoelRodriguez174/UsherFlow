// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { MapaSupervisor } from './MapaSupervisor';

const MAPA = {
  success: true,
  fecha_limite: null,
  sectores: [
    { id: 1, seccion: 'centro', nombre: 'adelante', fila_desde: 1, fila_hasta: 5, capacidad: 60 },
    { id: 2, seccion: 'centro', nombre: 'atrás', fila_desde: 6, fila_hasta: 10, capacidad: 50 },
    { id: 3, seccion: 'izquierda', nombre: 'único', fila_desde: 1, fila_hasta: 10, capacidad: 30 },
  ],
  sedes: [
    { sede_id: 'a', nombre: 'Norte', clave_acceso: null, preferencias: [1, 3] },
    { sede_id: 'b', nombre: 'Sur', clave_acceso: 'K', preferencias: [1] },
  ],
  sesiones: [
    { id: 's1', nombre: 'Domingo 10', inicio_at: '2026-10-25T13:00:00Z', asignado: [{ sector_id: 1, sede_id: 'a', cantidad: 40 }] },
    { id: 's2', nombre: 'Domingo 18', inicio_at: '2026-10-25T21:00:00Z', asignado: [] },
  ],
};

beforeEach(() => {
  llamarRpc.mockReset();
  llamarRpc.mockResolvedValue(MAPA);
});
afterEach(cleanup);

const sector = (nombre: RegExp) =>
  screen.getAllByRole('button').find((b) => nombre.test(b.textContent ?? '') && b.textContent?.includes('filas')) as HTMLElement;

describe('MapaSupervisor', () => {
  it('marca asignado, preferido y disponible y lista qué sedes piden cada sector', async () => {
    render(<MapaSupervisor clave="SUPER1" />);
    expect(await screen.findByText('Piden: Norte, Sur · Asignado: 40/60')).toBeTruthy();
    expect(llamarRpc).toHaveBeenCalledWith('obtener_mapa_supervisor', { p_clave: 'SUPER1' });
    expect(sector(/adelante/).textContent).toContain('Asignado');
    const unico = sector(/único/);
    expect(unico.textContent).toContain('Piden: Norte · Asignado: 0/30');
    expect(unico.textContent).toContain('Pedido por alguna sede');
    const atras = sector(/atrás/);
    expect(atras.textContent).toContain('Sin pedidos · Asignado: 0/50');
    expect(atras.textContent).toContain('Disponible');
  });

  it('cambiar de sesión cambia el asignado', async () => {
    const user = userEvent.setup();
    render(<MapaSupervisor clave="SUPER1" />);
    await screen.findByText('Piden: Norte, Sur · Asignado: 40/60');
    expect(screen.getByRole('button', { name: 'Domingo 10', pressed: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Domingo 18' }));
    expect(await screen.findByText('Piden: Norte, Sur · Asignado: 0/60')).toBeTruthy();
    expect(sector(/adelante/).textContent).toContain('Pedido por alguna sede');
  });

  it('sin sectores avisa que falta definirlos', async () => {
    llamarRpc.mockResolvedValue({ ...MAPA, sectores: [] });
    render(<MapaSupervisor clave="SUPER1" />);
    expect(await screen.findByText(/Todavía no definiste sectores/)).toBeTruthy();
  });
});
