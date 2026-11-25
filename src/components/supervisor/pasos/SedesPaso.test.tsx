// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { sede_id: 'sede-1', nombre: 'Moreno', clave_acceso: null, email_autorizado: null, cuenta_activa: false, preferencias: [] },
    { sede_id: 'sede-2', nombre: 'Catán', clave_acceso: null, email_autorizado: 'catan@iglesia.org', cuenta_activa: true, preferencias: [1] },
  ],
  sesiones: [],
};

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}
const pasosCon = () => PASOS.map((p) => ({ ...p, completo: true, bloqueado: false, resumen: '', requisitos: [], avisos: [] }));

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

  it('muestra el estado de cuenta de cada sede y permite guardar y quitar el email autorizado', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string, params: { p_email?: string }) => {
      if (nombre === 'obtener_mapa_supervisor') return MAPA;
      if (nombre === 'guardar_email_sede') {
        const clean = (params.p_email ?? '').trim().toLowerCase();
        return { success: true, email: clean || null };
      }
      return { success: true };
    });

    render(<SedesPaso />);
    expect((await screen.findAllByText('Sin email')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Cuenta activa')).toBeTruthy();

    const inputMoreno = screen.getByLabelText('Email autorizado de Moreno') as HTMLInputElement;
    await user.type(inputMoreno, 'pastor.moreno@iglesia.org');
    await user.click(screen.getAllByRole('button', { name: 'Guardar email' })[0]);

    await waitFor(() => expect(llamadas('guardar_email_sede')).toHaveLength(1));
    expect(llamadas('guardar_email_sede')[0][1]).toEqual({
      p_clave: 'SUPER1',
      p_sede_id: 'sede-1',
      p_email: 'pastor.moreno@iglesia.org',
    });
    expect(await screen.findByText('Pendiente de activar')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Quitar acceso' })[0]);
    await waitFor(() => expect(llamadas('guardar_email_sede')).toHaveLength(2));
    expect(llamadas('guardar_email_sede')[1][1]).toEqual({
      p_clave: 'SUPER1',
      p_sede_id: 'sede-1',
      p_email: '',
    });
  });

  it('importa emails desde CSV: simula vista previa y al confirmar guarda en el servidor', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string, params: { p_simular?: boolean }) => {
      if (nombre === 'obtener_mapa_supervisor') return MAPA;
      if (nombre === 'importar_emails_sedes') {
        return { success: true, total: 2, sedes_nuevas: ['Pilar'], cambios: params.p_simular ? 1 : 1 };
      }
      return { success: true };
    });

    render(<SedesPaso />);
    const fileInput = await screen.findByLabelText('Planilla de sedes y emails');
    const csv = new File(['sede,email\nCatán,nuevo@iglesia.org\nPilar,pilar@iglesia.org\n'], 'sedes.csv', { type: 'text/csv' });
    Object.defineProperty(csv, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('sede,email\nCatán,nuevo@iglesia.org\nPilar,pilar@iglesia.org\n').buffer,
    });
    fireEvent.change(fileInput, { target: { files: [csv] } });

    expect(await screen.findByText('Se van a guardar 2 emails autorizados.')).toBeTruthy();
    expect(screen.getByText(/Sedes nuevas a crear: Pilar/)).toBeTruthy();
    expect(screen.getByText(/1 sede cambia de email/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirmar importación' }));
    await waitFor(() => expect(llamadas('importar_emails_sedes')).toHaveLength(2));
    expect(llamadas('importar_emails_sedes')[1][1]).toEqual({
      p_clave: 'SUPER1',
      p_filas: [
        { sede: 'Catán', email: 'nuevo@iglesia.org' },
        { sede: 'Pilar', email: 'pilar@iglesia.org' },
      ],
      p_simular: false,
    });
    expect(await screen.findByText('Emails de sedes importados.')).toBeTruthy();
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
        if (nombre === 'obtener_mapa_supervisor') {
          return creada
            ? {
                ...MAPA,
                sedes: [...MAPA.sedes, { sede_id: 'sede-9', nombre: 'Pilar', clave_acceso: null, email_autorizado: null, cuenta_activa: false, preferencias: [] }],
              }
            : MAPA;
        }
        return { success: true };
      });
      render(<SedesPaso />);
      await user.type(await screen.findByLabelText('Agregar sede'), 'Pilar');
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(llamadas('guardar_sede')).toHaveLength(1));
      expect(llamadas('guardar_sede')[0][1]).toEqual({ p_clave: 'SUPER1', p_nombre: 'Pilar' });
      expect(await screen.findByLabelText('Email autorizado de Pilar')).toBeTruthy();
      expect(recargar).toHaveBeenCalledTimes(1);
    });

    it('sin sedes explica que se agregan acá o se importan desde Excel/CSV', async () => {
      llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_mapa_supervisor' ? { ...MAPA, sedes: [] } : { success: true }));
      render(<SedesPaso />);
      expect(await screen.findByText('Todavía no hay sedes. Agregalas acá o importalas desde Excel/CSV.')).toBeTruthy();
    });
  });
});
