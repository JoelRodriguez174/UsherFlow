import type { Seccion } from './types';

export type EstadoSectorReserva = 'disponible' | 'pocos' | 'agotado' | 'asignado';

export type SectorBasico = {
  id: number;
  seccion: Seccion;
  nombre: string;
};

export type FilaReservaSede = {
  seccion: Seccion;
  sesion: string;
  cantidad: number;
  sector: string;
};

/** Umbral visual de "Quedan pocos": 20% o menos de la capacidad total del sector. */
const UMBRAL_POCOS = 0.2;

/** Lugares que siguen quedando libres en el sector después de descontar lo elegido por esta sede. */
export function libresDelSector(disponibles: number, cantidadElegida: number): number {
  return Math.max(0, disponibles - Math.max(0, cantidadElegida));
}

/** Estado visual de un sector en el mapa de reservas del pastor. */
export function estadoSectorReserva(
  disponibles: number,
  capacidad: number,
  cantidadElegida: number,
): EstadoSectorReserva {
  if (cantidadElegida > 0) return 'asignado';
  if (disponibles <= 0) return 'agotado';
  if (capacidad > 0 && disponibles / capacidad <= UMBRAL_POCOS) return 'pocos';
  return 'disponible';
}

/** Acota la cantidad pedida al rango válido [0, disponibles]. */
export function acotarCantidad(valor: number, disponibles: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(Math.max(0, Math.floor(valor)), Math.max(0, disponibles));
}

/** Verdadero si el borrador de la sesión difiere de lo confirmado en el servidor. */
export function hayCambiosEnSesion(
  confirmado: Record<number, number>,
  borrador: Record<number, number>,
): boolean {
  const ids = new Set([...Object.keys(confirmado), ...Object.keys(borrador)].map(Number));
  for (const id of ids) {
    if ((confirmado[id] ?? 0) !== (borrador[id] ?? 0)) return true;
  }
  return false;
}

/** Total de lugares y cantidad de sectores elegidos en una sesión. */
export function resumenSesion(cantidades: Record<number, number>): {
  totalLugares: number;
  cantidadSectores: number;
} {
  let totalLugares = 0;
  let cantidadSectores = 0;
  for (const cant of Object.values(cantidades)) {
    if (cant > 0) {
      totalLugares += cant;
      cantidadSectores += 1;
    }
  }
  return { totalLugares, cantidadSectores };
}

/** Arma las filas que espera `guardar_reservas_sede` para una sesión, omitiendo sectores en 0. */
export function filasParaGuardar(
  sectores: SectorBasico[],
  sesionNombre: string,
  cantidades: Record<number, number>,
): FilaReservaSede[] {
  return sectores
    .filter((s) => (cantidades[s.id] ?? 0) > 0)
    .map((s) => ({
      seccion: s.seccion,
      sesion: sesionNombre,
      cantidad: cantidades[s.id],
      sector: s.nombre,
    }));
}

/**
 * Copia la distribución de una sesión a otra respetando la disponibilidad real de cada sector en destino.
 * Devuelve el borrador resultante y cuántos sectores debieron ajustarse (o quedar en 0) por falta de lugar.
 */
export function copiarDistribucionASesion(
  origen: Record<number, number>,
  disponiblesDestino: Record<number, number>,
): { resultado: Record<number, number>; ajustados: number } {
  const resultado: Record<number, number> = {};
  let ajustados = 0;
  for (const [idStr, cant] of Object.entries(origen)) {
    if (cant <= 0) continue;
    const id = Number(idStr);
    const max = Math.max(0, disponiblesDestino[id] ?? 0);
    const final = Math.min(cant, max);
    if (final < cant) ajustados += 1;
    if (final > 0) resultado[id] = final;
  }
  return { resultado, ajustados };
}
