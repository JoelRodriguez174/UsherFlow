import { ahoraServidor, pendienteEsAmbar } from '@/domain/pendientes';
import { capacidadPublicaFila, grupoMaxJuntoFila, libresFila, ocupadosFila } from '@/domain/disponibilidad';
import { resumenSeccion, type ResumenSeccion } from '@/domain/resumen';
import { apartado, consumido, liberada, quedan, type Reserva, type SesionEnCurso } from '@/domain/sedes';
import { SECCIONES, type Fila, type Pendiente, type Seccion } from '@/domain/types';
import type { SalonState } from './salonReducer';

export interface FilaVista {
  fila: Fila;
  libres: number;
  grupoMaxJunto: number;
  estaLlena: boolean;
}

export interface PendienteVista {
  pendiente: Pendiente;
  ambar: boolean;
}

export interface SectorVista {
  sectorId: number | null;
  nombre: string | null;
  filaDesde: number | null;
  filaHasta: number | null;
  cantidad: number;
  quedan: number;
}

export interface SedeVista {
  sedeId: string;
  nombre: string;
  /** Totales de la sección y un `SectorVista` por reserva (uno solo con `sectorId: null` si es sección entera). */
  porSeccion: Partial<Record<Seccion, { cantidad: number; consumido: number; quedan: number; sectores: SectorVista[] }>>;
  /** `quedan` es 0 en todas sus secciones. */
  completo: boolean;
}

export interface SalonDerivado {
  filasPorSeccion: Record<Seccion, FilaVista[]>;
  resumenPorSeccion: Record<Seccion, ResumenSeccion>;
  /** Resumen de la sección desde el punto de vista de una sede (su propio apartado no se descuenta). */
  resumenParaSede(sedeId: string | null): Record<Seccion, ResumenSeccion>;
  sedes: SedeVista[];
  /** Ya pasó `liberaAt` de la sesión en curso (o no hay sesión): nada queda apartado. */
  liberado: boolean;
  pendientesPorSeccion: Record<Seccion, PendienteVista[]>;
  ocupacion: { ocupados: number; capacidad: number; porcentaje: number };
}

type PorSeccion<T> = Record<Seccion, T>;

function porSeccion<T>(valor: (s: Seccion) => T): PorSeccion<T> {
  return Object.fromEntries(SECCIONES.map((s) => [s, valor(s)])) as PorSeccion<T>;
}

// ---------------------------------------------------------------------------
// Cachés por referencia. Todo es función pura de objetos inmutables del estado
// (el reducer nunca muta): misma referencia de entrada => misma salida.
// ---------------------------------------------------------------------------

/** FilaVista depende solo de la Fila (no del tiempo): se reutiliza mientras la Fila conserve su referencia. */
const cacheFilaVista = new WeakMap<Fila, FilaVista>();

function vistaDeFila(fila: Fila): FilaVista {
  let v = cacheFilaVista.get(fila);
  if (!v) {
    const libres = libresFila(fila);
    v = { fila, libres, grupoMaxJunto: grupoMaxJuntoFila(fila), estaLlena: libres === 0 };
    cacheFilaVista.set(fila, v);
  }
  return v;
}

interface DeFilas {
  filasPorSeccion: PorSeccion<FilaVista[]>;
  ocupacion: SalonDerivado['ocupacion'];
}

const cacheDeFilas = new WeakMap<SalonState['filas'], DeFilas>();

function derivarDeFilas(filas: SalonState['filas']): DeFilas {
  let r = cacheDeFilas.get(filas);
  if (!r) {
    const lista = Object.values(filas).sort((a, b) => a.numero - b.numero || a.id - b.id);
    let ocupados = 0;
    let capacidad = 0;
    for (const f of lista) {
      ocupados += ocupadosFila(f);
      capacidad += capacidadPublicaFila(f);
    }
    r = {
      filasPorSeccion: porSeccion((s) => lista.filter((f) => f.seccion === s).map(vistaDeFila)),
      ocupacion: {
        ocupados,
        capacidad,
        porcentaje: capacidad === 0 ? 0 : Math.round((ocupados / capacidad) * 100),
      },
    };
    cacheDeFilas.set(filas, r);
  }
  return r;
}

function resumenCalculado(
  filasPorSeccion: PorSeccion<FilaVista[]>,
  pendientes: Pendiente[],
  reservas: Reserva[],
  sesion: SesionEnCurso | null,
  ahoraMs: number,
  sedeId: string | null,
): PorSeccion<ResumenSeccion> {
  return porSeccion((sec) =>
    resumenSeccion(
      filasPorSeccion[sec].map((v) => v.fila),
      pendientes.filter((p) => p.seccion === sec),
      apartado(reservas, pendientes, sec, sesion, ahoraMs, sedeId),
    ),
  );
}

// El resumen sin sede se cachea por filas -> pendientes -> reservas y se invalida si cambia `liberado` o la sesión.
const cacheResumen = new WeakMap<
  SalonState['filas'],
  WeakMap<SalonState['pendientes'], WeakMap<Reserva[], { sesion: SesionEnCurso | null; liberado: boolean; r: PorSeccion<ResumenSeccion> }>>
>();

function derivarResumen(
  s: SalonState,
  filasPorSeccion: PorSeccion<FilaVista[]>,
  liberado: boolean,
  ahoraMs: number,
): PorSeccion<ResumenSeccion> {
  let porPendientes = cacheResumen.get(s.filas);
  if (!porPendientes) cacheResumen.set(s.filas, (porPendientes = new WeakMap()));
  let porReservas = porPendientes.get(s.pendientes);
  if (!porReservas) porPendientes.set(s.pendientes, (porReservas = new WeakMap()));
  let c = porReservas.get(s.reservas);
  if (!c || c.liberado !== liberado || c.sesion !== s.sesion) {
    c = { sesion: s.sesion, liberado, r: resumenCalculado(filasPorSeccion, Object.values(s.pendientes), s.reservas, s.sesion, ahoraMs, null) };
    porReservas.set(s.reservas, c);
  }
  return c.r;
}

function derivarSedes(s: SalonState): SedeVista[] {
  if (s.sesion === null) return [];
  const pendientes = Object.values(s.pendientes);
  const porId = new Map<string, SedeVista>();
  for (const r of s.reservas) {
    let v = porId.get(r.sedeId);
    if (!v) porId.set(r.sedeId, (v = { sedeId: r.sedeId, nombre: r.sede, porSeccion: {}, completo: true }));
    const q = quedan(r, pendientes);
    let sec = v.porSeccion[r.seccion];
    if (!sec) {
      // Una vez por (sede, sección), como `apartado`: sentados de la sección + pendientes vivos de la sede.
      const vivos = consumido({ ...r, sentados: 0 }, pendientes);
      sec = v.porSeccion[r.seccion] = { cantidad: 0, consumido: r.sentadosSeccion + vivos, quedan: 0, sectores: [] };
    }
    sec.cantidad += r.cantidad;
    sec.quedan += q;
    sec.sectores.push({ sectorId: r.sectorId, nombre: r.sector, filaDesde: r.filaDesde, filaHasta: r.filaHasta, cantidad: r.cantidad, quedan: q });
    if (q > 0) v.completo = false;
  }
  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Orden de llegada: el más antiguo primero. */
function porLlegada(a: Pendiente, b: Pendiente): number {
  return a.creadoEn < b.creadoEn ? -1 : a.creadoEn > b.creadoEn ? 1 : 0;
}

/**
 * Vistas derivadas del salón. Lo único que depende del tiempo es `ambar` de los pendientes,
 * así que con el mismo estado y otro `ahoraLocalMs` solo se recalcula `pendientesPorSeccion`;
 * filas, resumen y ocupación se devuelven por referencia. El ámbar se mide con el reloj del
 * servidor (`ahoraLocalMs` corregido por `s.offsetMs`).
 */
export function derivarSalon(s: SalonState, ahoraLocalMs: number): SalonDerivado {
  const { filasPorSeccion, ocupacion } = derivarDeFilas(s.filas);
  const ahora = ahoraServidor(ahoraLocalMs, s.offsetMs);
  const liberado = liberada(s.sesion, ahora);
  const resumenPorSeccion = derivarResumen(s, filasPorSeccion, liberado, ahora);
  const resumenParaSede = (sedeId: string | null) =>
    sedeId === null
      ? resumenPorSeccion
      : resumenCalculado(filasPorSeccion, Object.values(s.pendientes), s.reservas, s.sesion, ahora, sedeId);
  const ordenados = Object.values(s.pendientes).sort(porLlegada);
  const pendientesPorSeccion = porSeccion((sec) =>
    ordenados.filter((p) => p.seccion === sec).map((p) => ({ pendiente: p, ambar: pendienteEsAmbar(p, ahora) })),
  );
  return {
    filasPorSeccion,
    resumenPorSeccion,
    resumenParaSede,
    sedes: derivarSedes(s),
    liberado,
    pendientesPorSeccion,
    ocupacion,
  };
}
