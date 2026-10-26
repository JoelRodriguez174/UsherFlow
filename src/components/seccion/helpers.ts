import { libresTramo } from "@/domain/disponibilidad";
import type { Fila, Tramo } from "@/domain/types";
import type { FilaVista } from "@/state/derivar";

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DIA_MS = 24 * HORA_MS;

/**
 * Texto de cuánto hace que se verificó una fila con los ojos.
 * `null` (o una fecha inválida) => "sin verificar"; menos de un minuto => "recién".
 */
export function haceCuanto(verificadaEn: string | null, ahoraServidorMs: number): string {
  if (verificadaEn === null) return "sin verificar";
  const t = Date.parse(verificadaEn);
  if (Number.isNaN(t)) return "sin verificar";
  const delta = Math.max(0, ahoraServidorMs - t);
  if (delta < MIN_MS) return "recién";
  if (delta < HORA_MS) return `hace ${Math.floor(delta / MIN_MS)} min`;
  if (delta < DIA_MS) return `hace ${Math.floor(delta / HORA_MS)} h`;
  return `hace ${Math.floor(delta / DIA_MS)} d`;
}

export function tramosPublicos(fila: Fila): Tramo[] {
  return fila.tramos.filter((t) => t.tipo === "publico");
}

/** Nombre legible de un tramo: su etiqueta, o "Tramo N" según su posición entre los públicos. */
export function nombreTramo(fila: Fila, tramo: Tramo): string {
  if (tramo.etiqueta) return tramo.etiqueta;
  if (tramo.tipo === "reservado") return "Reservado";
  const posicion = tramosPublicos(fila).findIndex((t) => t.id === tramo.id);
  return `Tramo ${posicion + 1}`;
}

export function textoLibres(n: number): string {
  return n === 1 ? "1 libre" : `${n} libres`;
}

export interface OpcionUbicacion {
  fila: Fila;
  tramo: Tramo;
  texto: string;
}

/** Tramos públicos donde el grupo entra junto, por número de fila. Es la lista de "Otra fila…". */
export function opcionesUbicacion(filas: FilaVista[], cantidad: number): OpcionUbicacion[] {
  return [...filas]
    .sort((a, b) => a.fila.numero - b.fila.numero)
    .flatMap(({ fila }) => {
      const publicos = tramosPublicos(fila);
      return publicos
        .filter((t) => libresTramo(t) >= cantidad)
        .map((tramo) => ({
          fila,
          tramo,
          texto: [
            `Fila ${fila.numero}`,
            ...(publicos.length > 1 ? [nombreTramo(fila, tramo)] : []),
            textoLibres(libresTramo(tramo)),
          ].join(" · "),
        }));
    });
}
