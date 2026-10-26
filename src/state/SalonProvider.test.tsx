// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoSalon } from '@/domain/types';
import type { EstadoConexion, SalonSyncDeps } from './sync';

const leerAcceso = vi.fn();
const llamarRpc = vi.fn();
const crearSalonSync = vi.fn();

vi.mock('@/lib/acceso', () => ({ leerAcceso: () => leerAcceso() }));
vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
}));
vi.mock('./sync', () => ({
  crearSalonSync: (deps: SalonSyncDeps) => crearSalonSync(deps),
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { ClaveInvalidaError } from '@/lib/rpc';
import { SalonProvider, useSalon, useTick } from './SalonProvider';

const SERVER_NOW = '2026-10-22T20:00:00.000Z';
const estadoServidor: EstadoSalon = {
  serverNow: SERVER_NOW,
  filas: [
    {
      id: 1,
      seccion: 'centro',
      numero: 1,
      fragmentada: false,
      verificadaEn: null,
      tramos: [{ id: 11, orden: 1, tipo: 'publico', capacidad: 6, ocupados: 2, etiqueta: null }],
    },
  ],
  pendientes: [],
  sesion: null,
  reservas: [],
  sectores: [],
};

let deps: SalonSyncDeps;
const sync = {
  iniciar: vi.fn(async () => {}),
  detener: vi.fn(),
  resync: vi.fn(async () => {}),
  ejecutar: vi.fn<(m: unknown) => Promise<{ ok: boolean; error?: string }>>(),
};

const wrapper = ({ children }: { children: ReactNode }) => <SalonProvider>{children}</SalonProvider>;

function cargar(offsetMs = 0, estado: EstadoSalon = estadoServidor) {
  act(() => deps.dispatch({ type: 'cargar', estado, offsetMs }));
}

beforeEach(() => {
  leerAcceso.mockReturnValue({ clave: 'K1', rol: 'puerta' });
  crearSalonSync.mockImplementation((d: SalonSyncDeps) => {
    deps = d;
    return sync;
  });
  sync.ejecutar.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SalonProvider: clave', () => {
  it('sin clave expone claveInvalida y no crea la sincronización', () => {
    leerAcceso.mockReturnValue(null);
    const { result } = renderHook(() => useSalon(), { wrapper });
    expect(result.current.claveInvalida).toBe(true);
    expect(result.current.cargando).toBe(false);
    expect(crearSalonSync).not.toHaveBeenCalled();
  });

  it('crea el sync con la clave guardada, lo inicia y lo detiene al desmontar', () => {
    const { unmount } = renderHook(() => useSalon(), { wrapper });
    expect(crearSalonSync).toHaveBeenCalledTimes(1);
    expect(deps.clave).toBe('K1');
    expect(sync.iniciar).toHaveBeenCalledTimes(1);
    unmount();
    expect(sync.detener).toHaveBeenCalledTimes(1);
  });

  it('onClaveInvalida expone claveInvalida y corta la sincronización', () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    expect(result.current.claveInvalida).toBe(false);
    act(() => deps.onClaveInvalida());
    expect(result.current.claveInvalida).toBe(true);
    expect(sync.detener).toHaveBeenCalled();
  });
});

describe('SalonProvider: estado', () => {
  it('cargando hasta el primer cargar; luego deriva las vistas', () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    expect(result.current.cargando).toBe(true);
    cargar();
    expect(result.current.cargando).toBe(false);
    expect(result.current.filas[1].numero).toBe(1);
    expect(result.current.derivado.filasPorSeccion.centro[0].libres).toBe(4);
    expect(result.current.derivado.ocupacion.ocupados).toBe(2);
  });

  it('expone el offset del reloj del servidor para quien necesite la hora del servidor', () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    expect(result.current.offsetMs).toBe(0);
    cargar(7_500);
    expect(result.current.offsetMs).toBe(7_500);
  });

  it('getState del sync ve el estado más reciente de inmediato tras un dispatch', () => {
    renderHook(() => useSalon(), { wrapper });
    cargar();
    expect(deps.getState().filas[1].id).toBe(1);
    expect(deps.getState().cargado).toBe(true);
  });

  it('conexión, error y limpiarError', () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    expect(result.current.conexion).toBe('connected');
    act(() => deps.onConexion('reconnecting' as EstadoConexion));
    expect(result.current.conexion).toBe('reconnecting');
    act(() => deps.onError('uy'));
    expect(result.current.error).toBe('uy');
    act(() => result.current.limpiarError());
    expect(result.current.error).toBeNull();
  });
});

describe('SalonProvider: acciones', () => {
  it('mandar genera id temporal y creadoEn corregido por el offset del servidor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-22T20:00:10.000Z'));
    const { result } = renderHook(() => useSalon(), { wrapper });
    cargar(5_000);
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      r = await result.current.acciones.mandar('centro', 3);
    });
    expect(r).toEqual({ ok: true });
    const m = sync.ejecutar.mock.calls[0][0] as Record<string, unknown>;
    expect(m).toMatchObject({ tipo: 'mandar', seccion: 'centro', cantidad: 3, creadoEn: '2026-10-22T20:00:15.000Z' });
    expect(typeof m.pendienteTmpId).toBe('string');
    expect((m.pendienteTmpId as string).length).toBeGreaterThan(0);
  });

  it('mandar devuelve el error del sync', async () => {
    sync.ejecutar.mockResolvedValue({ ok: false, error: 'SECCION_SIN_CUPO' });
    const { result } = renderHook(() => useSalon(), { wrapper });
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      r = await result.current.acciones.mandar('centro', 3);
    });
    expect(r).toEqual({ ok: false, error: 'SECCION_SIN_CUPO' });
  });

  it('sentar / noLlegaron / seLevanto / corregir / juntar delegan en sync.ejecutar y devuelven ok', async () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    const a = result.current.acciones;
    await act(async () => {
      expect((await a.sentar('p1', 11)).ok).toBe(true);
      expect(await a.noLlegaron('p2')).toBe(true);
      expect(await a.seLevanto(11)).toBe(true);
      expect(await a.corregir(11, 3)).toBe(true);
      expect(await a.juntar(1)).toBe(true);
    });
    expect(sync.ejecutar.mock.calls.map((c) => c[0])).toEqual([
      { tipo: 'sentar', pendienteId: 'p1', tramoId: 11 },
      { tipo: 'noLlegaron', pendienteId: 'p2' },
      { tipo: 'seLevanto', tramoId: 11 },
      { tipo: 'corregir', tramoId: 11, libresVistos: 3 },
      { tipo: 'juntar', filaId: 1 },
    ]);
    sync.ejecutar.mockResolvedValue({ ok: false, error: 'TRAMO_SIN_CUPO' });
    await act(async () => {
      expect((await a.sentar('p1', 11)).ok).toBe(false);
    });
  });

  it('las acciones tienen identidad estable entre renders', () => {
    const { result } = renderHook(() => useSalon(), { wrapper });
    const antes = result.current.acciones;
    cargar();
    expect(result.current.acciones).toBe(antes);
  });

  it('verificar llama a la RPC y resincroniza', async () => {
    llamarRpc.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSalon(), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.acciones.verificar(7);
    });
    expect(ok).toBe(true);
    expect(llamarRpc).toHaveBeenCalledWith('verificar_fila', { p_clave: 'K1', p_fila_id: 7 });
    expect(sync.resync).toHaveBeenCalledTimes(1);
  });

  it('agregarFila llama a la RPC y resincroniza', async () => {
    llamarRpc.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSalon(), { wrapper });
    await act(async () => {
      expect(await result.current.acciones.agregarFila('derecha')).toBe(true);
    });
    expect(llamarRpc).toHaveBeenCalledWith('agregar_fila_al_fondo', { p_clave: 'K1', p_seccion: 'derecha' });
    expect(sync.resync).toHaveBeenCalledTimes(1);
  });

  it('un fallo de la RPC deja el mensaje en error y devuelve false', async () => {
    llamarRpc.mockResolvedValue({ success: false, error: 'FILA_INEXISTENTE' });
    const { result } = renderHook(() => useSalon(), { wrapper });
    await act(async () => {
      expect(await result.current.acciones.verificar(7)).toBe(false);
    });
    expect(result.current.error).toBe('msg:FILA_INEXISTENTE');
    expect(sync.resync).not.toHaveBeenCalled();
  });

  it('un fallo de red deja el mensaje de red; una clave inválida corta todo', async () => {
    llamarRpc.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSalon(), { wrapper });
    await act(async () => {
      expect(await result.current.acciones.verificar(7)).toBe(false);
    });
    expect(result.current.error).toBe('msg:ERROR_DE_RED');

    llamarRpc.mockRejectedValueOnce(new ClaveInvalidaError());
    await act(async () => {
      expect(await result.current.acciones.agregarFila('centro')).toBe(false);
    });
    expect(result.current.claveInvalida).toBe(true);
    expect(sync.detener).toHaveBeenCalled();
  });

  it('sin clave las acciones fallan sin tocar la red', async () => {
    leerAcceso.mockReturnValue(null);
    const { result } = renderHook(() => useSalon(), { wrapper });
    await act(async () => {
      expect(await result.current.acciones.verificar(1)).toBe(false);
      expect((await result.current.acciones.sentar('p', 1)).ok).toBe(false);
      expect((await result.current.acciones.mandar('centro', 1)).ok).toBe(false);
    });
    expect(llamarRpc).not.toHaveBeenCalled();
    expect(sync.ejecutar).not.toHaveBeenCalled();
  });
});

describe('SalonProvider: tick', () => {
  it('solo corre el temporizador si hay pendientes, y marca ámbar con el reloj corregido', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(SERVER_NOW));
    const { result } = renderHook(() => useSalon(), { wrapper });
    cargar();
    expect(vi.getTimerCount()).toBe(0);

    const conPendiente: EstadoSalon = {
      ...estadoServidor,
      pendientes: [{ id: 'p1', seccion: 'centro', cantidad: 1, sedeId: null, creadoEn: SERVER_NOW }],
    };
    cargar(0, conPendiente);
    expect(vi.getTimerCount()).toBe(1);
    expect(result.current.derivado.pendientesPorSeccion.centro[0].ambar).toBe(false);

    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(result.current.derivado.pendientesPorSeccion.centro[0].ambar).toBe(true);

    cargar(0, estadoServidor);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('SalonProvider: cambio de sesión', () => {
  it('resincroniza a inicio + 3 h, y no programa nada sin sesión', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(SERVER_NOW));
    renderHook(() => useSalon(), { wrapper });
    cargar();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(sync.resync).not.toHaveBeenCalled();

    // inicio 19:00Z -> cambia a las 22:00Z; ahora 20:00Z.
    cargar(0, { ...estadoServidor, sesion: { id: 's1', nombre: 'Domingo', inicioAt: '2026-10-22T19:00:00.000Z', liberaAt: '2026-10-22T18:40:00.000Z' } });
    act(() => {
      vi.advanceTimersByTime(3600_000);
    });
    expect(sync.resync).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3600_000);
    });
    expect(sync.resync).toHaveBeenCalledTimes(1);

    cargar(0, estadoServidor); // sin sesión: se limpia
    act(() => {
      vi.advanceTimersByTime(10 * 3600_000);
    });
    expect(sync.resync).toHaveBeenCalledTimes(1);
  });
  it('una sesión a 30 días no dispara el resync de inmediato (límite de setTimeout)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(SERVER_NOW));
    renderHook(() => useSalon(), { wrapper });
    const inicio = new Date(Date.parse(SERVER_NOW) + 30 * 24 * 3600_000).toISOString();
    cargar(0, { ...estadoServidor, sesion: { id: 's2', nombre: 'Lejana', inicioAt: inicio, liberaAt: inicio } });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(sync.resync).not.toHaveBeenCalled();
  });
});

describe('useTick', () => {
  it('inactivo no programa ningún timer', () => {
    vi.useFakeTimers();
    renderHook(() => useTick(false));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('activo avanza cada intervalo y limpia al desactivarse o desmontar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, rerender, unmount } = renderHook(({ a }) => useTick(a, 500), { initialProps: { a: true } });
    expect(vi.getTimerCount()).toBe(1);
    const t0 = result.current;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(t0 + 1_000);
    rerender({ a: false });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ a: true });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('al reactivarse toma la hora actual, no la del último tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, rerender } = renderHook(({ a }) => useTick(a), { initialProps: { a: false } });
    act(() => {
      vi.setSystemTime(1_500_000);
    });
    rerender({ a: true });
    expect(result.current).toBe(1_500_000);
  });
});
