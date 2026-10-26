import type { Fila } from './types';
import { libresTramo } from './disponibilidad';

export interface Ubicacion {
  filaId: number;
  tramoId: number;
}

/**
 * Sugiere dónde sentar a un grupo: fila de número más bajo que lo admita
 * (las fragmentadas se saltan para grupos de 2 o más) y, dentro de ella,
 * el tramo público con menos sobrante que alcance.
 */
export function sugerirUbicacion(filas: Fila[], cantidad: number): Ubicacion | null {
  const ordenadas = [...filas].sort((a, b) => a.numero - b.numero);
  for (const fila of ordenadas) {
    if (fila.fragmentada && cantidad > 1) continue;
    let mejor: { tramoId: number; libres: number; orden: number } | null = null;
    for (const t of fila.tramos) {
      if (t.tipo !== 'publico') continue;
      const libres = libresTramo(t);
      if (libres < cantidad) continue;
      if (
        mejor === null ||
        libres < mejor.libres ||
        (libres === mejor.libres && t.orden < mejor.orden)
      ) {
        mejor = { tramoId: t.id, libres, orden: t.orden };
      }
    }
    if (mejor) return { filaId: fila.id, tramoId: mejor.tramoId };
  }
  return null;
}

/** Devuelve una copia de las filas con el grupo ya sentado; no muta la entrada. */
export function colocarVirtual(filas: Fila[], u: Ubicacion, cantidad: number): Fila[] {
  return filas.map((f) =>
    f.id !== u.filaId
      ? f
      : {
          ...f,
          tramos: f.tramos.map((t) =>
            t.id === u.tramoId
              ? { ...t, ocupados: Math.min(t.capacidad, t.ocupados + cantidad) }
              : t,
          ),
        },
  );
}
