import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
// Vitest 5 marca como fallido un test cuyo spy lanza; para simular un cliente que revienta se usa una función común.
let explotar: (() => never) | null = null;
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      if (explotar) return explotar();
      return rpc(...a);
    },
  },
}));

import {
  ClaveInvalidaError,
  RPC_TIMEOUT_MS,
  RpcTimeoutError,
  estadoDesdeServidor,
  llamarRpc,
  mensajeDeError,
  obtenerEstadoSalon,
} from './rpc';

beforeEach(() => {
  rpc.mockReset();
  explotar = null;
});

describe('llamarRpc', () => {
  it('convierte un error de PostgREST con CLAVE_INVALIDA en ClaveInvalidaError', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'CLAVE_INVALIDA', code: 'P0001' } });
    await expect(llamarRpc('mandar_grupo', { p_clave: 'x' })).rejects.toBeInstanceOf(ClaveInvalidaError);
  });

  it('reconoce CLAVE_INVALIDA aunque el mensaje traiga más texto', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'raise exception: CLAVE_INVALIDA (evento)' } });
    await expect(llamarRpc('se_levanto', {})).rejects.toBeInstanceOf(ClaveInvalidaError);
  });

  it('devuelve tal cual una respuesta {success:false,error}', async () => {
    const data = { success: false, error: 'SECCION_SIN_CUPO' };
    rpc.mockResolvedValue({ data, error: null });
    await expect(llamarRpc('mandar_grupo', { p_clave: 'k' })).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith('mandar_grupo', { p_clave: 'k' });
  });

  it('devuelve una respuesta exitosa', async () => {
    rpc.mockResolvedValue({ data: { success: true, pendiente_id: 'abc' }, error: null });
    await expect(llamarRpc('mandar_grupo', {})).resolves.toEqual({ success: true, pendiente_id: 'abc' });
  });

  it('otro error de PostgREST se lanza como Error común (no como ClaveInvalidaError)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } });
    const err = await llamarRpc('mandar_grupo', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClaveInvalidaError);
  });

  it('una excepción de red lanzada por el cliente también se propaga como Error', async () => {
    explotar = () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await llamarRpc('mandar_grupo', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClaveInvalidaError);
  });

  it('una respuesta vacía se trata como error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(llamarRpc('mandar_grupo', {})).rejects.toThrow();
  });
});

describe('timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('una RPC sin respuesta lanza RpcTimeoutError a los RPC_TIMEOUT_MS y la respuesta tardía se ignora', async () => {
    vi.useFakeTimers();
    let resolverTarde!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (resolverTarde = r)));
    let resuelta = false;
    const p = llamarRpc('mandar_grupo', {}).catch((e: unknown) => e);
    void p.then(() => (resuelta = true));
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS - 1);
    expect(resuelta).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(err).toBeInstanceOf(RpcTimeoutError);
    expect(err).not.toBeInstanceOf(ClaveInvalidaError);
    resolverTarde({ data: { success: true }, error: null }); // no debe romper nada
    await vi.advanceTimersByTimeAsync(100);
  });

  it('una respuesta a tiempo no deja timers pendientes', async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    await llamarRpc('mandar_grupo', {});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('estadoDesdeServidor / obtenerEstadoSalon', () => {
  const crudo = {
    server_now: '2026-10-22T20:00:00.000Z',
    evento_id: 'ev-1',
    filas: [
      {
        id: 1,
        seccion: 'centro',
        numero: 3,
        fragmentada: true,
        verificada_en: null,
        tramos: [
          { id: 11, orden: 1, tipo: 'publico', capacidad: 8, ocupados: 2, etiqueta: null },
          { id: 12, orden: 2, tipo: 'reservado', capacidad: 2, ocupados: 0, etiqueta: 'Coro' },
        ],
      },
    ],
    pendientes: [{ id: 'p1', seccion: 'izquierda', cantidad: 4, creado_en: '2026-10-22T19:59:00.000Z' }],
  };

  it('mapea snake_case a los tipos camelCase del dominio', () => {
    const { estado, eventoId } = estadoDesdeServidor(crudo);
    expect(eventoId).toBe('ev-1');
    expect(estado.serverNow).toBe('2026-10-22T20:00:00.000Z');
    expect(estado.filas[0]).toEqual({
      id: 1,
      seccion: 'centro',
      numero: 3,
      fragmentada: true,
      verificadaEn: null,
      tramos: [
        { id: 11, orden: 1, tipo: 'publico', capacidad: 8, ocupados: 2, etiqueta: null },
        { id: 12, orden: 2, tipo: 'reservado', capacidad: 2, ocupados: 0, etiqueta: 'Coro' },
      ],
    });
    expect(estado.pendientes[0]).toEqual({
      id: 'p1',
      seccion: 'izquierda',
      cantidad: 4,
      sedeId: null,
      creadoEn: '2026-10-22T19:59:00.000Z',
    });
  });

  it('mapea sesion, reservas y sede_id', () => {
    const { estado } = estadoDesdeServidor({
      ...crudo,
      pendientes: [{ id: 'p2', seccion: 'centro', cantidad: 2, sede_id: 'catan', creado_en: 'x' }],
      sesion: { id: 's1', nombre: 'Domingo', inicio_at: 'a', libera_at: 'b' },
      reservas: [{ sede_id: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 1 }],
    });
    expect(estado.pendientes[0].sedeId).toBe('catan');
    expect(estado.sesion).toEqual({ id: 's1', nombre: 'Domingo', inicioAt: 'a', liberaAt: 'b' });
    expect(estado.reservas).toEqual([
      { sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 1, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 1 },
    ]);
  });

  it('mapea sector en reservas y sectores; tolera un servidor que no los manda', () => {
    const { estado } = estadoDesdeServidor({
      ...crudo,
      reservas: [
        { sede_id: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 3, sentados: 1, sector_id: 7, sector: 'A', fila_desde: 1, fila_hasta: 3, sentados_seccion: 4 },
      ],
      sectores: [{ id: 7, seccion: 'centro', nombre: 'A', fila_desde: 1, fila_hasta: 3, orden: 1 }],
    });
    expect(estado.reservas[0]).toEqual({
      sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 3, sentados: 1,
      sectorId: 7, sector: 'A', filaDesde: 1, filaHasta: 3, sentadosSeccion: 4,
    });
    expect(estado.sectores).toEqual([{ id: 7, seccion: 'centro', nombre: 'A', filaDesde: 1, filaHasta: 3, orden: 1 }]);
    expect(estadoDesdeServidor(crudo).estado.sectores).toEqual([]);
  });

  it('sin sesion en el crudo: sesion null y reservas vacías', () => {
    const { estado } = estadoDesdeServidor({ ...crudo, sesion: null });
    expect(estado.sesion).toBeNull();
    expect(estado.reservas).toEqual([]);
  });

  it('obtenerEstadoSalon llama a obtener_estado_salon con p_clave', async () => {
    rpc.mockResolvedValue({ data: crudo, error: null });
    const r = await obtenerEstadoSalon('K');
    expect(rpc).toHaveBeenCalledWith('obtener_estado_salon', { p_clave: 'K' });
    expect(r.estado.filas).toHaveLength(1);
  });

  it('obtenerEstadoSalon propaga ClaveInvalidaError', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'CLAVE_INVALIDA' } });
    await expect(obtenerEstadoSalon('mala')).rejects.toBeInstanceOf(ClaveInvalidaError);
  });
});

describe('mensajeDeError', () => {
  it.each([
    'SECCION_SIN_CUPO',
    'PENDIENTE_YA_RESUELTO',
    'TRAMO_SIN_CUPO',
    'TRAMO_RESERVADO',
    'SECCION_INCORRECTA',
    'TRAMO_VACIO',
    'RANGO_INVALIDO',
    'CLAVE_INVALIDA',
    'SECTORES_INVALIDOS',
    'SECTORES_CON_ASIGNACIONES',
    'FECHA_LIMITE_VENCIDA',
    'SECTOR_INVALIDO',
    'SEDE_INVALIDA',
  ])('%s tiene un mensaje propio en español', (code) => {
    const msg = mensajeDeError(code);
    expect(msg).not.toBe(mensajeDeError('CODIGO_QUE_NO_EXISTE'));
    expect(msg.length).toBeGreaterThan(5);
  });

  it('NOMBRE_INVALIDO sirve para sesión y sede: no nombra a ninguna', () => {
    expect(mensajeDeError('NOMBRE_INVALIDO')).not.toMatch(/sesi[óo]n/i);
  });

  it('un código desconocido da un mensaje genérico, sin filtrar el código crudo', () => {
    const msg = mensajeDeError('ALGO_RARO_DEL_SERVIDOR');
    expect(msg).not.toContain('ALGO_RARO_DEL_SERVIDOR');
    expect(msg).toMatch(/prob[áa]/i);
  });
});
