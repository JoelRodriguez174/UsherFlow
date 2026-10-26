// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASOS } from '@/domain/preparacion';

const llamarRpc = vi.fn();
const recargar = vi.fn();
const usePreparacion = vi.fn();

vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));
vi.mock('@/components/supervisor/SupervisorShell', () => ({
  useSupervisor: () => ({ claves: { claveUjier: 'UJIER1', claveSupervisor: 'SUPER1' }, origen: 'https://usherflow.test', renovar: vi.fn() }),
}));
vi.mock('@/components/supervisor/MapaSupervisor', () => ({
  MapaSupervisor: ({ clave, version }: { clave: string; version: number }) => <div data-testid="mapa">{`${clave}:${version}`}</div>,
}));
vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

const readSheet = vi.fn();
vi.mock('read-excel-file/universal', () => ({ readSheet: (...a: unknown[]) => readSheet(...a) }));

import { ReservasPaso } from './ReservasPaso';

const OBTENER = {
  success: true,
  liberacion_min: 20,
  sesiones: [
    {
      id: 's1',
      nombre: 'Domingo 10',
      inicio_at: '2026-10-25T13:00:00Z',
      reservas: [{ sede: 'Moreno', seccion: 'centro', cantidad: 5 }],
    },
  ],
};

function llamadas(nombre: string) {
  return llamarRpc.mock.calls.filter((c) => c[0] === nombre);
}

beforeEach(() => {
  llamarRpc.mockReset();
  recargar.mockReset();
  usePreparacion.mockReturnValue({ estado: 'listo', pasos: PASOS.map((p) => ({ ...p, completo: true, bloqueado: false, resumen: '', requisitos: [], avisos: [] })), recargar });
  llamarRpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'obtener_reservas') return OBTENER;
    if (nombre === 'importar_reservas') return { success: true, sedes_nuevas: ['Catán'], reservas: 1 };
    return { success: true };
  });
});
afterEach(cleanup);

async function subirCsv(user: ReturnType<typeof userEvent.setup>, texto: string) {
  const input = await screen.findByLabelText('Archivo Excel o CSV');
  await user.upload(input, new File([texto], 'reservas.csv', { type: 'text/csv' }));
}

describe('ReservasPaso', () => {
  it('un CSV con línea inválida la muestra y no llama al servidor', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nMoreno,centro,Domingo 10,3\nMoreno,arriba,Domingo 10,3\n');
    expect(await screen.findByText('Línea 3: Sección inválida: arriba')).toBeTruthy();
    expect(llamadas('importar_reservas')).toHaveLength(0);
  });

  it('un CSV en windows-1252 (Excel en español) conserva los acentos', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    const bytes = new Uint8Array([...new TextEncoder().encode('sede,seccion,sesion,cantidad\n'), 0x43, 0x61, 0x74, 0xe1, 0x6e, ...new TextEncoder().encode(',centro,Domingo 10,3\n')]);
    await user.upload(await screen.findByLabelText('Archivo Excel o CSV'), new File([bytes], 'reservas.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Se van a crear sedes nuevas: Catán. Si es un error de tipeo, corregí el archivo.')).toBeTruthy();
    expect(llamadas('importar_reservas')[0][1]).toMatchObject({ p_filas: [{ sede: 'Catán' }] });
  });

  it('un Excel (.xlsx) se lee con la primera hoja y se simula igual que un CSV', async () => {
    const user = userEvent.setup();
    readSheet.mockResolvedValue([
      ['sede', 'seccion', 'sesion', 'cantidad'],
      ['Catán', 'centro', 'Domingo 10', 42],
    ]);
    render(<ReservasPaso />);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await user.upload(await screen.findByLabelText('Archivo Excel o CSV'), new File(['x'], 'reservas.xlsx', { type: xlsx }));
    expect(await screen.findByText('Se van a crear sedes nuevas: Catán. Si es un error de tipeo, corregí el archivo.')).toBeTruthy();
    expect(llamadas('importar_reservas')[0][1]).toMatchObject({ p_filas: [{ sede: 'Catán', seccion: 'centro', sesion: 'Domingo 10', cantidad: 42 }] });
  });

  it('un Excel ilegible muestra el error y no llama al servidor', async () => {
    const user = userEvent.setup();
    readSheet.mockRejectedValue(new Error('zip roto'));
    render(<ReservasPaso />);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await user.upload(await screen.findByLabelText('Archivo Excel o CSV'), new File(['x'], 'reservas.xlsx', { type: xlsx }));
    expect(await screen.findByText(/No se pudo leer el Excel/)).toBeTruthy();
    expect(llamadas('importar_reservas')).toHaveLength(0);
  });

  it('un CSV válido se simula, muestra sedes nuevas y al confirmar importa', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nCatán,centro,Domingo 10,3\n');
    expect(await screen.findByText('Se van a crear sedes nuevas: Catán. Si es un error de tipeo, corregí el archivo.')).toBeTruthy();
    expect(llamadas('importar_reservas')[0][1]).toMatchObject({ p_clave: 'SUPER1', p_simular: true });
    await user.click(screen.getByRole('button', { name: 'Confirmar importación' }));
    await waitFor(() => expect(llamadas('importar_reservas')).toHaveLength(2));
    expect(llamadas('importar_reservas')[1][1]).toMatchObject({ p_simular: false });
    await waitFor(() => expect(llamadas('obtener_reservas')).toHaveLength(2));
  });

  it('guardar la tabla manual manda las filas de esa sesión', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    const tabla = await screen.findByRole('table', { name: 'Reservas de Domingo 10' });
    await user.click(within(tabla.parentElement!.parentElement as HTMLElement).getByRole('button', { name: 'Guardar reservas' }));
    await waitFor(() => expect(llamadas('importar_reservas')).toHaveLength(1));
    expect(llamadas('importar_reservas')[0][1]).toEqual({
      p_clave: 'SUPER1',
      p_filas: [{ sede: 'Moreno', seccion: 'centro', sesion: 'Domingo 10', cantidad: 5 }],
      p_simular: false,
      p_sesiones: ['Domingo 10'],
    });
  });

  it('errores del servidor en un CSV se muestran con la línea del archivo y los globales sin "Fila 0"', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_reservas'
        ? OBTENER
        : {
            success: false,
            error: 'RESERVAS_INVALIDAS',
            errores: [
              { fila: 0, motivo: 'Sesión inexistente: X' },
              { fila: 2, motivo: 'Excede la capacidad' },
            ],
          },
    );
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nA,centro,Domingo 10,3\n\nB,centro,Domingo 10,3\n');
    expect(await screen.findByText('Línea 4: Excede la capacidad')).toBeTruthy();
    expect(screen.getByText('Sesión inexistente: X')).toBeTruthy();
    expect(screen.queryByText(/Fila 0/)).toBeNull();
  });

  it('guardar la tabla manual con errores muestra el detalle por fila', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_reservas'
        ? OBTENER
        : { success: false, error: 'RESERVAS_INVALIDAS', errores: [{ fila: 1, motivo: 'Excede la capacidad de centro' }] },
    );
    render(<ReservasPaso />);
    await user.click(await screen.findByRole('button', { name: 'Guardar reservas' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Fila 1: Excede la capacidad de centro');
  });

  describe('con sectores', () => {
    const CON_SECTORES = {
      ...OBTENER,
      sectores: [
        { id: 1, seccion: 'centro', nombre: 'adelante', fila_desde: 1, fila_hasta: 5 },
        { id: 2, seccion: 'centro', nombre: 'atrás', fila_desde: 6, fila_hasta: 10 },
        { id: 3, seccion: 'izquierda', nombre: 'único', fila_desde: 1, fila_hasta: 10 },
      ],
      sesiones: [{ ...OBTENER.sesiones[0], reservas: [{ sede: 'Moreno', seccion: 'centro', cantidad: 5, sector: 'adelante' }] }],
    };

    it('la tabla ofrece "Toda la sección" y solo los sectores de esa sección, y manda el sector elegido', async () => {
      const user = userEvent.setup();
      llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_reservas' ? CON_SECTORES : { success: true }));
      render(<ReservasPaso />);
      const sector = (await screen.findByLabelText('Sector, fila 1')) as HTMLSelectElement;
      expect(sector.value).toBe('adelante');
      expect(within(sector).getAllByRole('option').map((o) => o.textContent)).toEqual(['Toda la sección', 'adelante', 'atrás']);
      await user.selectOptions(sector, 'atrás');
      await user.click(screen.getByRole('button', { name: 'Guardar reservas' }));
      await waitFor(() => expect(llamadas('importar_reservas')).toHaveLength(1));
      expect(llamadas('importar_reservas')[0][1]).toMatchObject({
        p_filas: [{ sede: 'Moreno', seccion: 'centro', sesion: 'Domingo 10', cantidad: 5, sector: 'atrás' }],
      });
    });

    it('cambiar la sección de una fila limpia el sector y "Toda la sección" no manda sector', async () => {
      const user = userEvent.setup();
      llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_reservas' ? CON_SECTORES : { success: true }));
      render(<ReservasPaso />);
      await user.selectOptions(await screen.findByLabelText('Sección, fila 1'), 'izquierda');
      expect((screen.getByLabelText('Sector, fila 1') as HTMLSelectElement).value).toBe('');
      await user.click(screen.getByRole('button', { name: 'Guardar reservas' }));
      await waitFor(() => expect(llamadas('importar_reservas')).toHaveLength(1));
      expect(llamadas('importar_reservas')[0][1].p_filas).toEqual([{ sede: 'Moreno', seccion: 'izquierda', sesion: 'Domingo 10', cantidad: 5 }]);
    });

    it('un CSV con columna sector la muestra en la vista previa y la manda al servidor', async () => {
      const user = userEvent.setup();
      render(<ReservasPaso />);
      await subirCsv(user, 'sede,seccion,sesion,cantidad,sector\nCatán,centro,Domingo 10,3,adelante\n');
      const vista = await screen.findByRole('table', { name: 'Vista previa de la importación' });
      expect(within(vista).getByRole('columnheader', { name: 'Sector' })).toBeTruthy();
      expect(within(vista).getByText('adelante')).toBeTruthy();
      expect(llamadas('importar_reservas')[0][1]).toMatchObject({ p_filas: [{ sede: 'Catán', sector: 'adelante' }] });
    });
  });

  it('sin sectores la tabla no muestra la columna Sector', async () => {
    render(<ReservasPaso />);
    await screen.findByRole('table', { name: 'Reservas de Domingo 10' });
    expect(screen.queryByLabelText('Sector, fila 1')).toBeNull();
  });

  it('el mapa se renderiza con la clave y su version cambia tras guardar la tabla', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    await screen.findByRole('table', { name: 'Reservas de Domingo 10' });
    expect(screen.getByTestId('mapa').textContent).toBe('SUPER1:0');
    await user.click(screen.getByRole('button', { name: 'Guardar reservas' }));
    await waitFor(() => expect(screen.getByTestId('mapa').textContent).toBe('SUPER1:1'));
  });

  it('guardar la tabla llama recargar() y no si el servidor rechaza', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    await user.click(await screen.findByRole('button', { name: 'Guardar reservas' }));
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
    llamarRpc.mockImplementation(async (nombre: string) => (nombre === 'obtener_reservas' ? OBTENER : { success: false, error: 'X' }));
    await user.click(screen.getByRole('button', { name: 'Guardar reservas' }));
    await screen.findByText('msg:X');
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('confirmar la importación llama recargar() y simular no', async () => {
    const user = userEvent.setup();
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nCatán,centro,Domingo 10,3\n');
    await screen.findByText('Se van a crear sedes nuevas: Catán. Si es un error de tipeo, corregí el archivo.');
    expect(recargar).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar importación' }));
    await waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
  });

  it('con sedes nuevas la vista previa avisa con borde de advertencia y deja confirmar', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_reservas' ? OBTENER : { success: true, sedes_nuevas: ['Catan', 'Moron'], reservas: 1 },
    );
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nCatan,centro,Domingo 10,3\n');
    const aviso = await screen.findByText('Se van a crear sedes nuevas: Catan, Moron. Si es un error de tipeo, corregí el archivo.');
    expect(aviso.className).toContain('border-advertencia');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(screen.queryByText(/^Sedes nuevas:/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Confirmar importación' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sin sedes nuevas no hay aviso de sedes nuevas pero sí confirmar', async () => {
    const user = userEvent.setup();
    llamarRpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_reservas' ? OBTENER : { success: true, sedes_nuevas: [], reservas: 1 },
    );
    render(<ReservasPaso />);
    await subirCsv(user, 'sede,seccion,sesion,cantidad\nMoreno,centro,Domingo 10,3\n');
    await screen.findByText('Reservas a guardar: 1');
    expect(screen.queryByText(/Se van a crear sedes nuevas/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar importación' })).toBeTruthy();
  });
});
