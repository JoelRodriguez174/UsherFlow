// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASOS } from '@/domain/preparacion';
import type { Fila, Seccion } from '@/domain/types';

const llamarRpc = vi.fn();
const recargar = vi.fn();
let filasSalon: Record<number, Fila> = {};

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));
vi.mock('@/components/supervisor/usePreparacion', () => ({
  usePreparacion: () => ({
    estado: 'listo',
    pasos: PASOS.map((p) => ({ ...p, completo: true, bloqueado: false, resumen: '', requisitos: [], avisos: [] })),
    recargar,
  }),
}));
vi.mock('@/components/supervisor/SupervisorShell', () => ({
  useSupervisor: () => ({ claves: { claveUjier: 'UJIER1', claveSupervisor: 'SUPER1' }, origen: 'https://usherflow.test', renovar: vi.fn() }),
}));
vi.mock('@/state/SalonProvider', () => ({ useSalon: () => ({ filas: filasSalon }) }));

import { PLANTILLA_EJEMPLO } from '@/config/plantilla';
import { ARMADO_MS } from '../useArmado';
import { SalonPaso } from './SalonPaso';

const MAPA = {
  success: true,
  fecha_limite: null,
  sectores: [{ id: 1, seccion: 'centro', nombre: 'único', fila_desde: 1, fila_hasta: 20, capacidad: 100 }],
  sedes: [
    { sede_id: 'sede-1', nombre: 'Moreno', clave_acceso: null, preferencias: [] },
    { sede_id: 'sede-2', nombre: 'Catán', clave_acceso: 'VIEJA', preferencias: [1] },
  ],
  sesiones: [],
};

const llamadas = (nombre: string) => llamarRpc.mock.calls.filter((c) => c[0] === nombre);
const grupo = (nombre: string) => screen.getByRole('group', { name: nombre });
const filasDe = (seccion: Seccion, n: number): Record<number, Fila> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i): [number, Fila] => [
      i + 1 + (seccion === 'derecha' ? 1000 : 0),
      { id: i + 1, seccion, numero: i + 1, fragmentada: false, verificadaEn: null, tramos: [{ id: i + 1, orden: 1, tipo: 'publico', capacidad: 4, ocupados: 0, etiqueta: null }] },
    ]),
  );

/** Deja pasar el tiempo de armado de los botones destructivos. */
function armar() {
  act(() => {
    vi.advanceTimersByTime(ARMADO_MS);
  });
}

async function confirmarVaciado(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
  armar();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }));
}

beforeEach(() => {
  // shouldAdvanceTime: userEvent y waitFor siguen andando; el armado se adelanta a mano con armar().
  vi.useFakeTimers({ shouldAdvanceTime: true });
  filasSalon = {};
  llamarRpc.mockReset();
  recargar.mockReset();
  llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SalonPaso: sectores', () => {
  it('"Dividir en 3 partes" con filas 1–20 propone 1–6, 7–13 y 14–20; las secciones sin filas no lo ofrecen', async () => {
    const user = userEvent.setup();
    render(<SalonPaso />);
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
    filasSalon = filasDe('derecha', 9);
    render(<SalonPaso />);
    await user.click(await within(await screen.findByRole('group', { name: 'Derecha' })).findByRole('button', { name: 'Dividir en 3 partes' }));
    expect((within(grupo('Derecha')).getAllByLabelText(/^Fila hasta/) as HTMLInputElement[]).map((i) => i.value)).toEqual(['3', '6', '9']);
  });

  it('guardar manda el JSON de todos los sectores y recarga los pasos', async () => {
    const user = userEvent.setup();
    render(<SalonPaso />);
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
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  describe('vista previa de sectores (sin guardar)', () => {
    const estiloAdvertencia = (t: string | RegExp) => screen.getByText(t).className;

    it('refleja el formulario: dividir y editar desde/hasta actualizan los lugares sin guardar', async () => {
      const user = userEvent.setup();
      filasSalon = filasDe('centro', 20);
      render(<SalonPaso />);
      expect(await screen.findByText('único: filas 1 a 20 · 80 lugares')).toBeTruthy();
      await user.click(within(grupo('Centro')).getByRole('button', { name: 'Dividir en 3 partes' }));
      expect(screen.getByText('adelante: filas 1 a 6 · 24 lugares')).toBeTruthy();
      expect(screen.getByText('medio: filas 7 a 13 · 28 lugares')).toBeTruthy();
      const hasta = within(grupo('Centro')).getAllByLabelText(/^Fila hasta/)[0];
      await user.clear(hasta);
      await user.type(hasta, '5');
      expect(screen.getByText('adelante: filas 1 a 5 · 20 lugares')).toBeTruthy();
      expect(llamadas('guardar_sectores')).toHaveLength(0);
    });

    it('al achicar un rango marca en advertencia las filas que quedan sin sector', async () => {
      const user = userEvent.setup();
      filasSalon = filasDe('centro', 20);
      render(<SalonPaso />);
      await screen.findByText('único: filas 1 a 20 · 80 lugares');
      expect(screen.queryByText(/sin sector/i)).toBeNull();
      const hasta = within(grupo('Centro')).getByLabelText(/^Fila hasta/);
      await user.clear(hasta);
      await user.type(hasta, '18');
      expect(screen.getByText('único: filas 1 a 18 · 72 lugares')).toBeTruthy();
      expect(screen.getByText('Filas sin sector: 19, 20')).toBeTruthy();
      expect(estiloAdvertencia('Filas sin sector: 19, 20')).toContain('text-advertencia');
    });

    it('ignora sin romper las filas con desde/hasta vacíos o desde > hasta', async () => {
      const user = userEvent.setup();
      filasSalon = filasDe('centro', 4);
      render(<SalonPaso />);
      await screen.findByDisplayValue('único');
      const hasta = within(grupo('Centro')).getByLabelText(/^Fila hasta/);
      await user.clear(hasta);
      await user.type(hasta, '4');
      expect(screen.getByText('único: filas 1 a 4 · 16 lugares')).toBeTruthy();
      await user.clear(hasta);
      expect(screen.queryByText(/^único:/)).toBeNull();
      expect(screen.getByText('Filas sin sector: 1, 2, 3, 4')).toBeTruthy();
      await user.type(hasta, '0');
      expect(screen.queryByText(/^único:/)).toBeNull();
      const desde = within(grupo('Centro')).getByLabelText(/^Fila desde/);
      await user.clear(desde);
      expect(screen.queryByText(/^único:/)).toBeNull();
    });
  });

  it('muestra los errores SECTORES_INVALIDOS uno por uno y no recarga', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_mapa_supervisor'
        ? MAPA
        : { success: false, error: 'SECTORES_INVALIDOS', errores: [{ motivo: 'Hueco en centro' }, { motivo: 'Nombre vacío en centro' }] },
    );
    render(<SalonPaso />);
    await screen.findByDisplayValue('único');
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    const lista = await screen.findByRole('alert');
    expect(within(lista).getByText('Hueco en centro')).toBeTruthy();
    expect(within(lista).getByText('Nombre vacío en centro')).toBeTruthy();
    expect(recargar).not.toHaveBeenCalled();
  });

  it('con SECTORES_CON_ASIGNACIONES muestra el motivo, un enlace a Reservas y no cambia el formulario', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_mapa_supervisor' ? MAPA : { success: false, error: 'SECTORES_CON_ASIGNACIONES' },
    );
    render(<SalonPaso />);
    await user.clear(await screen.findByDisplayValue('único'));
    await user.type(screen.getByLabelText(/^Nombre/), 'otro');
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    expect(await screen.findByText('msg:SECTORES_CON_ASIGNACIONES')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a Reservas' }).getAttribute('href')).toBe('/supervisor/reservas');
    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe('otro');
    expect(recargar).not.toHaveBeenCalled();
  });

  it('vaciar con éxito limpia el aviso viejo de SECTORES_CON_ASIGNACIONES y su enlace a Reservas', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'guardar_sectores' ? { success: false, error: 'SECTORES_CON_ASIGNACIONES' } : nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true },
    );
    render(<SalonPaso />);
    await screen.findByDisplayValue('único');
    await user.click(screen.getByRole('button', { name: 'Guardar sectores' }));
    expect(await screen.findByRole('link', { name: 'Ir a Reservas' })).toBeTruthy();
    await confirmarVaciado(user);
    await waitFor(() => expect(llamadas('reiniciar_salon')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Ir a Reservas' })).toBeNull());
    expect(screen.queryByText('msg:SECTORES_CON_ASIGNACIONES')).toBeNull();
  });

  describe('aviso de preferencias', () => {
    const AVISO = 'Las preferencias de las sedes se conservan solo en los sectores cuyo rango de filas no cambie.';

    it('aparece si alguna sede tiene preferencias', async () => {
      render(<SalonPaso />);
      await screen.findByDisplayValue('único');
      expect(screen.getByText(AVISO)).toBeTruthy();
    });

    it('no aparece si ninguna sede tiene preferencias', async () => {
      llamarRpc.mockImplementation(async (nombre: string) =>
        nombre === 'obtener_mapa_supervisor' ? { ...MAPA, sedes: MAPA.sedes.map((s) => ({ ...s, preferencias: [] })) } : { success: true },
      );
      render(<SalonPaso />);
      await screen.findByDisplayValue('único');
      expect(screen.queryByText(AVISO)).toBeNull();
    });
  });
});

describe('SalonPaso: vaciar auditorio', () => {
  it('no llama a la RPC hasta la segunda confirmación y después recarga los pasos', async () => {
    const user = userEvent.setup();
    render(<SalonPaso />);
    await screen.findByDisplayValue('único');
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    expect(llamadas('reiniciar_salon')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    expect(llamadas('reiniciar_salon')).toHaveLength(0);
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }));

    await waitFor(() => expect(llamadas('reiniciar_salon')).toHaveLength(1));
    expect(llamadas('reiniciar_salon')[0]).toEqual(['reiniciar_salon', { p_clave: 'SUPER1' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toMatch(/vaci/i);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('cancelar en el segundo paso no llama a la RPC', async () => {
    const user = userEvent.setup();
    render(<SalonPaso />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(llamadas('reiniciar_salon')).toHaveLength(0);
  });

  it('un error del servidor se muestra como alerta y no recarga', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: false, error: 'CLAVE_INVALIDA' }));
    render(<SalonPaso />);
    await confirmarVaciado(user);
    expect((await screen.findByRole('alert')).textContent).toContain('msg:CLAVE_INVALIDA');
    expect(recargar).not.toHaveBeenCalled();
  });

  it('un fallo de red se muestra como alerta', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_mapa_supervisor') return MAPA;
      throw new Error('boom');
    });
    render(<SalonPaso />);
    await confirmarVaciado(user);
    expect((await screen.findByRole('alert')).textContent).toContain('msg:ERROR_DE_RED');
  });
});

describe('SalonPaso: aplicar plantilla', () => {
  it('pide una confirmación que recuerda revisar los sectores y luego llama a aplicar_plantilla con PLANTILLA_EJEMPLO', async () => {
    const user = userEvent.setup();
    render(<SalonPaso />);
    await user.click(screen.getByRole('button', { name: 'Aplicar plantilla' }));
    expect(llamadas('aplicar_plantilla')).toHaveLength(0);
    expect(within(screen.getByRole('dialog')).getByText(/revisá los sectores después/i)).toBeTruthy();
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, aplicar/i }));
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('aplicar_plantilla', { p_clave: 'SUPER1', p_plantilla: PLANTILLA_EJEMPLO }));
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
  });
});

describe('SalonPaso: armado de las confirmaciones destructivas (anti doble toque)', () => {
  it('Aplicar plantilla: el botón arranca deshabilitado, un clic no llama a la RPC y luego se habilita', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SalonPaso />);
    await user.click(screen.getByRole('button', { name: 'Aplicar plantilla' }));

    const boton = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, aplicar/i }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(within(screen.getByRole('dialog')).getByText(/esperá un instante/i)).toBeTruthy();
    expect(boton.getAttribute('aria-describedby')).toBeTruthy();
    await user.click(boton);
    expect(llamadas('aplicar_plantilla')).toHaveLength(0);

    armar();
    expect(boton.disabled).toBe(false);
    expect(boton.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/esperá un instante/i)).toBeNull();
    await user.click(boton);
    await waitFor(() => expect(llamadas('aplicar_plantilla')).toHaveLength(1));
  });

  it('Vaciar auditorio: el paso 2 arranca deshabilitado y un doble toque en Continuar no lo ejecuta', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SalonPaso />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));

    const continuar = within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }) as HTMLButtonElement;
    expect(continuar.disabled).toBe(false);
    await user.dblClick(continuar);

    const vaciar = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }) as HTMLButtonElement;
    expect(vaciar.disabled).toBe(true);
    expect(llamadas('reiniciar_salon')).toHaveLength(0);

    armar();
    expect(vaciar.disabled).toBe(false);
    await user.click(vaciar);
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('reiniciar_salon', { p_clave: 'SUPER1' }));
  });

  it('cada paso se vuelve a armar: lo esperado en el paso 1 no habilita el paso 2', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SalonPaso />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    const vaciar = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }) as HTMLButtonElement;
    expect(vaciar.disabled).toBe(true);
  });
});
