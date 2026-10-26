import type { Reserva, Sector } from '@/domain/sedes';
import type { EstadoSalon, Fila, Pendiente, Seccion, Tramo, TramoTipo } from '@/domain/types';
import { supabase } from '@/lib/supabase';

/** La clave de acceso no es válida (vencida o renovada). No se reintenta: la UI pide un QR nuevo. */
export class ClaveInvalidaError extends Error {
  constructor() {
    super('CLAVE_INVALIDA');
    this.name = 'ClaveInvalidaError';
  }
}

export type ResultadoRpc = { success: true; [k: string]: unknown } | { success: false; error: string };

/** Tiempo máximo de espera de una RPC. Pasado esto se trata como fallo de red (no queda nada colgado en vuelo). */
export const RPC_TIMEOUT_MS = 12_000;

/** La RPC no respondió a tiempo. Es un fallo de red común: revierte, avisa y resincroniza. */
export class RpcTimeoutError extends Error {
  constructor(nombre: string) {
    super(`La RPC ${nombre} superó ${RPC_TIMEOUT_MS} ms sin responder`);
    this.name = 'RpcTimeoutError';
  }
}

/**
 * Llama a una RPC y devuelve el `data` jsonb tal cual. Un error de PostgREST con
 * CLAVE_INVALIDA se convierte en ClaveInvalidaError; cualquier otro error se lanza como Error.
 * Si no hay respuesta en RPC_TIMEOUT_MS lanza RpcTimeoutError; una respuesta tardía se ignora
 * (la carrera ya se resolvió, nadie la consume).
 */
export async function rpcDatos<T = unknown>(nombre: string, params: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    timer = setTimeout(() => rechazar(new RpcTimeoutError(nombre)), RPC_TIMEOUT_MS);
  });
  let respuesta;
  try {
    // Promise.resolve: el builder de PostgREST es un thenable, no una Promise.
    respuesta = await Promise.race([Promise.resolve(supabase.rpc(nombre, params)), vencido]);
  } finally {
    clearTimeout(timer);
  }
  const { data, error } = respuesta;
  if (error) {
    if (typeof error.message === 'string' && error.message.includes('CLAVE_INVALIDA')) {
      throw new ClaveInvalidaError();
    }
    throw new Error(error.message || `Fallo la RPC ${nombre}`);
  }
  if (data === null || data === undefined) throw new Error(`La RPC ${nombre} no devolvió datos`);
  return data as T;
}

/** RPC de mutación: devuelve `{success:true,...}` o `{success:false,error}` sin tocarlo. */
export function llamarRpc(nombre: string, params: Record<string, unknown>): Promise<ResultadoRpc> {
  return rpcDatos<ResultadoRpc>(nombre, params);
}

// ---------------------------------------------------------------------------
// Mapeo snake_case (servidor / realtime) -> camelCase (dominio)
// ---------------------------------------------------------------------------

export interface TramoCrudo {
  id: number;
  orden: number;
  tipo: string;
  capacidad: number;
  ocupados: number;
  etiqueta: string | null;
}
export interface FilaCruda {
  id: number;
  seccion: string;
  numero: number;
  fragmentada: boolean;
  verificada_en: string | null;
  tramos?: TramoCrudo[];
}
export interface PendienteCrudo {
  id: string;
  seccion: string;
  cantidad: number;
  sede_id?: string | null;
  creado_en: string;
  /** El servidor resuelve por UPDATE ('pendiente' -> 'sentado' | 'cancelado'), nunca por DELETE. */
  estado?: string;
}
export interface EstadoCrudo {
  server_now: string;
  evento_id?: string | null;
  filas: FilaCruda[];
  pendientes: PendienteCrudo[];
  sesion?: { id: string; nombre: string; inicio_at: string; libera_at: string } | null;
  reservas?: Array<{
    sede_id: string;
    sede: string;
    seccion: string;
    cantidad: number;
    sentados: number;
    sector_id?: number | null;
    sector?: string | null;
    fila_desde?: number | null;
    fila_hasta?: number | null;
    sentados_seccion?: number;
  }>;
  sectores?: Array<{ id: number; seccion: string; nombre: string; fila_desde: number; fila_hasta: number; orden: number }>;
}

export function tramoDesdeServidor(t: TramoCrudo): Tramo {
  return {
    id: t.id,
    orden: t.orden,
    tipo: t.tipo as TramoTipo,
    capacidad: t.capacidad,
    ocupados: t.ocupados,
    etiqueta: t.etiqueta ?? null,
  };
}

export function filaDesdeServidor(f: FilaCruda): Fila {
  return {
    id: f.id,
    seccion: f.seccion as Seccion,
    numero: f.numero,
    fragmentada: f.fragmentada,
    verificadaEn: f.verificada_en ?? null,
    tramos: (f.tramos ?? []).map(tramoDesdeServidor),
  };
}

export function pendienteDesdeServidor(p: PendienteCrudo): Pendiente {
  return { id: p.id, seccion: p.seccion as Seccion, cantidad: p.cantidad, sedeId: p.sede_id ?? null, creadoEn: p.creado_en };
}

export function estadoDesdeServidor(raw: EstadoCrudo): { estado: EstadoSalon; eventoId: string | null } {
  return {
    eventoId: raw.evento_id ?? null,
    estado: {
      serverNow: raw.server_now,
      filas: raw.filas.map(filaDesdeServidor),
      pendientes: raw.pendientes.map(pendienteDesdeServidor),
      sesion: raw.sesion
        ? { id: raw.sesion.id, nombre: raw.sesion.nombre, inicioAt: raw.sesion.inicio_at, liberaAt: raw.sesion.libera_at }
        : null,
      reservas: (raw.reservas ?? []).map(
        (r): Reserva => ({
          sedeId: r.sede_id,
          sede: r.sede,
          seccion: r.seccion as Seccion,
          cantidad: r.cantidad,
          sentados: r.sentados,
          sectorId: r.sector_id ?? null,
          sector: r.sector ?? null,
          filaDesde: r.fila_desde ?? null,
          filaHasta: r.fila_hasta ?? null,
          sentadosSeccion: r.sentados_seccion ?? r.sentados,
        }),
      ),
      sectores: (raw.sectores ?? []).map(
        (x): Sector => ({
          id: x.id,
          seccion: x.seccion as Seccion,
          nombre: x.nombre,
          filaDesde: x.fila_desde,
          filaHasta: x.fila_hasta,
          orden: x.orden,
        }),
      ),
    },
  };
}

export async function obtenerEstadoSalon(clave: string) {
  const raw = await rpcDatos<EstadoCrudo>('obtener_estado_salon', { p_clave: clave });
  return estadoDesdeServidor(raw);
}

// ---------------------------------------------------------------------------
// Mensajes para el ujier
// ---------------------------------------------------------------------------

const MENSAJES: Record<string, string> = {
  SECCION_SIN_CUPO: 'Ya no queda lugar en esa sección.',
  PENDIENTE_YA_RESUELTO: 'Ese grupo ya fue resuelto por otro ujier.',
  TRAMO_SIN_CUPO: 'No hay lugar suficiente en ese tramo.',
  TRAMO_RESERVADO: 'Ese tramo está reservado.',
  SECCION_INCORRECTA: 'Ese grupo es de otra sección.',
  TRAMO_VACIO: 'Ese tramo no tiene a nadie sentado.',
  RANGO_INVALIDO: 'El número ingresado no es válido para ese tramo.',
  CLAVE_INVALIDA: 'Tu acceso venció. Pedí un QR nuevo.',
  NOMBRE_INVALIDO: 'Poné un nombre.',
  INICIO_INVALIDO: 'Poné el día y la hora de inicio.',
  SESION_INEXISTENTE: 'Esa sesión ya no existe.',
  RESERVAS_INVALIDAS: 'Hay reservas con errores. Revisalas y probá de nuevo.',
  SECTORES_INVALIDOS: 'Hay sectores con errores. Revisalos y probá de nuevo.',
  SECTORES_CON_ASIGNACIONES: 'No se pueden cambiar los sectores: ya hay reservas asignadas.',
  FECHA_LIMITE_VENCIDA: 'La fecha límite para confirmar ya venció.',
  SECTOR_INVALIDO: 'Ese sector no es válido para esa sección.',
  SEDE_INVALIDA: 'Esa sede no es válida.',
  ERROR_DE_RED: 'Sin conexión: no se pudo guardar. Se deshizo el cambio.',
};

export const MENSAJE_GENERICO = 'No se pudo completar la acción. Probá de nuevo.';

/** Traduce un código de error (del reducer o del servidor) a un mensaje en español; los desconocidos dan uno genérico. */
export function mensajeDeError(code: string): string {
  return Object.hasOwn(MENSAJES, code) ? MENSAJES[code] : MENSAJE_GENERICO;
}
