// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pendiente } from '@/domain/types';
import { estadoInicial, salonReducer, type SalonAction, type SalonState } from './salonReducer';

type Handler = (payload: Record<string, unknown>) => void;
const rpc = vi.fn();
const handlers: Record<string, Handler> = {};
let statusCb: ((s: string) => void) | null = null;
const removeChannel = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    channel: () => {
      const ch = {
        on(_t: string, filtro: { table: string }, cb: Handler) {
          handlers[filtro.table] = cb;
          return ch;
        },
        subscribe(cb: (s: string) => void) {
          statusCb = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}));

import { estadoDesdeServidor, RPC_TIMEOUT_MS } from '@/lib/rpc';
import { crearSalonSync, decidirRemoto } from './sync';

const SERVER_NOW = '2026-10-22T20:00:00.000Z';

function filaCruda(id: number, ocupados = 0) {
  return {
    id,
    seccion: 'centro',
    numero: id,
    fragmentada: false,
    verificada_en: null,
    tramos: [{ id: id * 10, orden: 1, tipo: 'publico', capacidad: 8, ocupados, etiqueta: null }],
  };
}
const estadoCrudo = (over: Record<string, unknown> = {}) => ({
  server_now: SERVER_NOW,
  evento_id: 'ev',
  filas: [filaCruda(5, 0), filaCruda(6, 0)],
  pendientes: [{ id: 'p1', seccion: 'centro', cantidad: 2, creado_en: SERVER_NOW }],
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const llamadas = (nombre: string) => rpc.mock.calls.filter((c) => c[0] === nombre).length;

const montados: Array<{ detener(): void }> = [];

/** Banco de pruebas: un store real (salonReducer) conectado al sync. */
function montar() {
  let state: SalonState = estadoInicial;
  const dispatch = vi.fn((a: SalonAction) => {
    state = salonReducer(state, a);
  });
  const onError = vi.fn();
  const onClaveInvalida = vi.fn();
  const onConexion = vi.fn();
  const sync = crearSalonSync({
    clave: 'K',
    getState: () => state,
    dispatch,
    onError,
    onClaveInvalida,
    onConexion,
  });
  montados.push(sync);
  return { sync, dispatch, onError, onClaveInvalida, onConexion, get: () => state };
}

/** rpc por defecto: estado fijo para obtener_estado_salon y éxito para el resto. */
function rpcPorDefecto(mut: (nombre: string) => unknown = () => ({ success: true })) {
  rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'obtener_estado_salon') return { data: estadoCrudo(), error: null };
    return { data: mut(nombre), error: null };
  });
}

beforeEach(() => {
  rpc.mockReset();
  removeChannel.mockReset();
  for (const k of Object.keys(handlers)) delete handlers[k];
  statusCb = null;
});
afterEach(() => {
  for (const s of montados.splice(0)) s.detener(); // quita listeners de document/window entre tests
  vi.useRealTimers();
});

describe('decidirRemoto', () => {
  it('difiere una fila en vuelo y aplica las demás', () => {
    expect(decidirRemoto(5, new Set([5]))).toBe('diferir');
    expect(decidirRemoto(6, new Set([5]))).toBe('aplicar');
  });
});

describe('crearSalonSync: carga inicial', () => {
  it('iniciar carga el estado y se suscribe a fila, tramo, pendiente, sector y sesion; detener cierra el canal', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    expect(rpc).toHaveBeenCalledWith('obtener_estado_salon', { p_clave: 'K' });
    expect(t.get().cargado).toBe(true);
    expect(Object.keys(t.get().filas)).toEqual(['5', '6']);
    expect(Object.keys(t.get().pendientes)).toEqual(['p1']);
    expect(Object.keys(handlers).sort()).toEqual(['fila', 'pendiente', 'sector', 'sesion', 'tramo']);
    t.sync.detener();
    expect(removeChannel).toHaveBeenCalled();
  });

  it('Review Focus 4 (lado cliente): el offset se calcula con el server_now de la respuesta', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(SERVER_NOW) + 600_000)); // reloj local 10 min adelantado
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    expect(t.get().offsetMs).toBe(-600_000);
  });
});

describe('crearSalonSync: ejecutar', () => {
  it('éxito: aplica optimista, llama a la RPC correcta y no hace resync (salvo mandar)', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const r = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('sentar_pendiente', { p_clave: 'K', p_pendiente_id: 'p1', p_tramo_id: 50 });
    expect(t.get().filas[5].tramos[0].ocupados).toBe(2);
    expect(t.get().pendientes.p1).toBeUndefined();
    expect(llamadas('obtener_estado_salon')).toBe(0);
  });

  it('sentar propaga fuera_de_sector del RPC como fueraDeSector (los nombres de sectores); sin marca, no hay campo', async () => {
    rpcPorDefecto((nombre) =>
      nombre === 'sentar_pendiente'
        ? { success: true, fuera_de_sector: true, sectores: ['Centro medio', 'Centro fondo'] }
        : { success: true },
    );
    const t = montar();
    await t.sync.iniciar();
    const r = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(r).toEqual({ ok: true, fueraDeSector: ['Centro medio', 'Centro fondo'] });
    expect(t.get().pendientes.p1).toBeUndefined(); // se sentó igual: no se deshace

    const limpio = montar();
    rpcPorDefecto();
    await limpio.sync.iniciar();
    expect(await limpio.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 })).toEqual({ ok: true });
  });

  it.each([
    [{ tipo: 'noLlegaron', pendienteId: 'p1' } as const, 'cancelar_pendiente', { p_clave: 'K', p_pendiente_id: 'p1' }],
    [{ tipo: 'seLevanto', tramoId: 50 } as const, 'se_levanto', { p_clave: 'K', p_tramo_id: 50 }],
    [
      { tipo: 'corregir', tramoId: 50, libresVistos: 3 } as const,
      'corregir_conteo',
      { p_clave: 'K', p_tramo_id: 50, p_libres_vistos: 3 },
    ],
    [{ tipo: 'juntar', filaId: 5 } as const, 'juntar_fila', { p_clave: 'K', p_fila_id: 5 }],
  ])('mapea %j a la RPC %s', async (mutacion, nombre, params) => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    if (mutacion.tipo === 'seLevanto') {
      // hace falta algo ocupado para poder levantarse
      await t.sync.ejecutar({ tipo: 'corregir', tramoId: 50, libresVistos: 5 });
    }
    rpc.mockClear();
    const r = await t.sync.ejecutar(mutacion);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(nombre, params);
  });

  it('mandar exitoso: hace resync para reemplazar el id temporal por el real (ruling 1)', async () => {
    let n = 0;
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_estado_salon') {
        n++;
        return {
          data:
            n === 1
              ? estadoCrudo()
              : estadoCrudo({ pendientes: [{ id: 'real-1', seccion: 'centro', cantidad: 2, creado_en: SERVER_NOW }] }),
          error: null,
        };
      }
      return { data: { success: true, pendiente_id: 'real-1' }, error: null };
    });
    const t = montar();
    await t.sync.iniciar();
    const r = await t.sync.ejecutar({
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 2,
      sedeId: null,
      creadoEn: SERVER_NOW,
    });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('mandar_grupo', {
      p_clave: 'K',
      p_seccion: 'centro',
      p_cantidad: 2,
      p_sede: null,
    });
    expect(llamadas('obtener_estado_salon')).toBe(2);
    expect(Object.keys(t.get().pendientes)).toEqual(['real-1']);
  });

  it('validación local fallida: no llama a la RPC de mutación, avisa en español y pide resync', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const r = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'no-existe', tramoId: 50 });
    expect(r).toEqual({ ok: false, error: 'PENDIENTE_YA_RESUELTO' });
    expect(llamadas('sentar_pendiente')).toBe(0);
    expect(t.onError).toHaveBeenCalledTimes(1);
    expect(t.onError.mock.calls[0][0]).not.toContain('PENDIENTE_YA_RESUELTO');
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });

  it('Review Focus 3: una mutación rechazada por el servidor revierte solo esa entidad y avisa', async () => {
    let filaBEnServidor = 6;
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_estado_salon') {
        const b = { ...filaCruda(6), numero: filaBEnServidor };
        return { data: estadoCrudo({ filas: [filaCruda(5), b] }), error: null };
      }
      return { data: { success: false, error: 'TRAMO_SIN_CUPO' }, error: null };
    });
    const t = montar();
    await t.sync.iniciar();
    // otro ujier cambió la fila B (llega por realtime) antes de que falle nuestra mutación sobre A
    filaBEnServidor = 99;
    t.dispatch({ type: 'filaRemota', fila: { ...t.get().filas[6], numero: 99 } });
    const antesA = t.get().filas[5];
    // estado justo cuando se avisa: después de revertir y antes del resync
    let alAvisar: SalonState | null = null;
    t.onError.mockImplementation(() => {
      alAvisar = t.get();
    });

    const r = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(r).toEqual({ ok: false, error: 'TRAMO_SIN_CUPO' });
    expect(alAvisar!.filas[5]).toEqual(antesA);
    expect(alAvisar!.filas[6].numero).toBe(99); // B conserva el cambio remoto
    expect((alAvisar!.pendientes.p1 as Pendiente).cantidad).toBe(2);
    expect(t.onError).toHaveBeenCalledTimes(1);
    expect(t.onError.mock.calls[0][0]).toMatch(/lugar|cupo|entr/i);
    expect(t.get().filas[5]).toEqual(antesA);
    expect(t.get().filas[6].numero).toBe(99);
  });

  it('error de red: revierte, avisa con mensaje genérico y hace resync', async () => {
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_estado_salon') return { data: estadoCrudo(), error: null };
      return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    });
    const t = montar();
    await t.sync.iniciar();
    const antes = t.get().filas[5];
    const r = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(r.ok).toBe(false);
    expect(t.get().filas[5]).toEqual(antes);
    expect(t.get().pendientes.p1).toBeDefined();
    expect(t.onError).toHaveBeenCalledTimes(1);
    expect(t.onError.mock.calls[0][0]).not.toContain('Failed to fetch');
    expect(llamadas('obtener_estado_salon')).toBe(2);
  });

  it('un error de servidor desconocido se muestra con mensaje genérico', async () => {
    rpcPorDefecto(() => ({ success: false, error: 'ALGO_NUEVO' }));
    const t = montar();
    await t.sync.iniciar();
    await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(t.onError.mock.calls[0][0]).not.toContain('ALGO_NUEVO');
  });
});

describe('Review Focus 5: clave inválida', () => {
  it('llama a onClaveInvalida una sola vez, revierte, no reintenta ni hace resync', async () => {
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'obtener_estado_salon' && rpc.mock.calls.length === 1) return { data: estadoCrudo(), error: null };
      return { data: null, error: { message: 'CLAVE_INVALIDA' } };
    });
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const antes = t.get().filas[5];

    const r1 = await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(r1.ok).toBe(false);
    expect(t.get().filas[5]).toEqual(antes);
    expect(t.onClaveInvalida).toHaveBeenCalledTimes(1);
    expect(llamadas('sentar_pendiente')).toBe(1);
    expect(llamadas('obtener_estado_salon')).toBe(0);

    // acciones posteriores y resync manual: ni red ni nuevo aviso
    await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    await t.sync.resync();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(t.onClaveInvalida).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalled();
  });

  it('clave inválida ya en la carga inicial: un solo aviso y sin reintentos', async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: null, error: { message: 'CLAVE_INVALIDA' } });
    const t = montar();
    await t.sync.iniciar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.onClaveInvalida).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('bug 4: updates remotos de una fila en vuelo', () => {
  it('no se aplican mientras la mutación vuela y, al terminar, se hace resync una sola vez', async () => {
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise;
    });
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();

    const p = t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    const optimista = t.get().filas[5];
    expect(optimista.tramos[0].ocupados).toBe(2);

    // otro ujier actualiza la fila 5 (en vuelo) y la 6 (libre)
    handlers.fila({
      eventType: 'UPDATE',
      new: { id: 5, seccion: 'centro', numero: 55, fragmentada: true, verificada_en: null },
      old: { id: 5 },
    });
    handlers.fila({
      eventType: 'UPDATE',
      new: { id: 6, seccion: 'centro', numero: 66, fragmentada: false, verificada_en: null },
      old: { id: 6 },
    });
    handlers.tramo({
      eventType: 'UPDATE',
      new: { id: 50, fila_id: 5, orden: 1, tipo: 'publico', capacidad: 8, ocupados: 7, etiqueta: null },
      old: { id: 50 },
    });

    expect(t.get().filas[5]).toBe(optimista); // diferido: ni fila ni tramo se tocaron
    expect(t.get().filas[6].numero).toBe(66); // la otra fila sí se aplica
    expect(llamadas('obtener_estado_salon')).toBe(0);

    d.resolve({ data: { success: true }, error: null });
    await p;
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });

  it('sin updates diferidos no hay resync extra', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(llamadas('obtener_estado_salon')).toBe(0);
  });

  it('un resync pedido durante una mutación espera a que termine (no pisa el estado optimista)', async () => {
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise;
    });
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const p = t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    await t.sync.resync();
    expect(llamadas('obtener_estado_salon')).toBe(0);
    expect(t.get().filas[5].tramos[0].ocupados).toBe(2);
    d.resolve({ data: { success: true }, error: null });
    await p;
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });

  it('una respuesta de resync que llega cuando ya empezó otra mutación se descarta', async () => {
    const lento = deferred<{ data: unknown; error: null }>();
    let fetches = 0;
    const alDia = estadoCrudo({ filas: [filaCruda(5, 2), filaCruda(6, 0)], pendientes: [] });
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') {
        fetches++;
        if (fetches === 2) return lento.promise; // el que queda colgado
        return Promise.resolve({ data: fetches === 1 ? estadoCrudo() : alDia, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    const t = montar();
    await t.sync.iniciar();
    const r = t.sync.resync(); // 2º fetch, queda colgado
    await t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    lento.resolve({ data: estadoCrudo(), error: null }); // snapshot anterior a la mutación
    await r;
    // el snapshot viejo se descartó (solo hubo 2 'cargar': el inicial y el de la repetición) y se pidió otro fetch
    expect(fetches).toBe(3);
    expect(t.dispatch.mock.calls.filter((c) => c[0].type === 'cargar')).toHaveLength(2);
    expect(t.get().filas[5].tramos[0].ocupados).toBe(2);
  });
});

describe('realtime', () => {
  it('un cambio de tramo se pliega en su fila sin ir a la red', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    handlers.tramo({
      eventType: 'UPDATE',
      new: { id: 60, fila_id: 6, orden: 1, tipo: 'publico', capacidad: 8, ocupados: 4, etiqueta: null },
      old: { id: 60 },
    });
    expect(t.get().filas[6].tramos[0].ocupados).toBe(4);
    expect(t.get().filas[5].tramos[0].ocupados).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un tramo nuevo se inserta ordenado y uno borrado se quita', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.tramo({
      eventType: 'INSERT',
      new: { id: 61, fila_id: 6, orden: 2, tipo: 'reservado', capacidad: 2, ocupados: 0, etiqueta: 'Coro' },
      old: {},
    });
    expect(t.get().filas[6].tramos.map((x) => x.id)).toEqual([60, 61]);
    handlers.tramo({ eventType: 'DELETE', new: {}, old: { id: 61 } });
    expect(t.get().filas[6].tramos.map((x) => x.id)).toEqual([60]);
  });

  it('un tramo de una fila desconocida dispara un resync con debounce (una sola vez)', async () => {
    vi.useFakeTimers();
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    for (let i = 0; i < 3; i++) {
      handlers.tramo({
        eventType: 'INSERT',
        new: { id: 900 + i, fila_id: 77, orden: 1, tipo: 'publico', capacidad: 8, ocupados: 0, etiqueta: null },
        old: {},
      });
    }
    expect(rpc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });

  it('fila actualizada conserva sus tramos; fila borrada se elimina; pendiente se agrega y se quita', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.fila({
      eventType: 'UPDATE',
      new: { id: 6, seccion: 'centro', numero: 6, fragmentada: true, verificada_en: SERVER_NOW },
      old: { id: 6 },
    });
    expect(t.get().filas[6].fragmentada).toBe(true);
    expect(t.get().filas[6].verificadaEn).toBe(SERVER_NOW);
    expect(t.get().filas[6].tramos).toHaveLength(1);
    handlers.fila({ eventType: 'DELETE', new: {}, old: { id: 6 } });
    expect(t.get().filas[6]).toBeUndefined();
    handlers.pendiente({
      eventType: 'INSERT',
      new: { id: 'p2', seccion: 'derecha', cantidad: 3, creado_en: SERVER_NOW },
      old: {},
    });
    expect(t.get().pendientes.p2.cantidad).toBe(3);
    handlers.pendiente({ eventType: 'DELETE', new: {}, old: { id: 'p2' } });
    expect(t.get().pendientes.p2).toBeUndefined();
  });

  it('mientras vuela un mandar, un pendiente remoto nuevo se difiere (evita duplicar con el temporal)', async () => {
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise;
    });
    const t = montar();
    await t.sync.iniciar();
    const p = t.sync.ejecutar({
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 2,
      sedeId: null,
      creadoEn: SERVER_NOW,
    });
    handlers.pendiente({
      eventType: 'INSERT',
      new: { id: 'real-1', seccion: 'centro', cantidad: 2, creado_en: SERVER_NOW },
      old: {},
    });
    expect(Object.keys(t.get().pendientes).sort()).toEqual(['p1', 'tmp-1']);
    d.resolve({ data: { success: true, pendiente_id: 'real-1' }, error: null });
    await p;
  });

  it('el estado del canal se informa y al reconectar se hace resync', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    statusCb!('SUBSCRIBED');
    expect(t.onConexion).toHaveBeenLastCalledWith('connected');
    rpc.mockClear();
    statusCb!('CHANNEL_ERROR');
    expect(t.onConexion).toHaveBeenLastCalledWith('reconnecting');
    statusCb!('SUBSCRIBED');
    await vi.waitFor(() => expect(llamadas('obtener_estado_salon')).toBe(1));
    expect(t.onConexion).toHaveBeenLastCalledWith('connected');
  });

  it('resync en visibilitychange y online; detener quita los listeners', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(llamadas('obtener_estado_salon')).toBe(1));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(llamadas('obtener_estado_salon')).toBe(2));
    t.sync.detener();
    rpc.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('pendientes resueltos por UPDATE (el servidor nunca hace DELETE)', () => {
  const cruda = (estado?: string) => ({
    id: 'p1',
    seccion: 'centro',
    cantidad: 2,
    creado_en: SERVER_NOW,
    ...(estado === undefined ? {} : { estado }),
  });

  it.each(['sentado', 'cancelado'])('un UPDATE a estado %s quita el pendiente', async (estado) => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    expect(t.get().pendientes.p1).toBeDefined();
    handlers.pendiente({ eventType: 'UPDATE', new: cruda(estado), old: { id: 'p1' } });
    expect(t.get().pendientes.p1).toBeUndefined();
  });

  it('un INSERT con estado distinto de pendiente nunca se agrega', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.pendiente({ eventType: 'INSERT', new: { ...cruda('sentado'), id: 'p9' }, old: {} });
    expect(t.get().pendientes.p9).toBeUndefined();
  });

  it('un UPDATE con estado pendiente sigue aplicándose', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.pendiente({ eventType: 'UPDATE', new: { ...cruda('pendiente'), cantidad: 5 }, old: { id: 'p1' } });
    expect(t.get().pendientes.p1.cantidad).toBe(5);
  });

  it('si el pendiente está en vuelo, la baja remota se difiere y el resync final la asienta', async () => {
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise;
    });
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const p = t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    const quitados = () => t.dispatch.mock.calls.filter((c) => c[0].type === 'pendienteQuitado').length;
    handlers.pendiente({ eventType: 'UPDATE', new: cruda('sentado'), old: { id: 'p1' } });
    expect(quitados()).toBe(0);
    d.resolve({ data: { success: true }, error: null });
    await p;
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });
});

describe('realtime: reservas, sesión y pendientes con sede', () => {
  const cruda = (extra: Record<string, unknown>) => ({
    id: 'p1',
    seccion: 'centro',
    cantidad: 2,
    creado_en: SERVER_NOW,
    ...extra,
  });

  it.each(['sesion', 'sector'])('un evento de %s pide un resync (con debounce)', async (tabla) => {
    vi.useFakeTimers();
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    expect(llamadas('obtener_estado_salon')).toBe(1);
    handlers[tabla]({ eventType: 'UPDATE', new: { id: 'x' }, old: {} });
    handlers[tabla]({ eventType: 'INSERT', new: { id: 'y' }, old: {} });
    await vi.advanceTimersByTimeAsync(200);
    expect(llamadas('obtener_estado_salon')).toBe(2);
  });

  it('un pendiente que pasa a sentado con sede_id pide resync', async () => {
    vi.useFakeTimers();
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.pendiente({ eventType: 'UPDATE', new: cruda({ estado: 'sentado', sede_id: 'catan' }), old: { id: 'p1' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(llamadas('obtener_estado_salon')).toBe(2);
  });

  it('sentado sin sede_id: no hay resync, se quita como siempre', async () => {
    vi.useFakeTimers();
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    handlers.pendiente({ eventType: 'UPDATE', new: cruda({ estado: 'sentado', sede_id: null }), old: { id: 'p1' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(llamadas('obtener_estado_salon')).toBe(1);
    expect(t.get().pendientes.p1).toBeUndefined();
  });

  it('sentar localmente un pendiente con sede termina con un resync; sin sede, no', async () => {
    rpcPorDefecto();
    const conSede = montar();
    rpc.mockImplementation(async (nombre: string) =>
      nombre === 'obtener_estado_salon'
        ? {
            data: estadoCrudo({
              pendientes: [{ id: 'p1', seccion: 'centro', cantidad: 2, sede_id: 'catan', creado_en: SERVER_NOW }],
            }),
            error: null,
          }
        : { data: { success: true }, error: null },
    );
    await conSede.sync.iniciar();
    rpc.mockClear();
    await conSede.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });
});

describe('timeout de RPC (un RPC colgado no deja el sync en vuelo para siempre)', () => {
  it('una mutación colgada sigue el camino de fallo: revierte, avisa, libera el vuelo y hace resync', async () => {
    vi.useFakeTimers();
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise; // no responde (hasta la respuesta tardía de más abajo)
    });
    const t = montar();
    await t.sync.iniciar();
    rpc.mockClear();
    const antes = t.get().filas[5];

    const p = t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    expect(t.get().filas[5].tramos[0].ocupados).toBe(2); // optimista
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
    const r = await p;

    expect(r).toEqual({ ok: false, error: 'ERROR_DE_RED' });
    expect(t.get().filas[5]).toEqual(antes);
    expect(t.get().pendientes.p1).toBeDefined();
    expect(t.onError).toHaveBeenCalledTimes(1);
    expect(t.onError.mock.calls[0][0]).toMatch(/conexi/i);
    expect(llamadas('obtener_estado_salon')).toBe(1);

    // vuelo liberado: un resync posterior corre en el acto
    await t.sync.resync();
    expect(llamadas('obtener_estado_salon')).toBe(2);

    // la respuesta tardía no se aplica ni dispara nada
    const despachos = t.dispatch.mock.calls.length;
    d.resolve({ data: { success: true }, error: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.dispatch.mock.calls.length).toBe(despachos);
    expect(t.onError).toHaveBeenCalledTimes(1);
  });

  it('un fetch de estado colgado vence, se reintenta con backoff y la respuesta tardía se ignora', async () => {
    vi.useFakeTimers();
    const colgado = deferred<{ data: unknown; error: null }>();
    let fetches = 0;
    rpc.mockImplementation((nombre: string) => {
      if (nombre !== 'obtener_estado_salon') return Promise.resolve({ data: { success: true }, error: null });
      fetches++;
      return fetches === 1 ? colgado.promise : Promise.resolve({ data: estadoCrudo(), error: null });
    });
    const t = montar();
    const inicio = t.sync.iniciar();
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
    await inicio;
    expect(t.get().cargado).toBe(false);
    expect(t.onConexion).toHaveBeenLastCalledWith('reconnecting');

    await vi.advanceTimersByTimeAsync(2_000); // backoff
    expect(fetches).toBe(2);
    expect(t.get().cargado).toBe(true);
    expect(t.onConexion).toHaveBeenLastCalledWith('connected');

    const cargas = () => t.dispatch.mock.calls.filter((c) => c[0].type === 'cargar').length;
    expect(cargas()).toBe(1);
    colgado.resolve({ data: estadoCrudo({ filas: [] }), error: null }); // tardía: no pisa nada
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cargas()).toBe(1);
    expect(Object.keys(t.get().filas)).toEqual(['5', '6']);
  });
});

describe('estado de conexión tras offline/online del navegador', () => {
  it('offline informa offline y, con el resync exitoso al volver online, se restaura connected', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    statusCb!('SUBSCRIBED');
    rpc.mockClear();

    window.dispatchEvent(new Event('offline'));
    expect(t.onConexion).toHaveBeenLastCalledWith('offline');

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(t.onConexion).toHaveBeenLastCalledWith('connected'));
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });

  it('un resync exitoso no repite connected si ya estaba connected', async () => {
    rpcPorDefecto();
    const t = montar();
    await t.sync.iniciar();
    statusCb!('SUBSCRIBED');
    t.onConexion.mockClear();
    await t.sync.resync();
    expect(t.onConexion).not.toHaveBeenCalled();
  });
});

describe('iniciar con una mutación ya en vuelo', () => {
  it('no pisa el estado optimista: conecta el canal, difiere la carga y la hace al terminar la mutación', async () => {
    const d = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((nombre: string) => {
      if (nombre === 'obtener_estado_salon') return Promise.resolve({ data: estadoCrudo(), error: null });
      return d.promise;
    });
    const t = montar();
    // estado precargado (p. ej. por un sync anterior) para poder mutar antes de iniciar
    const { estado } = estadoDesdeServidor(estadoCrudo());
    t.dispatch({ type: 'cargar', estado, offsetMs: 0 });

    const p = t.sync.ejecutar({ tipo: 'sentar', pendienteId: 'p1', tramoId: 50 });
    await t.sync.iniciar(); // vuelve enseguida: la carga queda pendiente
    expect(Object.keys(handlers).sort()).toEqual(['fila', 'pendiente', 'sector', 'sesion', 'tramo']);
    expect(llamadas('obtener_estado_salon')).toBe(0);
    expect(t.get().filas[5].tramos[0].ocupados).toBe(2);

    d.resolve({ data: { success: true }, error: null });
    await p;
    expect(llamadas('obtener_estado_salon')).toBe(1);
  });
});
