import { SECCIONES, type Seccion, type TramoTipo } from './types';

export interface PlantillaTramo {
  tipo: TramoTipo;
  capacidad: number;
  etiqueta?: string;
}

export interface PlantillaFila {
  numero: number;
  tramos: PlantillaTramo[];
}

export type Plantilla = Record<Seccion, PlantillaFila[]>;

export interface DimensionSeccion {
  filas: number;
  sillas: number;
}

export interface RangoSector {
  desde: number;
  hasta: number;
}

/**
 * Calcula un rango nuevo sin superponer con los existentes dentro de [rMin, rMax].
 * 1) Si existe un hueco libre, usa el primer tramo contiguo libre.
 * 2) Si todo está cubierto, parte en dos el último sector que tenga al menos 2 filas.
 * 3) Si ya hay 1 sector por fila, devuelve null (no entran más sectores sin solape).
 */
export function calcularNuevoSectorSinSolape(
  existentes: ReadonlyArray<RangoSector>,
  rMin: number,
  rMax: number,
): { nuevo: RangoSector; indiceRecortar: number | null; nuevoHastaRecortado: number | null } | null {
  if (rMin > rMax) return null;

  // 1) Buscar primer tramo libre contiguo en [rMin, rMax]
  const cubiertas = new Set<number>();
  for (const s of existentes) {
    for (let f = Math.max(rMin, s.desde); f <= Math.min(rMax, s.hasta); f++) {
      cubiertas.add(f);
    }
  }
  let inicioHueco: number | null = null;
  for (let f = rMin; f <= rMax; f++) {
    if (!cubiertas.has(f)) {
      if (inicioHueco === null) inicioHueco = f;
    } else if (inicioHueco !== null) {
      return { nuevo: { desde: inicioHueco, hasta: f - 1 }, indiceRecortar: null, nuevoHastaRecortado: null };
    }
  }
  if (inicioHueco !== null) {
    return { nuevo: { desde: inicioHueco, hasta: rMax }, indiceRecortar: null, nuevoHastaRecortado: null };
  }

  // 2) Todo cubierto: buscar el último sector con >= 2 filas (preferimos el último para que sea predecible)
  for (let i = existentes.length - 1; i >= 0; i--) {
    const s = existentes[i];
    if (s.hasta - s.desde >= 1) {
      const mitad = Math.floor((s.desde + s.hasta) / 2);
      return {
        nuevo: { desde: mitad + 1, hasta: s.hasta },
        indiceRecortar: i,
        nuevoHastaRecortado: mitad,
      };
    }
  }

  return null;
}

/** Devuelve los índices de sectores cuyo rango se superpone con algún otro de la misma lista. */
export function indicesConSolape(sectores: ReadonlyArray<RangoSector | null>): Set<number> {
  const solapados = new Set<number>();
  for (let i = 0; i < sectores.length; i++) {
    const a = sectores[i];
    if (!a) continue;
    for (let j = i + 1; j < sectores.length; j++) {
      const b = sectores[j];
      if (!b) continue;
      if (a.desde <= b.hasta && b.desde <= a.hasta) {
        solapados.add(i);
        solapados.add(j);
      }
    }
  }
  return solapados;
}

/** Parte el rango inclusivo [desde, hasta] en N subrangos contiguos sin huecos ni solapes. */
export function partirRango(desde: number, hasta: number, partes: number): Array<[number, number]> | null {
  const n = hasta - desde + 1;
  if (!Number.isInteger(partes) || partes < 2 || !(n >= partes)) return null;
  const res: Array<[number, number]> = [];
  let inicio = desde;
  let restante = n;
  for (let i = 0; i < partes; i++) {
    const tam = Math.floor(restante / (partes - i));
    res.push([inicio, inicio + tam - 1]);
    inicio += tam;
    restante -= tam;
  }
  return res;
}

/** Construye una plantilla con filas públicas uniformes por sección (0 filas omite la sección). */
export function construirPlantillaUniforme(config: Record<Seccion, DimensionSeccion>): Plantilla {
  const resultado = {} as Plantilla;
  for (const seccion of SECCIONES) {
    const { filas, sillas } = config[seccion];
    const nFilas = Math.max(0, Math.floor(filas));
    const nSillas = Math.max(1, Math.floor(sillas));
    resultado[seccion] = Array.from({ length: nFilas }, (_, i) => ({
      numero: i + 1,
      tramos: [{ tipo: 'publico', capacidad: nSillas }],
    }));
  }
  return resultado;
}

/** Devuelve la lista de errores de la plantilla; vacía = válida. */
export function validarPlantilla(p: Plantilla): string[] {
  const errores: string[] = [];

  for (const seccion of SECCIONES) {
    const filas = p[seccion] ?? [];
    const vistos = new Set<number>();

    for (const fila of filas) {
      const ref = `${seccion} fila ${fila.numero}`;

      if (vistos.has(fila.numero)) {
        errores.push(`${ref}: número de fila repetido`);
      }
      vistos.add(fila.numero);

      if (fila.tramos.length === 0) {
        errores.push(`${ref}: la fila no tiene tramos`);
      }

      fila.tramos.forEach((tramo, i) => {
        const refTramo = `${ref} tramo ${i + 1}`;
        if (!Number.isInteger(tramo.capacidad) || tramo.capacidad <= 0) {
          errores.push(`${refTramo}: la capacidad debe ser un entero mayor a 0`);
        }
        if (tramo.tipo === 'reservado' && !tramo.etiqueta?.trim()) {
          errores.push(`${refTramo}: un tramo reservado requiere etiqueta`);
        }
      });
    }
  }

  return errores;
}
