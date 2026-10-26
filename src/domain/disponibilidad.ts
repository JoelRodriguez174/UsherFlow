import type { Fila, Tramo } from './types';

/** Lugares libres de un tramo: los reservados nunca cuentan. */
export function libresTramo(t: Tramo): number {
  return t.tipo === 'reservado' ? 0 : Math.max(0, t.capacidad - t.ocupados);
}

function publicos(f: Fila): Tramo[] {
  return f.tramos.filter((t) => t.tipo === 'publico');
}

export function capacidadPublicaFila(f: Fila): number {
  return publicos(f).reduce((suma, t) => suma + t.capacidad, 0);
}

export function ocupadosFila(f: Fila): number {
  return publicos(f).reduce((suma, t) => suma + t.ocupados, 0);
}

export function libresFila(f: Fila): number {
  return f.tramos.reduce((suma, t) => suma + libresTramo(t), 0);
}

/** Mayor grupo que entra junto: el tramo con más libres; si la fila está fragmentada, 1 como máximo. */
export function grupoMaxJuntoFila(f: Fila): number {
  if (f.fragmentada) return Math.min(1, libresFila(f));
  return f.tramos.reduce((max, t) => Math.max(max, libresTramo(t)), 0);
}
