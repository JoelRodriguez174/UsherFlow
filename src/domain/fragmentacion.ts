import type { Fila } from './types';
import { ocupadosFila } from './disponibilidad';

/** Con este número de ocupados (o más) en la fila, al levantarse alguien quedan lugares sueltos. */
export const UMBRAL_FRAGMENTACION = 4;

export function fragmentaTrasLevantarse(f: Fila): boolean {
  return ocupadosFila(f) >= UMBRAL_FRAGMENTACION;
}
