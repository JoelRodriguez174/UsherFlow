import { describe, expect, it } from 'vitest';
import type { Fila, Pendiente, Tramo } from './types';
import { resumenSeccion } from './resumen';

function tramo(id: number, capacidad: number, ocupados = 0): Tramo {
  return { id, orden: id, tipo: 'publico', capacidad, ocupados, etiqueta: null };
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

function pendiente(id: string, cantidad: number, creadoEn: string): Pendiente {
  return { id, seccion: 'centro', cantidad, creadoEn, sedeId: null };
}

const dosVacias = () => [fila(1, 1, [tramo(1, 8)]), fila(2, 2, [tramo(2, 8)])];

describe('resumenSeccion', () => {
  it('sin pendientes devuelve libres totales y el mayor grupo', () => {
    expect(resumenSeccion(dosVacias(), [])).toEqual({ libres: 16, grupoMaxJunto: 8 });
  });

  it('un pendiente de 3 en dos filas vacías: libres 13 y grupo 8', () => {
    const r = resumenSeccion(dosVacias(), [pendiente('a', 3, '2026-01-01T10:00:00Z')]);
    expect(r).toEqual({ libres: 13, grupoMaxJunto: 8 });
  });

  it('un pendiente de 8 deja libres 8', () => {
    const r = resumenSeccion(dosVacias(), [pendiente('a', 8, '2026-01-01T10:00:00Z')]);
    expect(r.libres).toBe(8);
    expect(r.grupoMaxJunto).toBe(8);
  });

  it('coloca los pendientes en orden de creación', () => {
    const filas = [fila(1, 1, [tramo(1, 8)]), fila(2, 2, [tramo(2, 4)])];
    const r = resumenSeccion(filas, [
      pendiente('b', 4, '2026-01-01T10:05:00Z'),
      pendiente('a', 6, '2026-01-01T10:00:00Z'),
    ]);
    // a (6) va a la fila 1 (quedan 2); b (4) va al tramo de la fila 2.
    expect(r).toEqual({ libres: 2, grupoMaxJunto: 2 });
  });

  it('libres nunca baja de 0', () => {
    const filas = [fila(1, 1, [tramo(1, 2)])];
    const r = resumenSeccion(filas, [pendiente('a', 5, '2026-01-01T10:00:00Z')]);
    expect(r.libres).toBe(0);
  });

  it('un pendiente sin ubicación se omite pero igual resta de libres', () => {
    const filas = [fila(1, 1, [tramo(1, 4), tramo(2, 4)])];
    const r = resumenSeccion(filas, [pendiente('a', 5, '2026-01-01T10:00:00Z')]);
    expect(r).toEqual({ libres: 3, grupoMaxJunto: 4 });
  });

  it('no muta las filas de entrada', () => {
    const filas = dosVacias();
    resumenSeccion(filas, [pendiente('a', 3, '2026-01-01T10:00:00Z')]);
    expect(filas[0].tramos[0].ocupados).toBe(0);
  });

  it('Review Focus 1: 3 libres sueltos en fila fragmentada dan grupoMaxJunto 1', () => {
    const filas = [fila(1, 1, [tramo(1, 8, 5)], true)];
    expect(resumenSeccion(filas, [])).toEqual({ libres: 3, grupoMaxJunto: 1 });
  });
});
