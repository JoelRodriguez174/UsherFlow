import type { Pendiente } from './types';

/** Un pendiente sin sentar tras este tiempo (según el reloj del servidor) se marca en ámbar. */
export const UMBRAL_AMBAR_MS = 180_000;

/**
 * Diferencia entre el reloj del servidor y el local, asumiendo que la respuesta
 * viajó la mitad del RTT: offset = serverEpoch + round(rtt / 2) − clienteFin.
 */
export function calcularOffset(
  serverNowIso: string,
  clienteInicioMs: number,
  clienteFinMs: number,
): number {
  const rtt = clienteFinMs - clienteInicioMs;
  return Date.parse(serverNowIso) + Math.round(rtt / 2) - clienteFinMs;
}

export function ahoraServidor(relojLocalMs: number, offsetMs: number): number {
  return relojLocalMs + offsetMs;
}

export function pendienteEsAmbar(p: Pendiente, ahoraServidorMs: number): boolean {
  return ahoraServidorMs - Date.parse(p.creadoEn) >= UMBRAL_AMBAR_MS;
}
