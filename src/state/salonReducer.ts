import type { EstadoSalon, Fila, Pendiente, Seccion, Tramo } from '@/domain/types';
import { libresFila, libresTramo } from '@/domain/disponibilidad';
import { fragmentaTrasLevantarse } from '@/domain/fragmentacion';
import { resumenSeccion } from '@/domain/resumen';
import { apartado, type Reserva, type Sector, type SesionEnCurso } from '@/domain/sedes';

export interface SalonState {
  filas: Record<number, Fila>;
  pendientes: Record<string, Pendiente>;
  offsetMs: number;
  cargado: boolean;
  sesion: SesionEnCurso | null;
  reservas: Reserva[];
  sectores: Sector[];
}

export type Mutacion =
  | { tipo: 'mandar'; pendienteTmpId: string; seccion: Seccion;
      cantidad: number;
      sedeId: string | null;
      creadoEn: string;
    }
  | { tipo: 'sentar'; pendienteId: string; tramoId: number }
  | { tipo: 'noLlegaron'; pendienteId: string }
  | { tipo: 'seLevanto'; tramoId: number }
  | { tipo: 'corregir'; tramoId: number; libresVistos: number }
  | { tipo: 'juntar'; filaId: number };

/** Lo mínimo para deshacer una mutación: filas previas completas y el valor previo de cada pendiente tocado. */
export interface Reversion {
  filas: Fila[];
  pendientes: Array<{ id: string; previo: Pendiente | null }>;
}

export type ResultadoMutacion =
  | { ok: true; state: SalonState; reversion: Reversion }
  | { ok: false; error: string };

export const estadoInicial: SalonState = { filas: {}, pendientes: {}, offsetMs: 0, cargado: false, sesion: null, reservas: [], sectores: [] };

function falla(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function buscarTramo(s: SalonState, tramoId: number): { fila: Fila; tramo: Tramo } | null {
  for (const fila of Object.values(s.filas)) {
    const tramo = fila.tramos.find((t) => t.id === tramoId);
    if (tramo) return { fila, tramo };
  }
  return null;
}

/** Devuelve una fila nueva con el tramo reemplazado; el resto de los tramos conserva su identidad. */
function conTramo(fila: Fila, tramoId: number, cambios: Partial<Tramo>, filaCambios: Partial<Fila> = {}): Fila {
  return {
    ...fila,
    ...filaCambios,
    tramos: fila.tramos.map((t) => (t.id === tramoId ? { ...t, ...cambios } : t)),
  };
}

function conFila(s: SalonState, fila: Fila): SalonState {
  return { ...s, filas: { ...s.filas, [fila.id]: fila } };
}

function sinPendiente(s: SalonState, id: string): SalonState {
  const { [id]: _quitado, ...resto } = s.pendientes;
  return { ...s, pendientes: resto };
}

/**
 * Aplica una mutación sobre el estado actual sin mutarlo. Valida con las mismas reglas
 * (y códigos de error) que el servidor, así la validez se conoce antes de despachar.
 */
export function aplicarMutacion(s: SalonState, m: Mutacion): ResultadoMutacion {
  switch (m.tipo) {
    case 'mandar': {
      if (!Number.isInteger(m.cantidad) || m.cantidad < 1) return falla('CANTIDAD_INVALIDA');
      const filas = Object.values(s.filas).filter((f) => f.seccion === m.seccion);
      const pendientes = Object.values(s.pendientes).filter((p) => p.seccion === m.seccion);
      const ap = apartado(s.reservas, pendientes, m.seccion, s.sesion, Date.parse(m.creadoEn), m.sedeId);
      if (resumenSeccion(filas, pendientes, ap).libres < m.cantidad) return falla('SECCION_SIN_CUPO');
      const nuevo: Pendiente = {
        id: m.pendienteTmpId,
        seccion: m.seccion,
        cantidad: m.cantidad,
        sedeId: m.sedeId,
        creadoEn: m.creadoEn,
      };
      return {
        ok: true,
        state: { ...s, pendientes: { ...s.pendientes, [nuevo.id]: nuevo } },
        reversion: { filas: [], pendientes: [{ id: nuevo.id, previo: s.pendientes[nuevo.id] ?? null }] },
      };
    }

    case 'sentar': {
      const p = s.pendientes[m.pendienteId];
      if (!p) return falla('PENDIENTE_YA_RESUELTO');
      const hallado = buscarTramo(s, m.tramoId);
      if (!hallado) return falla('TRAMO_INEXISTENTE');
      const { fila, tramo } = hallado;
      if (fila.seccion !== p.seccion) return falla('SECCION_INCORRECTA');
      if (tramo.tipo === 'reservado') return falla('TRAMO_RESERVADO');
      if (libresTramo(tramo) < p.cantidad) return falla('TRAMO_SIN_CUPO');

      let nueva = conTramo(fila, tramo.id, { ocupados: tramo.ocupados + p.cantidad });
      // Espejo del servidor: una fila llena ya no está fragmentada.
      if (libresFila(nueva) === 0 && nueva.fragmentada) nueva = { ...nueva, fragmentada: false };
      return {
        ok: true,
        state: sinPendiente(conFila(s, nueva), p.id),
        reversion: { filas: [fila], pendientes: [{ id: p.id, previo: p }] },
      };
    }

    case 'noLlegaron': {
      const p = s.pendientes[m.pendienteId];
      if (!p) return falla('PENDIENTE_YA_RESUELTO');
      return {
        ok: true,
        state: sinPendiente(s, p.id),
        reversion: { filas: [], pendientes: [{ id: p.id, previo: p }] },
      };
    }

    case 'seLevanto': {
      const hallado = buscarTramo(s, m.tramoId);
      if (!hallado) return falla('TRAMO_INEXISTENTE');
      const { fila, tramo } = hallado;
      if (tramo.tipo === 'reservado') return falla('TRAMO_RESERVADO');
      if (tramo.ocupados <= 0) return falla('TRAMO_SIN_OCUPADOS');
      // Se evalúa antes de restar; una vez fragmentada sigue así hasta `juntar`.
      const fragmentada = fila.fragmentada || fragmentaTrasLevantarse(fila);
      const nueva = conTramo(fila, tramo.id, { ocupados: tramo.ocupados - 1 }, { fragmentada });
      return {
        ok: true,
        state: conFila(s, nueva),
        reversion: { filas: [fila], pendientes: [] },
      };
    }

    case 'corregir': {
      const hallado = buscarTramo(s, m.tramoId);
      if (!hallado) return falla('TRAMO_INEXISTENTE');
      const { fila, tramo } = hallado;
      if (tramo.tipo === 'reservado') return falla('TRAMO_RESERVADO');
      if (!Number.isInteger(m.libresVistos) || m.libresVistos < 0 || m.libresVistos > tramo.capacidad) {
        return falla('LIBRES_FUERA_DE_RANGO');
      }
      const nueva = conTramo(fila, tramo.id, { ocupados: tramo.capacidad - m.libresVistos });
      return {
        ok: true,
        state: conFila(s, nueva),
        reversion: { filas: [fila], pendientes: [] },
      };
    }

    case 'juntar': {
      const fila = s.filas[m.filaId];
      if (!fila) return falla('FILA_INEXISTENTE');
      return {
        ok: true,
        state: conFila(s, { ...fila, fragmentada: false }),
        reversion: { filas: [fila], pendientes: [] },
      };
    }
  }
}

/**
 * Deshace una mutación restaurando solo las entidades que tocó (filas y pendientes por id),
 * así no pisa cambios remotos que llegaron a otras entidades mientras tanto.
 */
export function revertir(s: SalonState, r: Reversion): SalonState {
  let filas = s.filas;
  if (r.filas.length > 0) {
    filas = { ...s.filas };
    for (const f of r.filas) filas[f.id] = f;
  }
  let pendientes = s.pendientes;
  if (r.pendientes.length > 0) {
    pendientes = { ...s.pendientes };
    for (const { id, previo } of r.pendientes) {
      if (previo) pendientes[id] = previo;
      else delete pendientes[id];
    }
  }
  return { ...s, filas, pendientes };
}

export type SalonAction =
  | { type: 'cargar'; estado: EstadoSalon; offsetMs: number }
  | { type: 'reemplazar'; state: SalonState }
  | { type: 'filaRemota'; fila: Fila }
  | { type: 'filaEliminada'; filaId: number }
  | { type: 'pendienteRemoto'; pendiente: Pendiente }
  | { type: 'pendienteQuitado'; pendienteId: string };

export function salonReducer(s: SalonState, a: SalonAction): SalonState {
  switch (a.type) {
    case 'cargar':
      return {
        filas: Object.fromEntries(a.estado.filas.map((f) => [f.id, f])),
        pendientes: Object.fromEntries(a.estado.pendientes.map((p) => [p.id, p])),
        offsetMs: a.offsetMs,
        cargado: true,
        sesion: a.estado.sesion,
        reservas: a.estado.reservas,
        sectores: a.estado.sectores,
      };
    case 'reemplazar':
      return a.state;
    case 'filaRemota':
      return conFila(s, a.fila);
    case 'filaEliminada': {
      if (!(a.filaId in s.filas)) return s;
      const { [a.filaId]: _quitada, ...resto } = s.filas;
      return { ...s, filas: resto };
    }
    case 'pendienteRemoto':
      return { ...s, pendientes: { ...s.pendientes, [a.pendiente.id]: a.pendiente } };
    case 'pendienteQuitado':
      return a.pendienteId in s.pendientes ? sinPendiente(s, a.pendienteId) : s;
  }
}
