// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { SectoresPanel } from './SectoresPanel';

const MAPA = {
  success: true,
  fecha_limite: '2026-11-01T21:30:00Z',
  sectores: [{ id: 1, seccion: 'centro', nombre: 'único', fila_desde: 1, fila_hasta: 20, capacidad: 100 }],
  sedes: [
    { sede_id: 'sede-1', nombre: 'Moreno', clave_acceso: null, preferencias: [] },
    { sede_id: 'sede-2', nombre: 'Catán', clave_acceso: 'VIEJA', preferencias: [1] },
  ],
  sesiones: [],
};

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}
const grupo = (nombre: string) => screen.getByRole('group', { name: nombre });

beforeEach(() => {
  llamarRpc.mockReset();
  llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true }));
});
afterEach(cleanup);

describe('SectoresPanel', () => {
  it('"Dividir en 3 partes" con filas 1–20 propone 1–6, 7–13 y 14–20; las secciones sin filas no lo ofrecen', async () => {
    const user = userEvent.setup();
    render(<SectoresPanel clave="SUPER1" />);
    await screen.findByDisplayValue('único');
    expect(within(grupo('Izquierda')).queryByRole('button', { name: 'Dividir en 3 partes' })).toBeNull();
    await user.click(within(grupo('Centro')).getByRole('button', { name: 'Dividir en 3 partes' }));
    const desde = within(grupo('Centro')).getAllByLabelText(/^Fila desde/) as HTMLInputElement[];
    const hasta = within(grupo('Centro')).getAllByLabelText(/^Fila hasta/) as HTMLInputElement[];
    expect(desde.map((i) => i.value)).toEqual(['1', '7', '14']);
    expect(hasta.map((i) => i.value)).toEqual(['6', '13', '20']);
    expect((within(grupo('Centro')).getAllByLabelText(/^Nombre/) as HTMLInputElement[]).map((i) => i.value)).toEqual(['adelante', 'medio', 'atrás']);
  });

  it('con las filas del salón también divide una sección sin sectores', async () => {
    const user = userEvent.setup();
    const filas = Array.from({ length: 9 }, (_, i) => ({ seccion: 'derecha' as const, numero: i + 1 }));
    render(<SectoresPanel clave="SUPER1" filas={filas} />);
    await user.click(await within(await screen.findByRole('group', { name: 'Derecha' })).findByRole('button', { name: 'Dividir en 3 partes' }));
    expect((within(grupo('Derecha')).getAllByLabelText(/^Fila hasta/) as HTMLInputElement[]).map((i) => i.value)).toEqual(['3', '6', '9']);
  });

  it('guardar manda el JSON de todos los sectores', async () => {
    const user = userEvent.setup();
    render(<SectoresPanel clave="SUPER1" />);
    await screen.findByDisplayValue('único');
    await user.click(within(grupo('Centro')).getByRole('button', { name: 'Dividir en 3 partes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    await waitFor(() => expect(llamadas('guardar_sectores')).toHaveLength(1));
    expect(llamadas('guardar_sectores')[0][1]).toEqual({
      p_clave: 'SUPER1',
      p_sectores: [
        { seccion: 'centro', nombre: 'adelante', fila_desde: 1, fila_hasta: 6 },
        { seccion: 'centro', nombre: 'medio', fila_desde: 7, fila_hasta: 13 },
        { seccion: 'centro', nombre: 'atrás', fila_desde: 14, fila_hasta: 20 },
      ],
    });
    expect(await screen.findByText('Sectores guardados.')).toBeTruthy();
  });

  it('muestra los errores SECTORES_INVALIDOS uno por uno', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_mapa_supervisor'
        ? MAPA
        : { success: false, error: 'SECTORES_INVALIDOS', errores: [{ motivo: 'Hueco en centro' }, { motivo: 'Nombre vacío en centro' }] },
    );
    render(<SectoresPanel clave="SUPER1" />);
    await screen.findByDisplayValue('único');
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    const lista = await screen.findByRole('alert');
    expect(within(lista).getByText('Hueco en centro')).toBeTruthy();
    expect(within(lista).getByText('Nombre vacío en centro')).toBeTruthy();
  });

  it('con SECTORES_CON_ASIGNACIONES avisa y no cambia el formulario', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_mapa_supervisor' ? MAPA : { success: false, error: 'SECTORES_CON_ASIGNACIONES' },
    );
    render(<SectoresPanel clave="SUPER1" />);
    await user.clear(await screen.findByDisplayValue('único'));
    await user.type(screen.getByLabelText(/^Nombre/), 'otro');
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    expect(await screen.findByText('Borrá primero las asignaciones por sector.')).toBeTruthy();
    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe('otro');
  });

  it('la fecha límite se carga en hora de Argentina y se manda con -03:00; "Sin fecha límite" manda null', async () => {
    const user = userEvent.setup();
    render(<SectoresPanel clave="SUPER1" />);
    const campo = (await screen.findByLabelText('Fecha límite')) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('2026-11-01T18:30'));
    await user.clear(campo);
    await user.type(campo, '2026-11-02T20:00');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(llamadas('guardar_fecha_limite')).toHaveLength(1));
    expect(llamadas('guardar_fecha_limite')[0][1]).toEqual({ p_clave: 'SUPER1', p_fecha: '2026-11-02T20:00:00-03:00' });
    await user.click(screen.getByRole('button', { name: 'Sin fecha límite' }));
    await waitFor(() => expect(llamadas('guardar_fecha_limite')).toHaveLength(2));
    expect(llamadas('guardar_fecha_limite')[1][1]).toEqual({ p_clave: 'SUPER1', p_fecha: null });
    await waitFor(() => expect(campo.value).toBe(''));
  });

  it('"Generar enlace" muestra el enlace de la sede con rol=sede y "Rotar enlace" pide rotar', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string, p: Record<string, unknown>) => {
      if (nombre === 'obtener_mapa_supervisor') return MAPA;
      if (nombre === 'generar_acceso_sede') return { success: true, clave: p.p_rotar ? 'NUEVA' : 'ABC123' };
      return { success: true };
    });
    render(<SectoresPanel clave="SUPER1" />);
    expect(await screen.findByText(`${window.location.origin}/entrar?k=VIEJA&rol=sede`)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Generar enlace de Moreno' }));
    expect(await screen.findByText(`${window.location.origin}/entrar?k=ABC123&rol=sede`)).toBeTruthy();
    expect(llamadas('generar_acceso_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-1', p_rotar: false });
    await user.click(screen.getByRole('button', { name: 'Rotar enlace de Catán' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, rotar' }));
    expect(await screen.findByText(`${window.location.origin}/entrar?k=NUEVA&rol=sede`)).toBeTruthy();
    expect(llamadas('generar_acceso_sede')[1][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-2', p_rotar: true });
  });
  it('"Rotar enlace" pide confirmación: cancelar no rota, confirmar sí', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true, clave: 'NUEVA' }));
    render(<SectoresPanel clave="SUPER1" />);
    await user.click(await screen.findByRole('button', { name: 'Rotar enlace de Catán' }));
    expect(llamadas('generar_acceso_sede')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(llamadas('generar_acceso_sede')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Rotar enlace de Catán' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, rotar' }));
    await waitFor(() => expect(llamadas('generar_acceso_sede')).toHaveLength(1));
    expect(llamadas('generar_acceso_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-2', p_rotar: true });
  });

  describe('aviso de preferencias', () => {
    const AVISO = 'Las preferencias de las sedes se conservan solo en los sectores cuyo rango de filas no cambie.';

    it('aparece si alguna sede tiene preferencias', async () => {
      render(<SectoresPanel clave="SUPER1" />);
      await screen.findByDisplayValue('único');
      expect(screen.getByText(AVISO)).toBeTruthy();
    });

    it('no aparece si ninguna sede tiene preferencias', async () => {
      llamarRpc.mockImplementation(async (nombre: string) =>
        nombre === 'obtener_mapa_supervisor' ? { ...MAPA, sedes: MAPA.sedes.map((s) => ({ ...s, preferencias: [] })) } : { success: true },
      );
      render(<SectoresPanel clave="SUPER1" />);
      await screen.findByDisplayValue('único');
      expect(screen.queryByText(AVISO)).toBeNull();
    });
  });

  it('al cambiar version vuelve a pedir el mapa y refresca las sedes sin pisar lo que se está editando', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SectoresPanel clave="SUPER1" version={0} />);
    const nombre = await screen.findByDisplayValue('único');
    await user.clear(nombre);
    await user.type(nombre, 'en edición');
    llamarRpc.mockImplementation(async (n: string) =>
      n === 'obtener_mapa_supervisor'
        ? { ...MAPA, sedes: [...MAPA.sedes, { sede_id: 'sede-3', nombre: 'Lomas', clave_acceso: null, preferencias: [] }] }
        : { success: true },
    );
    rerender(<SectoresPanel clave="SUPER1" version={1} />);
    expect(await screen.findByRole('button', { name: 'Generar enlace de Lomas' })).toBeTruthy();
    expect(llamadas('obtener_mapa_supervisor')).toHaveLength(2);
    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe('en edición');
  });

  describe('Agregar sede', () => {
    it('llama guardar_sede con el nombre, recarga la lista y avisa a los hermanos', async () => {
      const user = userEvent.setup();
      const onGuardado = vi.fn();
      let creada = false;
      llamarRpc.mockImplementation(async (nombre: string) => {
        if (nombre === 'guardar_sede') {
          creada = true;
          return { success: true, sede_id: 'sede-9' };
        }
        if (nombre === 'obtener_mapa_supervisor')
          return creada ? { ...MAPA, sedes: [...MAPA.sedes, { sede_id: 'sede-9', nombre: 'Pilar', clave_acceso: null, preferencias: [] }] } : MAPA;
        return { success: true };
      });
      render(<SectoresPanel clave="SUPER1" onGuardado={onGuardado} />);
      await user.type(await screen.findByLabelText('Agregar sede'), 'Pilar');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(llamadas('guardar_sede')).toHaveLength(1));
      expect(llamadas('guardar_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_nombre: 'Pilar' });
      expect(await screen.findByRole('button', { name: 'Generar enlace de Pilar' })).toBeTruthy();
      expect((screen.getByLabelText('Agregar sede') as HTMLInputElement).value).toBe('');
      expect(onGuardado).toHaveBeenCalledTimes(1);
    });

    it('con NOMBRE_INVALIDO muestra el mensaje y no limpia el campo', async () => {
      const user = userEvent.setup();
      llamarRpc.mockImplementation(async (nombre: string) =>
        nombre === 'obtener_mapa_supervisor' ? MAPA : { success: false, error: 'NOMBRE_INVALIDO' },
      );
      render(<SectoresPanel clave="SUPER1" />);
      await user.type(await screen.findByLabelText('Agregar sede'), '   ');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      expect(await screen.findByText('msg:NOMBRE_INVALIDO')).toBeTruthy();
    });

    it('sin sedes explica que se agregan acá o se crean al importar', async () => {
      llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? { ...MAPA, sedes: [] } : { success: true }));
      render(<SectoresPanel clave="SUPER1" />);
      expect(await screen.findByText('Todavía no hay sedes. Agregalas acá o se crean solas al importar reservas.')).toBeTruthy();
    });
  });
});
