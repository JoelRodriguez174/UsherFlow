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

import { SedesPaso } from './SedesPaso';

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
const pasosCon = (avisosSedes: string[] = []) =>
  PASOS.map((p) => ({ ...p, completo: true, bloqueado: false, resumen: '', requisitos: [], avisos: p.id === 'sedes' ? avisosSedes : ['aviso de otro paso'] }));

beforeEach(() => {
  llamarRpc.mockReset();
  recargar.mockReset();
  llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true }));
  usePreparacion.mockReturnValue({ estado: 'listo', pasos: pasosCon(), recargar });
});
afterEach(cleanup);

describe('SedesPaso', () => {
  it('la fecha límite se carga en hora de Argentina y se manda con -03:00; "Sin fecha límite" manda null', async () => {
    const user = userEvent.setup();
    render(<SedesPaso />);
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
    expect(recargar).toHaveBeenCalledTimes(2);
  });

  it('"Generar enlace" muestra el enlace de la sede con rol=sede y "Rotar enlace" pide rotar', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string, p: Record<string, unknown>) => {
      if (nombre === 'obtener_mapa_supervisor') return MAPA;
      if (nombre === 'generar_acceso_sede') return { success: true, clave: p.p_rotar ? 'NUEVA' : 'ABC123' };
      return { success: true };
    });
    render(<SedesPaso />);
    expect(await screen.findByText(`${window.location.origin}/entrar?k=VIEJA&rol=sede`)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Generar enlace de Moreno' }));
    expect(await screen.findByText(`${window.location.origin}/entrar?k=ABC123&rol=sede`)).toBeTruthy();
    expect(llamadas('generar_acceso_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-1', p_rotar: false });
    await user.click(screen.getByRole('button', { name: 'Rotar enlace de Catán' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, rotar' }));
    expect(await screen.findByText(`${window.location.origin}/entrar?k=NUEVA&rol=sede`)).toBeTruthy();
    expect(llamadas('generar_acceso_sede')[1][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-2', p_rotar: true });
    expect(recargar).toHaveBeenCalledTimes(2);
  });

  it('"Rotar enlace" pide confirmación: cancelar no rota, confirmar sí', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? MAPA : { success: true, clave: 'NUEVA' }));
    render(<SedesPaso />);
    await user.click(await screen.findByRole('button', { name: 'Rotar enlace de Catán' }));
    expect(llamadas('generar_acceso_sede')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(llamadas('generar_acceso_sede')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Rotar enlace de Catán' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, rotar' }));
    await waitFor(() => expect(llamadas('generar_acceso_sede')).toHaveLength(1));
    expect(llamadas('generar_acceso_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_sede_id: 'sede-2', p_rotar: true });
  });

  describe('Agregar sede', () => {
    it('llama guardar_sede con el nombre, recarga la lista y recarga la preparación', async () => {
      const user = userEvent.setup();
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
      render(<SedesPaso />);
      await user.type(await screen.findByLabelText('Agregar sede'), 'Pilar');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(llamadas('guardar_sede')).toHaveLength(1));
      expect(llamadas('guardar_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_nombre: 'Pilar' });
      expect(await screen.findByRole('button', { name: 'Generar enlace de Pilar' })).toBeTruthy();
      expect((screen.getByLabelText('Agregar sede') as HTMLInputElement).value).toBe('');
      expect(recargar).toHaveBeenCalledTimes(1);
    });

    it('refresca las sedes sin pisar la fecha límite que se está editando', async () => {
      const user = userEvent.setup();
      llamarRpc.mockImplementation(async (nombre: string) => {
        if (nombre === 'obtener_mapa_supervisor') return MAPA;
        return { success: true };
      });
      render(<SedesPaso />);
      const campo = (await screen.findByLabelText('Fecha límite')) as HTMLInputElement;
      await waitFor(() => expect(campo.value).toBe('2026-11-01T18:30'));
      await user.clear(campo);
      await user.type(campo, '2026-12-05T10:00');
      await user.type(screen.getByLabelText('Agregar sede'), 'Pilar');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(llamadas('obtener_mapa_supervisor')).toHaveLength(2));
      expect(campo.value).toBe('2026-12-05T10:00');
    });

    it('con NOMBRE_INVALIDO muestra el mensaje, no limpia el campo y no recarga', async () => {
      const user = userEvent.setup();
      llamarRpc.mockImplementation(async (nombre: string) =>
        nombre === 'obtener_mapa_supervisor' ? MAPA : { success: false, error: 'NOMBRE_INVALIDO' },
      );
      render(<SedesPaso />);
      await user.type(await screen.findByLabelText('Agregar sede'), '   ');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      expect(await screen.findByText('msg:NOMBRE_INVALIDO')).toBeTruthy();
      expect(recargar).not.toHaveBeenCalled();
    });

    it('sin sedes explica que se agregan acá o se crean al importar', async () => {
      llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? { ...MAPA, sedes: [] } : { success: true }));
      render(<SedesPaso />);
      expect(await screen.findByText('Todavía no hay sedes. Agregalas acá o se crean solas al importar reservas.')).toBeTruthy();
    });
  });

  it('explica que los nombres no distinguen mayúsculas ni acentos', async () => {
    render(<SedesPaso />);
    expect(await screen.findByText('Los nombres no distinguen mayúsculas ni acentos.')).toBeTruthy();
  });

  it('muestra los avisos del paso Sedes en un desplegable y no los de otros pasos', async () => {
    usePreparacion.mockReturnValue({ estado: 'listo', pasos: pasosCon(['La sede Moreno no tiene enlace de acceso']), recargar });
    render(<SedesPaso />);
    const aviso = await screen.findByText('La sede Moreno no tiene enlace de acceso');
    expect(aviso.closest('details')).not.toBeNull();
    expect(screen.queryByText('aviso de otro paso')).toBeNull();
  });

  it('sin avisos no muestra el desplegable de avisos', async () => {
    render(<SedesPaso />);
    await screen.findByLabelText('Fecha límite');
    expect(document.querySelector('details')).toBeNull();
  });
});
