import { describe, expect, it } from 'vitest';
import type { Fila, Pendiente, Tramo } from './types';
import {
  apartado,
  apartarDelFondo,
  liberada,
  quedan,
  sectorDeFila,
  type Reserva,
  type Sector,
  type SesionEnCurso,
} from './sedes';
import { resumenSeccion } from './resumen';

const sesion: SesionEnCurso = {
  id: 's1',
  nombre: 'Sábado',
  inicioAt: '2026-10-24T20:00:00Z',
  liberaAt: '2026-10-24T20:20:00Z',
};
const liberaMs = Date.parse(sesion.liberaAt);
const antes = liberaMs - 60_000;

const catan: Reserva = { sedeId: 'c', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 };
const lomas: Reserva = { sedeId: 'l', sede: 'Lomas', seccion: 'centro', cantidad: 2, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 };
const reservas = [catan, lomas];

function pend(id: string, sedeId: string | null, cantidad: number): Pendiente {
  return { id, seccion: 'centro', cantidad, creadoEn: '2026-10-24T20:00:00Z', sedeId };
}

function tramo(id: number, capacidad: number, ocupados = 0): Tramo {
  return { id, orden: id, tipo: 'publico', capacidad, ocupados, etiqueta: null };
}
function fila(id: number, numero: number, tramos: Tramo[]): Fila {
  return { id, seccion: 'centro', numero, fragmentada: false, verificadaEn: null, tramos };
}
const tres = () => [fila(1, 1, [tramo(1, 8)]), fila(2, 2, [tramo(2, 8)]), fila(3, 3, [tramo(3, 8)])];

describe('apartado', () => {
  it('suma lo que queda de todas las sedes, o de las otras', () => {
    expect(apartado(reservas, [], 'centro', sesion, antes, null)).toBe(8);
    expect(apartado(reservas, [], 'centro', sesion, antes, 'c')).toBe(2);
  });

  it('ignora reservas de otras secciones', () => {
    const otra: Reserva = { ...lomas, seccion: 'derecha' };
    expect(apartado([catan, otra], [], 'centro', sesion, antes, null)).toBe(6);
  });

  it('descuenta pendientes y nunca baja de 0', () => {
    const p = [pend('a', 'c', 4)];
    expect(quedan(catan, p)).toBe(2);
    const mas = [...p, pend('b', 'c', 3)];
    expect(quedan(catan, mas)).toBe(0);
    expect(apartado(reservas, mas, 'centro', sesion, antes, null)).toBe(2);
  });

  it('los sentados ya cuentan como consumidos', () => {
    expect(quedan({ ...catan, sentados: 5 }, [pend('a', 'c', 1)])).toBe(0);
  });

  it('liberada: 1 ms antes no, justo en liberaAt sí; sin sesión sí', () => {
    expect(liberada(sesion, liberaMs - 1)).toBe(false);
    expect(liberada(sesion, liberaMs)).toBe(true);
    expect(liberada(null, 0)).toBe(true);
    expect(apartado(reservas, [], 'centro', null, antes, null)).toBe(0);
    expect(apartado(reservas, [], 'centro', sesion, liberaMs, null)).toBe(0);
  });
});

describe('apartarDelFondo', () => {
  it('llena desde la fila de número más alto sin mutar la entrada', () => {
    const filas = tres();
    const r = apartarDelFondo(filas, 10);
    expect(r.find((f) => f.id === 3)!.tramos[0].ocupados).toBe(8);
    expect(r.find((f) => f.id === 2)!.tramos[0].ocupados).toBe(2);
    expect(r.find((f) => f.id === 1)).toBe(filas[0]);
    expect(filas[2].tramos[0].ocupados).toBe(0);
  });
});

describe('resumenSeccion con apartado', () => {
  it('libres 14 y grupo máximo 8', () => {
    expect(resumenSeccion(tres(), [], 10)).toEqual({ libres: 14, grupoMaxJunto: 8 });
  });
});

const SIN = { sectorId: null, sector: null, filaDesde: null, filaHasta: null } as const;
const sector = (id: number, seccion: Sector['seccion'], filaDesde: number, filaHasta: number): Sector => ({
  id, seccion, nombre: `S${id}`, filaDesde, filaHasta, orden: id,
});

describe('sectorDeFila', () => {
  const sectores = [sector(1, 'centro', 1, 3), sector(2, 'centro', 4, 6), sector(3, 'centro', 7, 9)];
  it('resuelve bordes de rango, filas fuera y otra sección', () => {
    expect(sectorDeFila(sectores, 'centro', 1)?.id).toBe(1);
    expect(sectorDeFila(sectores, 'centro', 3)?.id).toBe(1);
    expect(sectorDeFila(sectores, 'centro', 4)?.id).toBe(2);
    expect(sectorDeFila(sectores, 'centro', 9)?.id).toBe(3);
    expect(sectorDeFila(sectores, 'centro', 10)).toBeNull();
    expect(sectorDeFila(sectores, 'centro', 0)).toBeNull();
    expect(sectorDeFila(sectores, 'izquierda', 2)).toBeNull();
  });
});

describe('reservas con sector', () => {
  const rs = (id: number, cantidad: number, sentados: number, sentadosSeccion: number): Reserva => ({
    sedeId: 'c', sede: 'Catán', seccion: 'centro', cantidad, sentados,
    sectorId: id, sector: `S${id}`, filaDesde: 1, filaHasta: 3, sentadosSeccion,
  });

  it('quedan por sector ignora los pendientes; sin sector los descuenta', () => {
    expect(quedan(rs(1, 3, 1, 1), [pend('a', 'c', 2)])).toBe(2);
    expect(quedan(rs(1, 3, 5, 5), [])).toBe(0);
    expect(quedan({ ...catan, ...SIN, sentadosSeccion: 0 }, [pend('a', 'c', 2)])).toBe(4);
  });

  it('apartado agrupa por sede: dos sectores en la misma sección (6 - sentados), no 2', () => {
    const dos = [rs(1, 3, 0, 0), rs(2, 3, 0, 0)];
    expect(apartado(dos, [], 'centro', sesion, antes, null)).toBe(6);
    // Catan sienta 2 (en el sector 1): el apartado pasa a 4
    const sentando = [rs(1, 3, 2, 2), rs(2, 3, 0, 2)];
    expect(apartado(sentando, [], 'centro', sesion, antes, null)).toBe(4);
    // un pendiente vivo de la sede tambien consume el pozo de la seccion
    expect(apartado(sentando, [pend('a', 'c', 1)], 'centro', sesion, antes, null)).toBe(3);
    expect(apartado(sentando, [], 'centro', sesion, antes, 'c')).toBe(0);
  });

  it('el pozo de la sede nunca baja de 0', () => {
    expect(apartado([rs(1, 3, 3, 9)], [], 'centro', sesion, antes, null)).toBe(0);
  });
});
