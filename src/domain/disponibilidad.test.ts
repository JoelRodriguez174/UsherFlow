import { describe, expect, it } from 'vitest';
import type { Fila, Tramo } from './types';
import {
  capacidadPublicaFila,
  grupoMaxJuntoFila,
  libresFila,
  libresTramo,
  ocupadosFila,
} from './disponibilidad';

function tramo(
  orden: number,
  tipo: Tramo['tipo'],
  capacidad: number,
  ocupados = 0,
): Tramo {
  return { id: orden, orden, tipo, capacidad, ocupados, etiqueta: null };
}

function fila(tramos: Tramo[], fragmentada = false): Fila {
  return {
    id: 1,
    seccion: 'centro',
    numero: 1,
    fragmentada,
    verificadaEn: null,
    tramos,
  };
}

const mixta = (fragmentada = false) =>
  fila(
    [tramo(1, 'publico', 3, 1), tramo(2, 'reservado', 2), tramo(3, 'publico', 3, 0)],
    fragmentada,
  );

describe('libresTramo', () => {
  it('tramo reservado → 0', () => {
    expect(libresTramo(tramo(1, 'reservado', 2))).toBe(0);
  });

  it('tramo público → capacidad - ocupados', () => {
    expect(libresTramo(tramo(1, 'publico', 3, 1))).toBe(2);
  });
});

describe('fila [pub 3 (1)][res 2][pub 3 (0)]', () => {
  it('libresFila = 5', () => expect(libresFila(mixta())).toBe(5));
  it('capacidadPublicaFila = 6', () => expect(capacidadPublicaFila(mixta())).toBe(6));
  it('ocupadosFila = 1', () => expect(ocupadosFila(mixta())).toBe(1));
  it('grupoMaxJuntoFila = 3', () => expect(grupoMaxJuntoFila(mixta())).toBe(3));
});

describe('grupoMaxJuntoFila', () => {
  it('fragmentada → 1', () => {
    expect(grupoMaxJuntoFila(mixta(true))).toBe(1);
  });

  it('fragmentada sin libres → 0', () => {
    const f = fila([tramo(1, 'publico', 3, 3)], true);
    expect(grupoMaxJuntoFila(f)).toBe(0);
  });

  it('sin libres → 0', () => {
    const f = fila([tramo(1, 'publico', 3, 3), tramo(2, 'reservado', 2)]);
    expect(grupoMaxJuntoFila(f)).toBe(0);
  });

  it('un solo tramo público de 8 con 3 ocupados → 5', () => {
    expect(grupoMaxJuntoFila(fila([tramo(1, 'publico', 8, 3)]))).toBe(5);
  });
});
