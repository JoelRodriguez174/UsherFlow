// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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
        { sector_id: 1, agotado: false, asignado: 0, capacidad: 20, disponibles: 18 },
        { sector_id: 2, agotado: true, asignado: 0, capacidad: 20, disponibles: 0 },
        { sector_id: 3, agotado: false, asignado: 4, capacidad: 20, disponibles: 14 },
      ],
    },
    {
      id: 's2',
      nombre: 'Domingo 17',
      inicio_at: '2026-11-01T13:00:00Z',
      sectores: [
        { sector_id: 1, agotado: false, asignado: 0, capacidad: 20, disponibles: 3 },
        { sector_id: 2, agotado: false, asignado: 0, capacidad: 20, disponibles: 12 },
        { sector_id: 3, agotado: true, asignado: 0, capacidad: 20, disponibles: 0 },
      ],
    },
  ],
};

let mapa: typeof MAPA;

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}
const sector = (nombre: RegExp) => screen.findByRole('button', { name: nombre });

beforeEach(() => {
  mapa = structuredClone(MAPA);
  llamarRpc.mockReset();
  llamarRpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'obtener_mapa_sede') return mapa;
    if (nombre === 'guardar_reservas_sede') return { success: true };
    return { success: true };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SedePanel', () => {
  it('pide el mapa con la clave y muestra la sede, la fecha límite y los disponibles por sector', async () => {
    render(<SedePanel clave="SEDE1" />);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Moreno');
    expect(llamarRpc).toHaveBeenCalledWith('obtener_mapa_sede', { p_clave: 'SEDE1' });
    expect(screen.getByText(/Podés reservar o cambiar tus lugares hasta el .*18:00/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Mapa del salón' })).toBeTruthy();
    expect((await sector(/Centro A/)).textContent).toContain('18 libres');
    expect(screen.getByRole('button', { name: /Centro B/ }).textContent).toContain('Agotado');
    expect(screen.getByRole('button', { name: /Izquierda A/ }).textContent).toContain('4 lugares');
  });

  it('tocar un sector abre el editor, aplica al borrador y confirmar guarda la sesión en guardar_reservas_sede', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);

    await user.click(await sector(/Centro A/));
    const dialogo = screen.getByRole('dialog', { name: 'Centro A' });
    const input = within(dialogo).getByLabelText('Cantidad de lugares') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '6');
    await user.click(within(dialogo).getByRole('button', { name: 'Aplicar 6 lugares' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('6 lugares');
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('sin confirmar');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(llamadas('guardar_reservas_sede')).toEqual([
      [
        'guardar_reservas_sede',
        {
          p_clave: 'SEDE1',
          p_filas: [
            { seccion: 'centro', sesion: 'Domingo 10', cantidad: 6, sector: 'Centro A' },
            { seccion: 'izquierda', sesion: 'Domingo 10', cantidad: 4, sector: 'Izquierda A' },
          ],
          p_sesiones: ['Domingo 10'],
        },
      ],
    ]);
    expect(await screen.findByText('Reservas de Domingo 10 guardadas.')).toBeTruthy();
  });

  it('permite quitar una reserva existente desde el editor y guardar solo lo que queda', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);

    await user.click(await sector(/Izquierda A/));
    const dialogo = screen.getByRole('dialog', { name: 'Izquierda A' });
    await user.click(within(dialogo).getByRole('button', { name: 'Quitar reserva' }));

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(llamadas('guardar_reservas_sede')).toEqual([
      ['guardar_reservas_sede', { p_clave: 'SEDE1', p_filas: [], p_sesiones: ['Domingo 10'] }],
    ]);
  });

  it('si el servidor rechaza por RESERVAS_INVALIDAS avisa el motivo, refresca y conserva el borrador', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return mapa;
      return {
        success: false,
        error: 'RESERVAS_INVALIDAS',
        errores: [{ fila: 1, motivo: 'Excede la capacidad del sector Centro A en Domingo 10: 21 > 20' }],
      };
    });

    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    const dialogo = screen.getByRole('dialog', { name: 'Centro A' });
    await user.click(within(dialogo).getByRole('button', { name: 'Aplicar 1 lugar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Fila 1: Excede la capacidad del sector Centro A en Domingo 10: 21 > 20',
    );
    expect(llamadas('obtener_mapa_sede')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('1 lugar');
  });

  it('avisa antes de cambiar de sesión si hay cambios sin confirmar y permite descartarlos', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);

    await user.click(await sector(/Centro A/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aplicar 1 lugar' }));

    await user.click(screen.getByRole('button', { name: 'Domingo 17' }));
    expect(screen.getByText('Tenés cambios sin confirmar en Domingo 10.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Descartar y cambiar' }));
    expect(screen.getByRole('button', { name: 'Domingo 17' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('Quedan 3');
    expect(screen.getByRole('button', { name: /Centro B/ }).textContent).toContain('12 libres');
  });

  it('con abierto:false muestra Cerrado y no abre el editor al tocar un sector', async () => {
    const user = userEvent.setup();
    mapa = { ...MAPA, abierto: false };
    render(<SedePanel clave="SEDE1" />);

    expect(await screen.findByText('Cerrado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Centro A/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('FECHA_LIMITE_VENCIDA pasa a Cerrado y refresca el mapa', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_sede') return mapa;
      mapa = { ...MAPA, abierto: false };
      return { success: false, error: 'FECHA_LIMITE_VENCIDA' };
    });

    render(<SedePanel clave="SEDE1" />);
    await user.click(await sector(/Centro A/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aplicar 1 lugar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Cerrado')).toBeTruthy();
    expect(llamadas('obtener_mapa_sede')).toHaveLength(2);
  });

  it('sin sectores muestra el mensaje vacío', async () => {
    mapa = { ...MAPA, sectores: [], sesiones: [] };
    render(<SedePanel clave="SEDE1" />);
    expect(await screen.findByText(/todavía no definió los sectores/)).toBeTruthy();
  });

  it('CLAVE_INVALIDA muestra la pantalla de clave inválida', async () => {
    llamarRpc.mockRejectedValue(new ClaveInvalidaError());
    render(<SedePanel clave="VIEJA" />);
    expect(await screen.findByRole('heading', { name: 'Pedí un QR nuevo' })).toBeTruthy();
  });

  it('si falla el polling con mapa ya cargado avisa discretamente sin perder el mapa', async () => {
    vi.useFakeTimers();
    let veces = 0;
    llamarRpc.mockImplementation(async () => {
      veces += 1;
      if (veces === 1) return mapa;
      throw new Error('sin red');
    });

    render(<SedePanel clave="SEDE1" />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: /Centro A/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText(/No pudimos actualizar la disponibilidad/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Centro A/ })).toBeTruthy();
  });

  it('sincroniza el relleno del mapa en vivo al sumar/restar en el editor y revierte al cancelar', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);

    await user.click(await sector(/Centro A/));
    const dialogo = screen.getByRole('dialog', { name: 'Centro A' });
    await user.click(within(dialogo).getByRole('button', { name: 'Sumar 1 lugar' }));
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('2 lugares');

    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('18 libres');
  });

  it('permite copiar la distribución actual a otra sesión acotando al lugar disponible', async () => {
    const user = userEvent.setup();
    render(<SedePanel clave="SEDE1" />);

    await user.click(await sector(/Centro A/));
    const dialogo = screen.getByRole('dialog', { name: 'Centro A' });
    const input = within(dialogo).getByLabelText('Cantidad de lugares') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '5');
    await user.click(within(dialogo).getByRole('button', { name: 'Aplicar 5 lugares' }));

    await user.click(screen.getByRole('button', { name: /Ver detalle/ }));
    await user.click(screen.getByRole('button', { name: 'Copiar a Domingo 17' }));

    expect(screen.getByRole('button', { name: /Domingo 17/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Copiamos tu distribución a Domingo 17/)).toBeTruthy();
    // Centro A en Domingo 17 tiene solo 3 disponibles, así que 5 se acota a 3
    expect(screen.getByRole('button', { name: /Centro A/ }).textContent).toContain('3 lugares');
  });
});
