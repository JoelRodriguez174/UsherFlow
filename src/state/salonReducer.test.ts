import { describe, expect, it } from 'vitest';
import type { Reserva, SesionEnCurso } from '@/domain/sedes';
import type { Fila, Pendiente, Seccion } from '@/domain/types';
import {
  aplicarMutacion,
  estadoInicial,
  revertir,
  salonReducer,
  type SalonState,
} from './salonReducer';

function fila(
  id: number,
  ocupados: number,
  extra: Partial<Fila> = {},
  seccion: Seccion = 'centro',
): Fila {
  return {
    id,
    seccion,
    numero: id,
    fragmentada: false,
    verificadaEn: null,
    tramos: [{ id: id * 10, orden: 1, tipo: 'publico', capacidad: 8, ocupados, etiqueta: null }],
    ...extra,
  };
}

function pend(id: string, cantidad: number, seccion: Seccion = 'centro'): Pendiente {
  return { id, seccion, cantidad, sedeId: null, creadoEn: '2026-01-01T10:00:00Z' };
}

const SESION: SesionEnCurso = {
  id: 's1',
  nombre: 'Domingo',
  inicioAt: '2026-01-01T11:00:00Z',
  liberaAt: '2026-01-01T10:40:00Z',
};
const RESERVAS: Reserva[] = [
  { sedeId: 'catan', sede: 'Catán', seccion: 'centro', cantidad: 6, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 },
  { sedeId: 'ramos', sede: 'Ramos', seccion: 'centro', cantidad: 2, sentados: 0, sectorId: null, sector: null, filaDesde: null, filaHasta: null, sentadosSeccion: 0 },
];

function estado(filas: Fila[], pendientes: Pendiente[] = []): SalonState {
  return {
    filas: Object.fromEntries(filas.map((f) => [f.id, f])),
    pendientes: Object.fromEntries(pendientes.map((p) => [p.id, p])),
    offsetMs: 0,
    cargado: true,
    sesion: null,
    reservas: [],
    sectores: [],
  };
}

describe('aplicarMutacion · mandar con sede', () => {
  // 8 libres en centro, 8 apartados (Catán 6 + Ramos 2) antes de liberaAt
  const base = (): SalonState => ({ ...estado([fila(1, 0)]), sesion: SESION, reservas: RESERVAS, sectores: [] });
  const mandar = (cantidad: number, sedeId: string | null) =>
    aplicarMutacion(base(), {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad,
      sedeId,
      creadoEn: '2026-01-01T10:30:00Z',
    });

  it('sin sede, lo apartado no se puede usar: SECCION_SIN_CUPO', () => {
    expect(mandar(3, null)).toEqual({ ok: false, error: 'SECCION_SIN_CUPO' });
  });
  it('con la sede de Catán de 6 entra y el pendiente lleva sedeId', () => {
    const r = mandar(6, 'catan');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.pendientes['tmp-1'].sedeId).toBe('catan');
  });
  it('pasada la liberación, sin sede entra', () => {
    const r = aplicarMutacion(base(), {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 3,
      sedeId: null,
      creadoEn: '2026-01-01T10:41:00Z',
    });
    expect(r.ok).toBe(true);
  });
});

describe('aplicarMutacion · mandar', () => {
  it('con cupo agrega un pendiente temporal', () => {
    const s = estado([fila(1, 2)]);
    const r = aplicarMutacion(s, {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 3,
      sedeId: null,
      creadoEn: '2026-01-01T10:05:00Z',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pendientes['tmp-1']).toEqual({
      id: 'tmp-1',
      seccion: 'centro',
      cantidad: 3,
      sedeId: null,
      creadoEn: '2026-01-01T10:05:00Z',
    });
    expect(r.reversion.pendientes).toEqual([{ id: 'tmp-1', previo: null }]);
    expect(s.pendientes['tmp-1']).toBeUndefined();
  });

  it('sin cupo en la sección devuelve ok:false SECCION_SIN_CUPO', () => {
    const s = estado([fila(1, 6)], [pend('p1', 1)]);
    const r = aplicarMutacion(s, {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 2,
      sedeId: null,
      creadoEn: 'x',
    });
    expect(r).toEqual({ ok: false, error: 'SECCION_SIN_CUPO' });
  });

  it('solo cuenta filas y pendientes de esa sección', () => {
    const s = estado([fila(1, 8), fila(2, 0, {}, 'derecha')], [pend('p1', 8, 'centro')]);
    const r = aplicarMutacion(s, {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'derecha',
      cantidad: 8,
      sedeId: null,
      creadoEn: 'x',
    });
    expect(r.ok).toBe(true);
  });
});

describe('aplicarMutacion · sentar', () => {
  it('suma ocupados al tramo y quita el pendiente', () => {
    const p = pend('p1', 3);
    const s = estado([fila(1, 2)], [p]);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.filas[1].tramos[0].ocupados).toBe(5);
    expect(r.state.pendientes['p1']).toBeUndefined();
    expect(r.reversion.pendientes).toEqual([{ id: 'p1', previo: p }]);
    expect(r.reversion.filas).toEqual([s.filas[1]]);
    // no muta la entrada
    expect(s.filas[1].tramos[0].ocupados).toBe(2);
    expect(s.pendientes['p1']).toBe(p);
  });

  it('en un tramo sin cupo devuelve ok:false y el estado no cambia', () => {
    const s = estado([fila(1, 6)], [pend('p1', 3)]);
    const copia = structuredClone(s);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    expect(r).toEqual({ ok: false, error: 'TRAMO_SIN_CUPO' });
    expect(s).toEqual(copia);
  });

  it('pendiente desconocido -> PENDIENTE_YA_RESUELTO', () => {
    const s = estado([fila(1, 0)]);
    expect(aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'zz', tramoId: 10 })).toEqual({
      ok: false,
      error: 'PENDIENTE_YA_RESUELTO',
    });
  });

  it('tramo reservado -> TRAMO_RESERVADO', () => {
    const f = fila(1, 0);
    f.tramos[0].tipo = 'reservado';
    const s = estado([f], [pend('p1', 1)]);
    expect(aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 })).toEqual({
      ok: false,
      error: 'TRAMO_RESERVADO',
    });
  });

  it('otra sección -> SECCION_INCORRECTA', () => {
    const s = estado([fila(1, 0, {}, 'derecha')], [pend('p1', 1, 'centro')]);
    expect(aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 })).toEqual({
      ok: false,
      error: 'SECCION_INCORRECTA',
    });
  });

  it('si la fila queda sin libres, fragmentada pasa a false', () => {
    const s = estado([fila(1, 5, { fragmentada: true })], [pend('p1', 3)]);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.filas[1].tramos[0].ocupados).toBe(8);
    expect(r.state.filas[1].fragmentada).toBe(false);
  });

  it('si la fila todavía tiene libres, fragmentada se conserva', () => {
    const s = estado([fila(1, 2, { fragmentada: true })], [pend('p1', 3)]);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    expect(r.ok && r.state.filas[1].fragmentada).toBe(true);
  });

  it('comparte estructura: las filas no tocadas conservan su identidad', () => {
    const s = estado([fila(1, 0), fila(2, 0)], [pend('p1', 1)]);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.filas[2]).toBe(s.filas[2]);
    expect(r.state.filas[1]).not.toBe(s.filas[1]);
  });
});

describe('aplicarMutacion · noLlegaron', () => {
  it('quita el pendiente y la reversión lo restaura', () => {
    const p = pend('p1', 2);
    const s = estado([fila(1, 0)], [p]);
    const r = aplicarMutacion(s, { tipo: 'noLlegaron', pendienteId: 'p1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pendientes['p1']).toBeUndefined();
    expect(revertir(r.state, r.reversion).pendientes['p1']).toBe(p);
  });

  it('pendiente desconocido -> PENDIENTE_YA_RESUELTO', () => {
    const s = estado([fila(1, 0)]);
    expect(aplicarMutacion(s, { tipo: 'noLlegaron', pendienteId: 'zz' })).toEqual({
      ok: false,
      error: 'PENDIENTE_YA_RESUELTO',
    });
  });
});

describe('aplicarMutacion · seLevanto', () => {
  it('en fila con 4 ocupados -> fragmentada true', () => {
    const s = estado([fila(1, 4)]);
    const r = aplicarMutacion(s, { tipo: 'seLevanto', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.filas[1].tramos[0].ocupados).toBe(3);
    expect(r.state.filas[1].fragmentada).toBe(true);
  });

  it('en fila con 3 ocupados -> fragmentada false', () => {
    const s = estado([fila(1, 3)]);
    const r = aplicarMutacion(s, { tipo: 'seLevanto', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.filas[1].tramos[0].ocupados).toBe(2);
    expect(r.state.filas[1].fragmentada).toBe(false);
  });

  it('una vez fragmentada, se mantiene hasta juntar', () => {
    const s = estado([fila(1, 2, { fragmentada: true })]);
    const r = aplicarMutacion(s, { tipo: 'seLevanto', tramoId: 10 });
    expect(r.ok && r.state.filas[1].fragmentada).toBe(true);
  });

  it('tramo sin ocupados -> ok:false', () => {
    const s = estado([fila(1, 0)]);
    expect(aplicarMutacion(s, { tipo: 'seLevanto', tramoId: 10 }).ok).toBe(false);
  });

  it('tramo reservado -> TRAMO_RESERVADO', () => {
    const f = fila(1, 2);
    f.tramos[0].tipo = 'reservado';
    expect(aplicarMutacion(estado([f]), { tipo: 'seLevanto', tramoId: 10 })).toEqual({
      ok: false,
      error: 'TRAMO_RESERVADO',
    });
  });

  it('tramo inexistente -> ok:false', () => {
    expect(aplicarMutacion(estado([fila(1, 2)]), { tipo: 'seLevanto', tramoId: 99 }).ok).toBe(false);
  });
});

describe('aplicarMutacion · corregir y juntar', () => {
  it('corregir fija ocupados = capacidad - libresVistos y no cambia fragmentada', () => {
    const s = estado([fila(1, 4, { fragmentada: true }), fila(2, 4)]);
    const a = aplicarMutacion(s, { tipo: 'corregir', tramoId: 10, libresVistos: 6 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.state.filas[1].tramos[0].ocupados).toBe(2);
    expect(a.state.filas[1].fragmentada).toBe(true);
    const b = aplicarMutacion(s, { tipo: 'corregir', tramoId: 20, libresVistos: 0 });
    expect(b.ok && b.state.filas[2].tramos[0].ocupados).toBe(8);
    expect(b.ok && b.state.filas[2].fragmentada).toBe(false);
  });

  it('corregir rechaza libresVistos fuera de rango', () => {
    const s = estado([fila(1, 4)]);
    expect(aplicarMutacion(s, { tipo: 'corregir', tramoId: 10, libresVistos: -1 }).ok).toBe(false);
    expect(aplicarMutacion(s, { tipo: 'corregir', tramoId: 10, libresVistos: 9 }).ok).toBe(false);
  });

  it('corregir rechaza tramo reservado', () => {
    const f = fila(1, 0);
    f.tramos[0].tipo = 'reservado';
    expect(aplicarMutacion(estado([f]), { tipo: 'corregir', tramoId: 10, libresVistos: 3 }).ok).toBe(false);
  });

  it('juntar apaga fragmentada', () => {
    const s = estado([fila(1, 4, { fragmentada: true })]);
    const r = aplicarMutacion(s, { tipo: 'juntar', filaId: 1 });
    expect(r.ok && r.state.filas[1].fragmentada).toBe(false);
    expect(s.filas[1].fragmentada).toBe(true);
  });

  it('juntar sobre fila inexistente -> ok:false', () => {
    expect(aplicarMutacion(estado([fila(1, 0)]), { tipo: 'juntar', filaId: 9 }).ok).toBe(false);
  });
});

describe('revertir (Review Focus 3)', () => {
  it('revertir A no pisa una actualización remota de B', () => {
    const A = fila(1, 4);
    const B = fila(2, 1);
    const s0 = estado([A, B]);

    const r = aplicarMutacion(s0, { tipo: 'seLevanto', tramoId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const Bremota = fila(2, 5);
    const s2 = salonReducer(r.state, { type: 'filaRemota', fila: Bremota });
    expect(s2.filas[2]).toBe(Bremota);

    const s3 = revertir(s2, r.reversion);
    expect(s3.filas[2]).toBe(Bremota);
    expect(s3.filas[1]).toEqual(A);
    expect(s3.filas[1].tramos[0].ocupados).toBe(4);
    expect(s3.filas[1].fragmentada).toBe(false);
  });

  it('revertir un mandar elimina el pendiente temporal', () => {
    const s = estado([fila(1, 0)]);
    const r = aplicarMutacion(s, {
      tipo: 'mandar',
      pendienteTmpId: 'tmp-1',
      seccion: 'centro',
      cantidad: 1,
      sedeId: null,
      creadoEn: 'x',
    });
    if (!r.ok) throw new Error('esperaba ok');
    expect(revertir(r.state, r.reversion).pendientes).toEqual({});
  });

  it('revertir un sentar restaura fila y pendiente', () => {
    const s = estado([fila(1, 2)], [pend('p1', 3)]);
    const r = aplicarMutacion(s, { tipo: 'sentar', pendienteId: 'p1', tramoId: 10 });
    if (!r.ok) throw new Error('esperaba ok');
    expect(revertir(r.state, r.reversion)).toEqual(s);
  });
});

describe('salonReducer', () => {
  it('estadoInicial está vacío y sin cargar', () => {
    expect(estadoInicial).toEqual({
      filas: {},
      pendientes: {},
      offsetMs: 0,
      cargado: false,
      sesion: null,
      reservas: [],
      sectores: [],
    });
  });

  it('cargar construye los mapas y marca cargado', () => {
    const s = salonReducer(estadoInicial, {
      type: 'cargar',
      estado: { serverNow: 'x', filas: [fila(1, 0), fila(2, 1)], pendientes: [pend('p1', 2)], sesion: SESION, reservas: RESERVAS, sectores: [] },
      offsetMs: 1234,
    });
    expect(Object.keys(s.filas)).toEqual(['1', '2']);
    expect(s.pendientes['p1'].cantidad).toBe(2);
    expect(s.offsetMs).toBe(1234);
    expect(s.cargado).toBe(true);
    expect(s.sesion).toBe(SESION);
    expect(s.reservas).toBe(RESERVAS);
  });

  it('reemplazar devuelve el estado dado', () => {
    const nuevo = estado([fila(3, 0)]);
    expect(salonReducer(estadoInicial, { type: 'reemplazar', state: nuevo })).toBe(nuevo);
  });

  it('filaEliminada y pendienteQuitado quitan la entidad', () => {
    const s = estado([fila(1, 0), fila(2, 0)], [pend('p1', 1)]);
    expect(salonReducer(s, { type: 'filaEliminada', filaId: 1 }).filas[1]).toBeUndefined();
    expect(salonReducer(s, { type: 'pendienteQuitado', pendienteId: 'p1' }).pendientes).toEqual({});
  });

  it('pendienteRemoto agrega o reemplaza', () => {
    const s = estado([fila(1, 0)]);
    const p = pend('p9', 4);
    expect(salonReducer(s, { type: 'pendienteRemoto', pendiente: p }).pendientes['p9']).toBe(p);
  });

  it('quitar una entidad inexistente devuelve el mismo estado', () => {
    const s = estado([fila(1, 0)]);
    expect(salonReducer(s, { type: 'filaEliminada', filaId: 99 })).toBe(s);
    expect(salonReducer(s, { type: 'pendienteQuitado', pendienteId: 'zz' })).toBe(s);
  });
});
