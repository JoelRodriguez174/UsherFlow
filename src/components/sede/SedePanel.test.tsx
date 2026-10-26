// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { ClaveInvalidaError } from '@/lib/rpc';
import { SedePanel } from './SedePanel';

const MAPA = {
  success: true,
  sede: { id: 'sd1', nombre: 'Moreno' },
  fecha_limite: '2026-10-30T21:00:00Z',
  abierto: true,
  sectores: [
    { id: 1, seccion: 'centro', nombre: 'Centro A', fila_desde: 1, fila_hasta: 5 },
    { id: 2, seccion: 'centro', nombre: 'Centro B', fila_desde: 6, fila_hasta: 10 },
    { id: 3, seccion: 'izquierda', nombre: 'Izquierda A', fila_desde: 1, fila_hasta: 10 },
  ],
  preferencias: [] as number[],
  sesiones: [
    {
      id: 's1',
      nombre: 'Domingo 10',
      inicio_at: '2026-10-25T13:00:00Z',
      sectores: [
        { sector_id: 2, agotado: true, asignado: 0 },
        { sector_id: 3, agotado: false, asignado: 4 },
      ],
    },
    {
      id: 's2',
      nombre: 'Domingo 17',
      inicio_at: '2026-11-01T13:00:00Z',
      sectores: [
        { sector_id: 2, agotado: false, asignado: 0 },
        { sector_id: 3, agotado: true, asignado: 0 },
      ],
    },
  ],
};

let mapa: Record<string, unknown>;

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}
const sector = (nombre: RegExp) => screen.findByRole('button', { name: nombre });

beforeEach(() => {
  mapa = MAPA;
  llamarRpc.mockReset();
  llamarRpc.mockImplementation(async (nombre: string, params: { p_sectores?: number[] }) => {
    if (nombre === 'obtener_mapa_sede') return mapa;
    mapa = { ...mapa, preferencias: params.p_sectores ?? [] }; // como el servidor: lo guardado vuelve en el siguiente mapa
    return { success: true };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SedePanel', () => {
  it('pide el mapa con la clave y muestra la sede, la fecha límite y el mapa bajo un h2', async () => {
    render(<SedePanel clave="SEDE1" />);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Moreno');
    expect(llamarRpc).toHaveBeenCalledWith('obtener_mapa_sede', { p_clave: 'SEDE1' });
    expect(screen.getByText(/Podés cambiar tu preferencia hasta el .*18:00/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    expect(await sector(/Centro A/)).toBeTruthy();
  });

  it('clic en un sector guarda la lista nueva y lo marca como preferido', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    expect(llamadas('guardar_preferencias')).toEqual([['guardar_preferencias', { p_clave: 'SEDE1', p_sectores: [1] }]]);
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: /Centro A/ }));
    expect(llamadas('guardar_preferencias')[1][1]).toEqual({ p_clave: 'SEDE1', p_sectores: [] });
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('si el guardado falla revierte y avisa', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return mapa;
      return { success: false, error: 'SECTOR_INVALIDO' };
    });
    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    expect((await screen.findByRole('alert')).textContent).toContain('msg:SECTOR_INVALIDO');
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('si falla la red revierte y avisa', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return mapa;
      throw new Error('red');
    });
    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    expect((await screen.findByRole('alert')).textContent).toContain('msg:ERROR_DE_RED');
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('FECHA_LIMITE_VENCIDA revierte, refresca y muestra Cerrado', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return mapa;
      mapa = { ...MAPA, abierto: false };
      return { success: false, error: 'FECHA_LIMITE_VENCIDA' };
    });
    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    expect(await screen.findByText('Cerrado')).toBeTruthy();
    expect(llamadas('obtener_mapa_sede')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('con abierto:false muestra Cerrado y no guarda al tocar un sector', async () => {
    const user = userEvent.setup();
    mapa = { ...MAPA, abierto: false };
    render(<SedePanel clave="SEDE1" />);
    expect(await screen.findByText('Cerrado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Centro A/ }));
    expect(llamadas('guardar_preferencias')).toHaveLength(0);
  });

  it('sin sectores muestra el mensaje vacío', async () => {
    mapa = { ...MAPA, sectores: [], sesiones: [] };
    render(<SedePanel clave="SEDE1" />);
    expect(await screen.findByText(/todavía no definió los sectores/)).toBeTruthy();
  });

  it('cambiar de sesión actualiza agotado y asignado', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);
    const centroB = await sector(/Centro B/);
    expect(centroB.textContent).toContain('Agotado');
    const izquierda = screen.getByRole('button', { name: /Izquierda A/ });
    expect(izquierda.textContent).toContain('Tenés 4 lugares');
    expect(izquierda.textContent).toContain('Asignado');

    await user.click(screen.getByRole('button', { name: 'Domingo 17' }));
    expect(screen.getByRole('button', { name: /Centro B/ }).textContent).toContain('Disponible');
    expect(screen.getByRole('button', { name: /Izquierda A/ }).textContent).toContain('Agotado');
    expect(screen.getByRole('button', { name: 'Domingo 17' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('sin ninguna asignación en ninguna sesión avisa "Todavía no te asignaron lugares." y deja el mapa; con alguna no lo dice', async () => {
    mapa = { ...MAPA, sesiones: MAPA.sesiones.map((s) => ({ ...s, sectores: s.sectores.map((x) => ({ ...x, asignado: 0 })) })) };
    const { unmount } = render(<SedePanel clave="SEDE1" />);
    expect(await screen.findByText('Todavía no te asignaron lugares.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Centro A/ })).toBeTruthy();
    unmount();
    mapa = MAPA;
    render(<SedePanel clave="SEDE1" />);
    await sector(/Centro A/);
    expect(screen.queryByText('Todavía no te asignaron lugares.')).toBeNull();
  });

  it('CLAVE_INVALIDA muestra la pantalla de clave inválida', async () => {
    llamarRpc.mockRejectedValue(new ClaveInvalidaError());
    render(<SedePanel clave="VIEJA" />);
    expect(await screen.findByRole('heading', { name: 'Pedí un QR nuevo' })).toBeTruthy();
    expect(screen.getByText(/Abrí de nuevo el enlace/)).toBeTruthy();
  });

  it('un sondeo que responde con un guardado pendiente no revierte la marca y el toque siguiente manda la lista completa', async () => {
    vi.useFakeTimers();
    let confirmar!: (r: { success: true }) => void;
    llamarRpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return Promise.resolve(mapa); // el servidor aún no vio el guardado
      return new Promise((resolver) => {
        confirmar = resolver;
      });
    });
    render(<SedePanel clave="SEDE1" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Centro A/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000); // sondeo con preferencias viejas mientras el guardado sigue pendiente
    });
    expect(llamadas('obtener_mapa_sede').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('true');

    mapa = { ...MAPA, preferencias: [1] };
    await act(async () => {
      confirmar({ success: true });
    });
    expect(screen.getByRole('button', { name: /Centro A/ }).getAttribute('aria-pressed')).toBe('true');

    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_sede' ? mapa : { success: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Domingo 17' })); // Centro B está agotado en la primera sesión
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Centro B/ }));
    });
    expect(llamadas('guardar_preferencias')[1][1]).toEqual({ p_clave: 'SEDE1', p_sectores: [1, 2] });
  });

  it('vuelve a pedir el mapa cada 30 s y deja de hacerlo al desmontar', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SedePanel clave="SEDE1" />);
    await act(async () => {});
    expect(llamadas('obtener_mapa_sede')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(llamadas('obtener_mapa_sede')).toHaveLength(2);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas('obtener_mapa_sede')).toHaveLength(2);
  });
});
