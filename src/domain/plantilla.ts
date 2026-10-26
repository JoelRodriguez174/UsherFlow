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
