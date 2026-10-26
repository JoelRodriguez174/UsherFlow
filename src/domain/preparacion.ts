import type { SectorServidor, SedeServidor } from '@/components/supervisor/MapaSupervisor';
import { capacidadPublicaFila } from './disponibilidad';
import type { Fila, Seccion } from './types';

export type PasoId = 'salon' | 'sesiones' | 'sedes' | 'reservas' | 'qr' | 'revision';
export type Requisito = { texto: string; ok: boolean; ejemplo?: string };
export type Paso = {
  id: PasoId;
  titulo: string;
  ruta: string;
  completo: boolean;
  bloqueado: boolean;
  motivoBloqueo?: string;
  /** Paso que hay que completar antes (presente solo si `bloqueado`). */
  bloqueadoPor?: PasoId;
  resumen: string;
  requisitos: Requisito[];
  avisos: string[];
};
export type DatosPreparacion = {
  filas: ReadonlyArray<Fila>;
  sectores: ReadonlyArray<SectorServidor>;
  sedes: ReadonlyArray<SedeServidor>;
  fechaLimite: string | null;
  sesiones: ReadonlyArray<{
    id: string;
    nombre: string;
    inicio_at: string;
    reservas: ReadonlyArray<{ sede: string; seccion: Seccion; cantidad: number; sector?: string | null }>;
  }>;
  ahoraMs: number;
};

export const PASOS: ReadonlyArray<{ id: PasoId; titulo: string; ruta: string }> = [
  { id: 'salon', titulo: 'Salón', ruta: '/supervisor/salon' },
  { id: 'sesiones', titulo: 'Sesiones', ruta: '/supervisor/sesiones' },
  { id: 'sedes', titulo: 'Sedes', ruta: '/supervisor/sedes' },
  { id: 'reservas', titulo: 'Reservas', ruta: '/supervisor/reservas' },
  { id: 'qr', titulo: 'QR de ujieres', ruta: '/supervisor/qr' },
  { id: 'revision', titulo: 'Revisión', ruta: '/supervisor/revision' },
];

/** Minúsculas y sin acentos: "Catán", "catan" y "CATÁN" son la misma sede. */
const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** True si `a` y `b` difieren en a lo sumo una letra (sustitución, alta o baja); un dígito de diferencia ("Sede 1" / "Sede 2") no cuenta como error de tipeo. */
function casiIguales(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) && !/\d/.test(a[i] ?? '') && !/\d/.test(b[i] ?? '');
  }
  const [corta, larga] = a.length < b.length ? [a, b] : [b, a];
  return corta.slice(i) === larga.slice(i + 1) && !/\d/.test(larga[i]);
}

function calcularSalon(d: DatosPreparacion) {
  const publicas = d.filas.filter((f) => capacidadPublicaFila(f) > 0);
  const cubierta = (f: Fila) =>
    d.sectores.some((s) => s.seccion === f.seccion && f.numero >= s.fila_desde && f.numero <= s.fila_hasta);
  const sinSector = publicas.filter((f) => !cubierta(f));
  let pisados = 0;
  d.sectores.forEach((a, i) => {
    for (const b of d.sectores.slice(i + 1)) {
      if (a.seccion === b.seccion && Math.max(a.fila_desde, b.fila_desde) <= Math.min(a.fila_hasta, b.fila_hasta)) pisados++;
    }
  });
  const avisos: string[] = [];
  if (sinSector.length > 0) avisos.push(`${plural(sinSector.length, 'fila pública queda', 'filas públicas quedan')} fuera de todo sector`);
  if (pisados > 0) avisos.push(`${plural(pisados, 'par de sectores se pisa', 'pares de sectores se pisan')}`);
  const requisitos: Requisito[] = [
    { texto: 'Filas cargadas en el salón', ok: d.filas.length > 0, ejemplo: 'Aplicá una plantilla de salón' },
    { texto: 'Todas las filas dentro de un sector', ok: d.filas.length > 0 && sinSector.length === 0, ejemplo: 'Sector A: filas 1 a 8' },
    { texto: 'Sectores que no se pisan', ok: pisados === 0 },
  ];
  const lugares = d.sectores.reduce((suma, s) => suma + s.capacidad, 0);
  const resumen = d.filas.length === 0
    ? 'Sin filas cargadas'
    : d.sectores.length === 0
      ? 'Sin sectores'
      : `${plural(d.sectores.length, 'sector', 'sectores')} · ${lugares} lugares`;
  return { requisitos, avisos, resumen };
}

function calcularSesiones(d: DatosPreparacion) {
  const avisos = d.sesiones
    .filter((s) => Date.parse(s.inicio_at) < d.ahoraMs)
    .map((s) => `La sesión ${s.nombre} ya empezó o es de una fecha pasada`);
  return {
    requisitos: [{ texto: 'Al menos una sesión', ok: d.sesiones.length > 0, ejemplo: 'Jueves 19:00' }],
    avisos,
    resumen: d.sesiones.length === 0 ? 'Sin sesiones' : plural(d.sesiones.length, 'sesión', 'sesiones'),
  };
}

function calcularSedes(d: DatosPreparacion) {
  const avisos: string[] = [];
  if (d.fechaLimite === null) avisos.push('No hay fecha límite de preferencias');
  else {
    const limite = Date.parse(d.fechaLimite);
    for (const s of d.sesiones) {
      if (limite > Date.parse(s.inicio_at)) avisos.push(`La fecha límite de preferencias es posterior al inicio de ${s.nombre}`);
    }
  }
  for (const s of d.sedes) if (!s.clave_acceso) avisos.push(`La sede ${s.nombre} no tiene enlace de acceso`);
  d.sedes.forEach((a, i) => {
    for (const b of d.sedes.slice(i + 1)) {
      if (casiIguales(normalizar(a.nombre), normalizar(b.nombre))) avisos.push(`Nombres de sede muy parecidos: ${a.nombre} y ${b.nombre}`);
    }
  });
  return {
    requisitos: [{ texto: 'Al menos una sede', ok: d.sedes.length > 0, ejemplo: 'Catán' }],
    avisos,
    resumen: d.sedes.length === 0 ? 'Sin sedes' : plural(d.sedes.length, 'sede', 'sedes'),
  };
}

function calcularReservas(d: DatosPreparacion) {
  const avisos: string[] = [];
  let total = 0;
  let lugares = 0;
  const usadas = new Set<string>();
  for (const ses of d.sesiones) {
    if (ses.reservas.length === 0) avisos.push(`La sesión ${ses.nombre} no tiene reservas`);
    const porSector = new Map<number, number>();
    const porSeccion = new Map<Seccion, number>();
    for (const r of ses.reservas) {
      total++;
      lugares += r.cantidad;
      usadas.add(normalizar(r.sede));
      porSeccion.set(r.seccion, (porSeccion.get(r.seccion) ?? 0) + r.cantidad);
      if (!r.sector) continue;
      const nombre = normalizar(r.sector);
      for (const s of d.sectores) {
        if (s.seccion === r.seccion && normalizar(s.nombre) === nombre) porSector.set(s.id, (porSector.get(s.id) ?? 0) + r.cantidad);
      }
    }
    const seccionesAvisadas = new Set<Seccion>();
    for (const s of d.sectores) {
      const reservado = porSector.get(s.id) ?? 0;
      if (reservado > s.capacidad) {
        avisos.push(`En ${ses.nombre}, las reservas del sector ${s.nombre} suman ${reservado} y tiene ${s.capacidad} lugares`);
        seccionesAvisadas.add(s.seccion);
      }
    }
    // Reservas sin sector: la capacidad que importa es la pública de toda la sección.
    for (const [seccion, reservado] of porSeccion) {
      if (seccionesAvisadas.has(seccion)) continue;
      const capacidad = d.filas.filter((f) => f.seccion === seccion).reduce((suma, f) => suma + capacidadPublicaFila(f), 0);
      if (reservado > capacidad) avisos.push(`En ${ses.nombre}, las reservas de la sección ${seccion} suman ${reservado} y tiene ${capacidad} lugares públicos`);
    }
  }
  for (const s of d.sedes) if (!usadas.has(normalizar(s.nombre))) avisos.push(`La sede ${s.nombre} no tiene ninguna reserva`);
  return {
    requisitos: [{ texto: 'Al menos una reserva en alguna sesión', ok: total > 0, ejemplo: '40 lugares para Catán en Sector A' }],
    avisos,
    resumen: total === 0 ? 'Sin reservas' : `${plural(total, 'reserva', 'reservas')} · ${lugares} lugares`,
  };
}

export function calcularPasos(d: DatosPreparacion): Paso[] {
  const base = {
    salon: calcularSalon(d),
    sesiones: calcularSesiones(d),
    sedes: calcularSedes(d),
    reservas: calcularReservas(d),
  };
  const titulo = (id: PasoId) => PASOS.find((p) => p.id === id)!.titulo;
  const completoDe = (r: { requisitos: Requisito[] }) => r.requisitos.every((q) => q.ok);
  const completos = {
    salon: completoDe(base.salon),
    sesiones: completoDe(base.sesiones),
    sedes: completoDe(base.sedes),
    reservas: completoDe(base.reservas),
  };
  const primeros = PASOS.slice(0, 4).map((p) => p.id as keyof typeof completos);
  const faltante = primeros.find((id) => !completos[id]);

  const qr = {
    requisitos: [{ texto: 'Salón, sesiones, sedes y reservas listos', ok: faltante === undefined }],
    avisos: faltante ? [`El salón todavía no está listo: falta ${titulo(faltante)}`] : [],
    resumen: 'Puerta, tres secciones y supervisor',
  };
  const revision = {
    requisitos: [...primeros, 'qr' as const].map((id): Requisito => ({
      texto: `${titulo(id)} listo`,
      ok: id === 'qr' ? completoDe(qr) : completos[id],
    })),
    avisos: primeros.flatMap((id) => base[id].avisos),
    resumen: '',
  };
  const todos = { ...base, qr, revision };
  const hechos = PASOS.slice(0, 5).filter((p) => completoDe(todos[p.id])).length;
  revision.resumen = hechos === 5 ? 'Todo listo' : `${hechos} de 5 pasos listos`;

  return PASOS.map((p, i) => {
    const r = todos[p.id];
    const completo = completoDe(r);
    // §7c: un paso ya completo no se vuelve a bloquear si uno anterior se rompe.
    // Revisión nombra el primer paso 1-4 que falta (QR depende de ellos); el resto, el más cercano anterior.
    // Reservas no depende de Sedes (§7d): las sedes se crean solas al importar reservas.
    const bloqueante = completo || p.id === 'qr'
      ? undefined
      : p.id === 'revision'
        ? PASOS.find((a) => a.id === faltante)
        : PASOS.slice(0, i).reverse().find((a) => !completoDe(todos[a.id]) && !(p.id === 'reservas' && a.id === 'sedes'));
    return {
      ...p,
      completo,
      bloqueado: bloqueante !== undefined,
      ...(bloqueante ? { motivoBloqueo: `Se abre al completar ${bloqueante.titulo}`, bloqueadoPor: bloqueante.id } : {}),
      resumen: r.resumen,
      requisitos: r.requisitos,
      avisos: r.avisos,
    };
  });
}
