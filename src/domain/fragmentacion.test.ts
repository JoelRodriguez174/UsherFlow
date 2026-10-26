import { describe, expect, it } from 'vitest';
import type { Fila } from './types';
import { UMBRAL_FRAGMENTACION, fragmentaTrasLevantarse } from './fragmentacion';

function filaCon(ocupados: number): Fila {
  return {
    id: 1,
    seccion: 'centro',
    numero: 1,
    fragmentada: false,
    verificadaEn: null,
    tramos: [{ id: 1, orden: 1, tipo: 'publico', capacidad: 8, ocupados, etiqueta: null }],
  };
}

describe('fragmentaTrasLevantarse', () => {
  it('el umbral es 4', () => {
    expect(UMBRAL_FRAGMENTACION).toBe(4);
  });

  it('con 4 ocupados es true', () => {
    expect(fragmentaTrasLevantarse(filaCon(4))).toBe(true);
  });

  it('con 3 ocupados es false', () => {
    expect(fragmentaTrasLevantarse(filaCon(3))).toBe(false);
  });

  it('cuenta solo tramos públicos', () => {
    const f = filaCon(2);
    f.tramos.push({ id: 2, orden: 2, tipo: 'reservado', capacidad: 4, ocupados: 4, etiqueta: null });
    expect(fragmentaTrasLevantarse(f)).toBe(false);
  });
});
