import { describe, expect, it } from 'vitest';
import type { Fila, Tramo } from './types';
import { colocarVirtual, sugerirUbicacion } from './sugerencia';

function tramo(
  id: number,
  capacidad: number,
  ocupados = 0,
  tipo: Tramo['tipo'] = 'publico',
): Tramo {
  return { id, orden: id, tipo, capacidad, ocupados, etiqueta: null };
}

function fila(
  id: number,
  numero: number,
  tramos: Tramo[],
  fragmentada = false,
): Fila {
  return {
    id,
    seccion: 'centro',
    numero,
    fragmentada,
    verificadaEn: null,
    tramos,
  };
}

describe('sugerirUbicacion', () => {
  it('prefiere la fila 1 sobre la 2', () => {
    const filas = [fila(20, 2, [tramo(21, 8)]), fila(10, 1, [tramo(11, 8)])];
    expect(sugerirUbicacion(filas, 3)).toEqual({ filaId: 10, tramoId: 11 });
  });

  it('salta una fila fragmentada para 2 pero no para 1', () => {
    const filas = [
      fila(10, 1, [tramo(11, 8, 2)], true),
      fila(20, 2, [tramo(21, 8)]),
    ];
    expect(sugerirUbicacion(filas, 2)).toEqual({ filaId: 20, tramoId: 21 });
    expect(sugerirUbicacion(filas, 1)).toEqual({ filaId: 10, tramoId: 11 });
  });

  it('elige el tramo de menor sobrante', () => {
    const filas = [fila(10, 1, [tramo(11, 5), tramo(12, 3)])];
    expect(sugerirUbicacion(filas, 3)).toEqual({ filaId: 10, tramoId: 12 });
  });

  it('en empate de libres elige el tramo de menor orden', () => {
    const filas = [fila(10, 1, [tramo(12, 4), tramo(11, 4)])];
    expect(sugerirUbicacion(filas, 3)).toEqual({ filaId: 10, tramoId: 11 });
  });

  it('ignora los tramos reservados', () => {
    const filas = [fila(10, 1, [tramo(11, 8, 0, 'reservado'), tramo(12, 4)])];
    expect(sugerirUbicacion(filas, 3)).toEqual({ filaId: 10, tramoId: 12 });
  });

  it('devuelve null si nada alcanza', () => {
    const filas = [fila(10, 1, [tramo(11, 4, 2)]), fila(20, 2, [tramo(21, 8, 6)])];
    expect(sugerirUbicacion(filas, 3)).toBeNull();
  });
});

describe('colocarVirtual', () => {
  it('suma ocupados en el tramo sin mutar la entrada', () => {
    const filas = [fila(10, 1, [tramo(11, 8, 1), tramo(12, 4)])];
    const copia = colocarVirtual(filas, { filaId: 10, tramoId: 11 }, 3);
    expect(copia[0].tramos[0].ocupados).toBe(4);
    expect(copia[0].tramos[1].ocupados).toBe(0);
    expect(filas[0].tramos[0].ocupados).toBe(1);
  });
});
