import { describe, expect, it } from 'vitest';
import type { SectorServidor, SedeServidor } from '@/components/supervisor/MapaSupervisor';
import { calcularPasos, PASOS, type DatosPreparacion, type PasoId } from './preparacion';
import type { Fila, Seccion } from './types';

const AHORA = Date.parse('2026-10-01T12:00:00Z');

function fila(seccion: Seccion, numero: number, publico = 10, reservado = 0): Fila {
  const tramos: Fila['tramos'] = [];
  if (publico > 0) tramos.push({ id: numero * 10, orden: 1, tipo: 'publico', capacidad: publico, ocupados: 0, etiqueta: null });
  if (reservado > 0) tramos.push({ id: numero * 10 + 1, orden: 2, tipo: 'reservado', capacidad: reservado, ocupados: 0, etiqueta: 'Pastores' });
  return { id: numero, seccion, numero, fragmentada: false, verificadaEn: null, tramos };
}

function sector(id: number, seccion: Seccion, desde: number, hasta: number, capacidad = 100): SectorServidor {
  return { id, seccion, nombre: `S${id}`, fila_desde: desde, fila_hasta: hasta, capacidad };
}

function sede(nombre: string, clave: string | null = 'abc'): SedeServidor {
  return { sede_id: nombre, nombre, clave_acceso: clave, preferencias: [] };
}

type Sesion = DatosPreparacion['sesiones'][number];
function sesion(reservas: Sesion['reservas'] = [], inicio = '2026-11-01T22:00:00Z', nombre = 'Jueves'): Sesion {
  return { id: nombre, nombre, inicio_at: inicio, reservas };
}

function datos(extra: Partial<DatosPreparacion> = {}): DatosPreparacion {
  return { filas: [], sectores: [], sedes: [], fechaLimite: null, sesiones: [], ahoraMs: AHORA, ...extra };
}

/** Evento sin ningún problema: salón con 2 filas cubiertas, una sede con reserva en una sesión. */
function completo(extra: Partial<DatosPreparacion> = {}): DatosPreparacion {
  return datos({
    filas: [fila('centro', 1), fila('centro', 2)],
    sectores: [sector(1, 'centro', 1, 2, 20)],
    sedes: [sede('Catán')],
    fechaLimite: '2026-10-20T00:00:00Z',
    sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 5, sector: 'S1' }])],
    ...extra,
  });
}

const paso = (d: DatosPreparacion, id: PasoId) => calcularPasos(d).find((p) => p.id === id)!;

describe('calcularPasos: evento vacío', () => {
  const pasos = calcularPasos(datos());

  it('devuelve los 6 pasos en el orden de PASOS, con rutas bajo /supervisor', () => {
    expect(pasos.map((p) => p.id)).toEqual(PASOS.map((p) => p.id));
    expect(pasos.map((p) => p.id)).toEqual(['salon', 'sesiones', 'sedes', 'reservas', 'qr', 'revision']);
    expect(pasos[0].ruta).toBe('/supervisor/salon');
    expect(pasos[4].ruta).toBe('/supervisor/qr');
  });

  it('salón incompleto y no bloqueado; los demás bloqueados nombrando el paso anterior', () => {
    expect(pasos[0].completo).toBe(false);
    expect(pasos[0].bloqueado).toBe(false);
    expect(pasos[1].motivoBloqueo).toBe('Se abre al completar Salón');
    expect(pasos[2].motivoBloqueo).toBe('Se abre al completar Sesiones');
    expect(pasos[3].motivoBloqueo).toBe('Se abre al completar Sedes');
    expect(pasos[5].motivoBloqueo).toBe('Se abre al completar Salón');
    expect([1, 2, 3, 5].every((i) => pasos[i].bloqueado)).toBe(true);
  });

  it('qr nunca está bloqueado y avisa que falta el salón', () => {
    expect(pasos[4].bloqueado).toBe(false);
    expect(pasos[4].motivoBloqueo).toBeUndefined();
    expect(pasos[4].avisos).toContain('El salón todavía no está listo: falta Salón');
  });
});

describe('calcularPasos: salón', () => {
  it('completo cuando los sectores cubren todas las filas públicas', () => {
    expect(paso(completo(), 'salon').completo).toBe(true);
  });

  it('una fila fuera de todo sector deja el paso incompleto', () => {
    const d = completo({ filas: [fila('centro', 1), fila('centro', 2), fila('centro', 3)] });
    const p = paso(d, 'salon');
    expect(p.completo).toBe(false);
    expect(p.requisitos.find((r) => r.texto === 'Todas las filas dentro de un sector')?.ok).toBe(false);
  });

  it('un hueco entre sectores cuenta como fila afuera', () => {
    const d = completo({
      filas: [fila('centro', 1), fila('centro', 2), fila('centro', 3)],
      sectores: [sector(1, 'centro', 1, 1), sector(2, 'centro', 3, 3)],
    });
    expect(paso(d, 'salon').completo).toBe(false);
  });

  it('sectores que se pisan dejan el paso incompleto', () => {
    const d = completo({ sectores: [sector(1, 'centro', 1, 2), sector(2, 'centro', 2, 2)] });
    const p = paso(d, 'salon');
    expect(p.completo).toBe(false);
    expect(p.requisitos.find((r) => r.texto === 'Sectores que no se pisan')?.ok).toBe(false);
  });

  it('sectores de otra sección no cubren ni se pisan', () => {
    const d = completo({
      filas: [fila('centro', 1), fila('izquierda', 1)],
      sectores: [sector(1, 'centro', 1, 1)],
    });
    expect(paso(d, 'salon').completo).toBe(false);
    const ok = completo({
      filas: [fila('centro', 1), fila('izquierda', 1)],
      sectores: [sector(1, 'centro', 1, 1), sector(2, 'izquierda', 1, 1)],
    });
    expect(paso(ok, 'salon').completo).toBe(true);
  });

  it('las filas solo reservadas no necesitan sector', () => {
    const d = completo({ filas: [fila('centro', 1), fila('centro', 2), fila('derecha', 1, 0, 8)] });
    expect(paso(d, 'salon').completo).toBe(true);
  });

  it('resumen con sectores y lugares', () => {
    expect(paso(completo(), 'salon').resumen).toBe('1 sector · 20 lugares');
  });
});

describe('calcularPasos: sesiones, sedes, reservas', () => {
  it('cada paso se completa con su primer dato', () => {
    const base = completo({ sesiones: [], sedes: [] });
    expect(paso(base, 'sesiones').completo).toBe(false);
    expect(paso(completo(), 'sesiones').completo).toBe(true);
    expect(paso(base, 'sedes').completo).toBe(false);
    expect(paso(completo(), 'sedes').completo).toBe(true);
    expect(paso(completo({ sesiones: [sesion()] }), 'reservas').completo).toBe(false);
    expect(paso(completo(), 'reservas').completo).toBe(true);
  });

  it('desbloquea en orden: salón completo abre sesiones, no sedes', () => {
    const p = calcularPasos(completo({ sesiones: [], sedes: [] }));
    expect(p.find((x) => x.id === 'sesiones')!.bloqueado).toBe(false);
    expect(p.find((x) => x.id === 'sedes')!.bloqueado).toBe(true);
  });

  it('un paso incompleto se bloquea con el más cercano incompleto anterior', () => {
    const p = calcularPasos(completo({ sesiones: [] }));
    const reservas = p.find((x) => x.id === 'reservas')!;
    expect(reservas.bloqueado).toBe(true);
    expect(reservas.motivoBloqueo).toBe('Se abre al completar Sesiones');
  });

  it('un paso ya completo no se vuelve a bloquear si un anterior se rompe (§7c)', () => {
    const d = completo({ filas: [fila('centro', 1), fila('centro', 2), fila('centro', 3)] });
    const p = calcularPasos(d);
    expect(p.find((x) => x.id === 'salon')!.completo).toBe(false);
    for (const id of ['sesiones', 'sedes', 'reservas'] as const) {
      const x = p.find((q) => q.id === id)!;
      expect(x.completo).toBe(true);
      expect(x.bloqueado).toBe(false);
      expect(x.motivoBloqueo).toBeUndefined();
    }
    expect(p.find((x) => x.id === 'qr')!.bloqueado).toBe(false);
    expect(p.find((x) => x.id === 'revision')!.bloqueado).toBe(true);
  });

  it('revisión nombra el primer incompleto entre 1 y 4, no QR', () => {
    const rev = paso(completo({ sesiones: [] }), 'revision');
    expect(rev.bloqueado).toBe(true);
    expect(rev.motivoBloqueo).toBe('Se abre al completar Sesiones');
  });
});

describe('calcularPasos: qr y revisión', () => {
  it('con todo listo no hay avisos de salón en qr y la revisión está completa', () => {
    const p = calcularPasos(completo());
    const qr = p.find((x) => x.id === 'qr')!;
    expect(qr.avisos.some((a) => a.startsWith('El salón todavía'))).toBe(false);
    expect(qr.completo).toBe(true);
    const rev = p.find((x) => x.id === 'revision')!;
    expect(rev.bloqueado).toBe(false);
    expect(rev.completo).toBe(true);
    expect(rev.requisitos.every((r) => r.ok)).toBe(true);
    expect(rev.avisos).toEqual([]);
  });

  it('qr nombra el primer paso incompleto entre 1 y 4', () => {
    const qr = paso(completo({ sedes: [] }), 'qr');
    expect(qr.avisos).toContain('El salón todavía no está listo: falta Sedes');
    expect(qr.bloqueado).toBe(false);
  });

  it('la revisión no está completa si falta un paso y lo marca en ❌', () => {
    const rev = paso(completo({ sedes: [] }), 'revision');
    expect(rev.completo).toBe(false);
    expect(rev.requisitos.some((r) => !r.ok)).toBe(true);
  });

  it('la revisión junta los avisos de los pasos y no cambia completo', () => {
    const rev = paso(completo({ sedes: [sede('Catán', null)] }), 'revision');
    expect(rev.completo).toBe(true);
    expect(rev.avisos.length).toBeGreaterThan(0);
  });
});

describe('calcularPasos: avisos que no cambian completo', () => {
  it('reservas de un sector que superan su capacidad', () => {
    const d = completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 25, sector: 'S1' }])] });
    const p = paso(d, 'reservas');
    expect(p.avisos.some((a) => a.includes('S1'))).toBe(true);
    expect(p.completo).toBe(true);
  });

  it('reservas que suman justo la capacidad no avisan', () => {
    const d = completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 20, sector: 'S1' }])] });
    expect(paso(d, 'reservas').avisos).toEqual([]);
  });

  it('sesión con inicio anterior a ahoraMs', () => {
    const d = completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 1 }], '2026-09-01T00:00:00Z', 'Vieja')] });
    const p = paso(d, 'sesiones');
    expect(p.avisos.some((a) => a.includes('Vieja'))).toBe(true);
    expect(p.completo).toBe(true);
  });

  it('fecha límite posterior al inicio de una sesión', () => {
    const p = paso(completo({ fechaLimite: '2026-12-01T00:00:00Z' }), 'sedes');
    expect(p.avisos.some((a) => a.includes('fecha límite'))).toBe(true);
    expect(p.completo).toBe(true);
  });

  it('fechaLimite null no rompe y avisa que falta', () => {
    const p = paso(completo({ fechaLimite: null }), 'sedes');
    expect(p.completo).toBe(true);
    expect(p.avisos).toEqual(['No hay fecha límite de preferencias']);
  });

  it('sesión sin reservas', () => {
    const d = completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 1 }]), sesion([], '2026-11-02T22:00:00Z', 'Viernes')] });
    const p = paso(d, 'reservas');
    expect(p.avisos.some((a) => a.includes('Viernes'))).toBe(true);
    expect(p.completo).toBe(true);
  });

  it('sede sin ninguna reserva, comparando sin acentos ni mayúsculas', () => {
    const d = completo({ sedes: [sede('Catán'), sede('Morón')], sesiones: [sesion([{ sede: 'CATAN', seccion: 'centro', cantidad: 1 }])] });
    const avisos = paso(d, 'reservas').avisos;
    expect(avisos.some((a) => a.includes('Morón'))).toBe(true);
    expect(avisos.some((a) => a.includes('Catán'))).toBe(false);
  });

  it('sede sin clave_acceso', () => {
    const p = paso(completo({ sedes: [sede('Catán', null)] }), 'sedes');
    expect(p.avisos.some((a) => a.includes('Catán') && a.includes('enlace'))).toBe(true);
    expect(p.completo).toBe(true);
  });

  it('dos sedes con nombre casi igual (≤ 1 letra, sin acentos ni mayúsculas)', () => {
    const p = paso(completo({ sedes: [sede('Catán'), sede('Catam')] }), 'sedes');
    expect(p.avisos.some((a) => a.includes('Catán') && a.includes('Catam'))).toBe(true);
    const lejos = paso(completo({ sedes: [sede('Catán'), sede('Morón')] }), 'sedes');
    expect(lejos.avisos.some((a) => a.includes('parecidos'))).toBe(false);
  });

  it('casi iguales también por una letra de más o de menos', () => {
    const p = paso(completo({ sedes: [sede('Catan'), sede('Catana')] }), 'sedes');
    expect(p.avisos.some((a) => a.includes('parecidos'))).toBe(true);
    const p2 = paso(completo({ sedes: [sede('Atan'), sede('Catan')] }), 'sedes');
    expect(p2.avisos.some((a) => a.includes('parecidos'))).toBe(true);
  });

  it('sedes que difieren solo en un dígito no son casi iguales', () => {
    for (const par of [['Sede 1', 'Sede 2'], ['Sede 1', 'Sede 12']]) {
      const p = paso(completo({ sedes: par.map((n) => sede(n)) }), 'sedes');
      expect(p.avisos.some((a) => a.includes('parecidos'))).toBe(false);
    }
  });

  it('reservas sin sector que superan la capacidad pública de la sección', () => {
    const res = (cantidad: number) => completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad }])] });
    const p = paso(res(21), 'reservas');
    expect(p.avisos).toEqual(['En Jueves, las reservas de la sección centro suman 21 y tiene 20 lugares públicos']);
    expect(p.completo).toBe(true);
    expect(paso(res(20), 'reservas').avisos).toEqual([]);
  });

  it('el sobrecupo de un sector no repite el aviso de su sección', () => {
    const d = completo({ sesiones: [sesion([{ sede: 'Catán', seccion: 'centro', cantidad: 25, sector: 'S1' }])] });
    expect(paso(d, 'reservas').avisos).toHaveLength(1);
  });
});
