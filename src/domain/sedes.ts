import type { Fila, Pendiente, Seccion } from './types';
import { libresTramo } from './disponibilidad';

export interface SesionEnCurso {
  id: string;
  nombre: string;
  inicioAt: string;
  liberaAt: string;
}

export interface Reserva {
  sedeId: string;
  sede: string;
  seccion: Seccion;
  cantidad: number;
  /** Ya sentados según el servidor; los pendientes vivos se suman aparte. */
  sentados: number;
  /** Null = sección entera. */
  sectorId: number | null;
  sector: string | null;
  filaDesde: number | null;
  filaHasta: number | null;
  /** Sentados de la sede en toda la sección (suma de sus sectores); el servidor lo manda en cada reserva. */
  sentadosSeccion: number;
}

export interface Sector {
  id: number;
  seccion: Seccion;
  nombre: string;
  filaDesde: number;
  filaHasta: number;
  orden: number;
}

// shortcut: asume rangos de sector sin solape, el servidor lo garantiza en guardar_sectores
export function sectorDeFila(sectores: Sector[], seccion: Seccion, numeroFila: number): Sector | null {
  return sectores.find((x) => x.seccion === seccion && numeroFila >= x.filaDesde && numeroFila <= x.filaHasta) ?? null;
}

/** Sentados + pendientes vivos de esa sede en esa sección. */
export function consumido(r: Reserva, pendientes: Pendiente[]): number {
  return pendientes.reduce(
    (suma, p) => (p.sedeId === r.sedeId && p.seccion === r.seccion ? suma + p.cantidad : suma),
    r.sentados,
  );
}

/** Sin sesión en curso no hay nada que apartar. */
export function liberada(sesion: SesionEnCurso | null, ahoraMs: number): boolean {
  return sesion === null || ahoraMs >= Date.parse(sesion.liberaAt);
}

export function quedan(r: Reserva, pendientes: Pendiente[]): number {
  // Con sector el pendiente no se cuenta: su sector se conoce recién al sentar.
  if (r.sectorId !== null) return Math.max(r.cantidad - r.sentados, 0);
  return Math.max(r.cantidad - consumido(r, pendientes), 0);
}

/** Lugares apartados en la sección, sin contar la sede `excluirSedeId` (la que está mandando). */
export function apartado(
  reservas: Reserva[],
  pendientes: Pendiente[],
  seccion: Seccion,
  sesion: SesionEnCurso | null,
  ahoraMs: number,
  excluirSedeId: string | null,
): number {
  if (liberada(sesion, ahoraMs)) return 0;
  // Por sede (como private.apartado): una sede con varios sectores en la sección consume de un solo pozo.
  const porSede = new Map<string, { cantidad: number; sentados: number }>();
  for (const r of reservas) {
    if (r.seccion !== seccion || r.sedeId === excluirSedeId) continue;
    const g = porSede.get(r.sedeId) ?? { cantidad: 0, sentados: r.sentadosSeccion };
    g.cantidad += r.cantidad;
    porSede.set(r.sedeId, g);
  }
  let total = 0;
  for (const [sedeId, g] of porSede) {
    const vivos = pendientes.reduce((n, p) => (p.sedeId === sedeId && p.seccion === seccion ? n + p.cantidad : n), 0);
    total += Math.max(g.cantidad - (g.sentados + vivos), 0);
  }
  return total;
}

/** Copia con `n` ocupados virtuales en los tramos públicos, desde la fila de número más alto. */
export function apartarDelFondo(filas: Fila[], n: number): Fila[] {
  let resto = n;
  const cambios = new Map<number, Fila>();
  for (const f of [...filas].sort((a, b) => b.numero - a.numero)) {
    if (resto <= 0) break;
    const tramos = f.tramos.map((t) => {
      const x = Math.min(libresTramo(t), resto);
      resto -= x;
      return x > 0 ? { ...t, ocupados: t.ocupados + x } : t;
    });
    if (tramos.some((t, i) => t !== f.tramos[i])) cambios.set(f.id, { ...f, tramos });
  }
  return filas.map((f) => cambios.get(f.id) ?? f);
}
