import { describe, expect, it } from 'vitest';
import type { Reserva, SesionEnCurso } from '@/domain/sedes';
import type { Fila, Pendiente, Seccion, Tramo } from '@/domain/types';
import { UMBRAL_AMBAR_MS } from '@/domain/pendientes';
import { estadoInicial, type SalonState } from './salonReducer';
import { derivarSalon } from './derivar';

const AHORA = Date.parse('2026-10-22T20:00:00.000Z');

function tramo(id: number, capacidad: number, ocupados = 0, tipo: Tramo['tipo'] = 'publico'): Tramo {
  return { id, orden: id, tipo, capacidad, ocupados, etiqueta: null };
}
function fila(id: number, seccion: Seccion, numero: number, tramos: Tramo[], fragmentada = false): Fila {
  return { id, seccion, numero, fragmentada, verificadaEn: null, tramos };
}
function pendiente(id: string, seccion: Seccion, cantidad: number, creadoEnMs: number): Pendiente {
  return { id, seccion, cantidad, sedeId: null, creadoEn: new Date(creadoEnMs).toISOString() };
}
function estado(filas: Fila[], pendientes: Pendiente[] = [], offsetMs = 0): SalonState {
  return {
    ...estadoInicial,
    cargado: true,
    offsetMs,
    filas: Object.fromEntries(filas.map((f) => [f.id, f])),
    pendientes: Object.fromEntries(pendientes.map((p) => [p.id, p])),
  };
}

describe('derivarSalon: estructura', () => {
  it('agrupa las filas por sección, ordenadas por número, con libres / grupo máximo / llena', () => {
    const s = estado([
      fila(2, 'centro', 2, [tramo(21, 4, 4)]),
      fila(1, 'centro', 1, [tramo(11, 6, 2), tramo(12, 3, 0, 'reservado')]),
      fila(3, 'izquierda', 1, [tramo(31, 5, 1)], true),
    ]);
    const d = derivarSalon(s, AHORA);
    expect(d.filasPorSeccion.centro.map((v) => v.fila.id)).toEqual([1, 2]);
    expect(d.filasPorSeccion.derecha).toEqual([]);
    const [f1, f2] = d.filasPorSeccion.centro;
    expect(f1).toMatchObject({ libres: 4, grupoMaxJunto: 4, estaLlena: false });
    expect(f2).toMatchObject({ libres: 0, grupoMaxJunto: 0, estaLlena: true });
    expect(d.filasPorSeccion.izquierda[0]).toMatchObject({ libres: 4, grupoMaxJunto: 1, estaLlena: false });
  });

  it('el resumen descuenta los pendientes de la sección', () => {
    const s = estado([fila(1, 'centro', 1, [tramo(11, 6, 0)])], [pendiente('p1', 'centro', 2, AHORA)]);
    const d = derivarSalon(s, AHORA);
    expect(d.resumenPorSeccion.centro.libres).toBe(4);
    expect(d.resumenPorSeccion.izquierda).toEqual({ libres: 0, grupoMaxJunto: 0 });
  });

  it('ocupación: ocupados y capacidad públicos y porcentaje redondeado', () => {
    const s = estado([
      fila(1, 'centro', 1, [tramo(11, 6, 3), tramo(12, 4, 4, 'reservado')]),
      fila(2, 'derecha', 1, [tramo(21, 4, 1)]),
    ]);
    expect(derivarSalon(s, AHORA).ocupacion).toEqual({ ocupados: 4, capacidad: 10, porcentaje: 40 });
  });

  it('sin capacidad el porcentaje es 0', () => {
    expect(derivarSalon(estado([]), AHORA).ocupacion).toEqual({ ocupados: 0, capacidad: 0, porcentaje: 0 });
  });
});

describe('derivarSalon: memoización', () => {
  it('con otro ahoraLocalMs devuelve las mismas FilaVista (toBe)', () => {
    const s = estado([fila(1, 'centro', 1, [tramo(11, 6)]), fila(2, 'izquierda', 1, [tramo(21, 4)])]);
    const a = derivarSalon(s, AHORA);
    const b = derivarSalon(s, AHORA + 5_000);
    expect(b.filasPorSeccion.centro[0]).toBe(a.filasPorSeccion.centro[0]);
    expect(b.filasPorSeccion.izquierda[0]).toBe(a.filasPorSeccion.izquierda[0]);
  });

  it('el tick no recalcula filas ni resumen: solo los pendientes', () => {
    const s = estado([fila(1, 'centro', 1, [tramo(11, 6)])], [pendiente('p1', 'centro', 2, AHORA)]);
    const a = derivarSalon(s, AHORA);
    const b = derivarSalon(s, AHORA + 1_000);
    expect(b.filasPorSeccion).toBe(a.filasPorSeccion);
    expect(b.resumenPorSeccion).toBe(a.resumenPorSeccion);
    expect(b.ocupacion).toBe(a.ocupacion);
    expect(b.pendientesPorSeccion).not.toBe(a.pendientesPorSeccion);
  });

  it('cambiar una sola fila renueva solo la FilaVista de esa fila', () => {
    const f1 = fila(1, 'centro', 1, [tramo(11, 6)]);
    const f2 = fila(2, 'centro', 2, [tramo(21, 6)]);
    const s1 = estado([f1, f2]);
    const f2b: Fila = { ...f2, tramos: [{ ...f2.tramos[0], ocupados: 2 }] };
    const s2: SalonState = { ...s1, filas: { ...s1.filas, [f2.id]: f2b } };
    const a = derivarSalon(s1, AHORA);
    const b = derivarSalon(s2, AHORA);
    expect(b.filasPorSeccion.centro[0]).toBe(a.filasPorSeccion.centro[0]);
    expect(b.filasPorSeccion.centro[1]).not.toBe(a.filasPorSeccion.centro[1]);
    expect(b.filasPorSeccion.centro[1].libres).toBe(4);
  });
});

describe('derivarSalon: pendientes y ámbar', () => {
  it('ordena por llegada y marca ámbar al superar 180 000 ms', () => {
    const s = estado(
      [fila(1, 'centro', 1, [tramo(11, 20)])],
      [pendiente('nuevo', 'centro', 1, AHORA - 10_000), pendiente('viejo', 'centro', 1, AHORA - UMBRAL_AMBAR_MS)],
    );
    const lista = derivarSalon(s, AHORA).pendientesPorSeccion.centro;
    expect(lista.map((v) => v.pendiente.id)).toEqual(['viejo', 'nuevo']);
    expect(lista.map((v) => v.ambar)).toEqual([true, false]);
  });

  it('pasa a ámbar al avanzar el reloj local', () => {
    const s = estado([fila(1, 'centro', 1, [tramo(11, 20)])], [pendiente('p', 'centro', 1, AHORA)]);
    expect(derivarSalon(s, AHORA + UMBRAL_AMBAR_MS - 1).pendientesPorSeccion.centro[0].ambar).toBe(false);
    expect(derivarSalon(s, AHORA + UMBRAL_AMBAR_MS).pendientesPorSeccion.centro[0].ambar).toBe(true);
  });

  it('respeta el offset del estado (reloj local atrasado respecto del servidor)', () => {
    // El reloj local va 60 s atrás: sin offset todavía no sería ámbar; con +60 000 ya lo es.
    const p = pendiente('p', 'centro', 1, AHORA);
    const filas = [fila(1, 'centro', 1, [tramo(11, 20)])];
    const local = AHORA + UMBRAL_AMBAR_MS - 60_000;
    expect(derivarSalon(estado(filas, [p], 0), local).pendientesPorSeccion.centro[0].ambar).toBe(false);
    expect(derivarSalon(estado(filas, [p], 60_000), local).pendientesPorSeccion.centro[0].ambar).toBe(true);
  });
});

describe('derivarSalon: sedes y liberación', () => {
  const LIBERA = Date.parse('2026-10-22T20:40:00.000Z');
  const sesion: SesionEnCurso = {
    id: 's1',
    nombre: 'Domingo',
    inicioAt: '2026-10-22T21:00:00.000Z',
    liberaAt: new Date(LIBERA).toISOString(),
  };
  const reservas: Reserva[] = [
    { sedeId: 'ramos', sede: 'Ramos', seccion: 'centro', cantidad: 2, sentados: 2, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 2 },
    { sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 },
  ];
  // 10 libres en el centro; 6 de Catán apartados (Ramos ya consumió todo) => 4... salvo que Ramos tenga 2 sin usar
  const base = (r: Reserva[] = reservas): SalonState => ({
    ...estado([fila(1, 'centro', 1, [tramo(11, 10)])]),
    sesion,
    reservas: r,
  });

  it('antes de liberaAt aparta; después, con el mismo estado, no (reloj corregido por offset)', () => {
    const s = base([
      { sedeId: 'ramos', sede: 'Ramos', seccion: 'centro', cantidad: 2, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 },
      reservas[1],
    ]);
    const antes = derivarSalon(s, LIBERA - 60_000);
    expect(antes.liberado).toBe(false);
    expect(antes.resumenPorSeccion.centro.libres).toBe(2);
    const despues = derivarSalon(s, LIBERA + 60_000);
    expect(despues.liberado).toBe(true);
    expect(despues.resumenPorSeccion.centro.libres).toBe(10);
    // el offset mueve el reloj: local 1 min antes + offset 2 min => ya liberado
    expect(derivarSalon({ ...s, offsetMs: 120_000 }, LIBERA - 60_000).liberado).toBe(true);
  });

  it('resumenParaSede no descuenta el apartado de esa sede', () => {
    const s = base([
      { sedeId: 'ramos', sede: 'Ramos', seccion: 'centro', cantidad: 2, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 },
      reservas[1],
    ]);
    const d = derivarSalon(s, LIBERA - 60_000);
    expect(d.resumenParaSede(null)).toBe(d.resumenPorSeccion);
    expect(d.resumenParaSede('catan').centro.libres).toBe(8);
  });

  it('sedes: ordenadas por nombre, con consumido, quedan y completo', () => {
    const d = derivarSalon(base(), LIBERA - 60_000);
    expect(d.sedes.map((v) => v.nombre)).toEqual(['Catán', 'Ramos']);
    expect(d.sedes[0].porSeccion.centro).toEqual({ cantidad: 6, consumido: 0, quedan: 6, sectores: [expect.objectContaining({ sectorId: null, cantidad: 6, quedan: 6 })] });
    expect(d.sedes[0].completo).toBe(false);
    expect(d.sedes[1].porSeccion.centro).toEqual({ cantidad: 2, consumido: 2, quedan: 0, sectores: [expect.objectContaining({ sectorId: null, cantidad: 2, quedan: 0 })] });
    expect(d.sedes[1].completo).toBe(true);
  });

  it('sesion null: sin sedes, liberado y resumen igual al de la Etapa 1', () => {
    const s = estado([fila(1, 'centro', 1, [tramo(11, 10)])], [pendiente('p', 'centro', 3, AHORA)]);
    const d = derivarSalon(s, AHORA);
    expect(d.sedes).toEqual([]);
    expect(d.liberado).toBe(true);
    expect(d.resumenPorSeccion.centro.libres).toBe(7);
  });
});

describe('derivarSalon: porSeccion.sectores', () => {
  const sesion: SesionEnCurso = { id: 's1', nombre: 'D', inicioAt: '2026-10-22T21:00:00.000Z', liberaAt: '2026-10-22T20:40:00.000Z' };
  const rs = (id: number, cantidad: number, sentados: number): Reserva => ({
    sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad, sentados,
    sectorId: id, sector: `S${id}`, filaDesde: id * 3 - 2, filaHasta: id * 3, sentadosSeccion: 1,
  });

  it('un SectorVista por reserva y totales de la sección', () => {
    const s: SalonState = { ...estado([fila(1, 'centro', 1, [tramo(11, 10)])]), sesion, reservas: [rs(1, 3, 1), rs(2, 3, 0)] };
    const sec = derivarSalon(s, Date.parse(sesion.liberaAt) - 1000).sedes[0].porSeccion.centro!;
    expect(sec.cantidad).toBe(6);
    expect(sec.quedan).toBe(5);
    expect(sec.sectores).toEqual([
      { sectorId: 1, nombre: 'S1', filaDesde: 1, filaHasta: 3, cantidad: 3, quedan: 2 },
      { sectorId: 2, nombre: 'S2', filaDesde: 4, filaHasta: 6, cantidad: 3, quedan: 3 },
    ]);
  });

  it('sección entera: un solo SectorVista con sectorId null', () => {
    const s: SalonState = {
      ...estado([fila(1, 'centro', 1, [tramo(11, 10)])]),
      sesion,
      reservas: [{ sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 4, sentados: 1, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 1 }],
    };
    const sec = derivarSalon(s, 0).sedes[0].porSeccion.centro!;
    expect(sec.sectores).toEqual([{ sectorId: null, nombre: null, filaDesde: null, filaHasta: null, cantidad: 4, quedan: 3 }]);
  });

  it('consumido se cuenta una vez por sede y sección: 1 sentado + pendiente vivo de 2 = 3 (no 5)', () => {
    const pend: Pendiente = { id: 'p', seccion: 'centro', cantidad: 2, sedeId: 'catan', creadoEn: '2026-10-22T20:00:00.000Z' };
    const base = { ...estado([fila(1, 'centro', 1, [tramo(11, 10)])], [pend]), sesion };
    const sec = derivarSalon({ ...base, reservas: [rs(1, 3, 1), rs(2, 3, 0)] }, 0).sedes[0].porSeccion.centro!;
    expect(sec.consumido).toBe(3);
    // sin sectores: igual que antes (sentados + pendientes vivos)
    const entera: Reserva = { sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 1, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 1 };
    const sin = derivarSalon({ ...base, reservas: [entera] }, 0).sedes[0].porSeccion.centro!;
    expect(sin.consumido).toBe(3);
    expect(sin.quedan).toBe(3);
  });

  it('sin sectores ni reservas, sedes vacío', () => {
    expect(derivarSalon({ ...estado([]), sesion }, 0).sedes).toEqual([]);
  });
});
