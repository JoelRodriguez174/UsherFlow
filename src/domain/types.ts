import type { Reserva, Sector, SesionEnCurso } from './sedes';

export type Seccion = 'izquierda' | 'centro' | 'derecha';
export const SECCIONES: readonly Seccion[] = ['izquierda', 'centro', 'derecha'];

export type TramoTipo = 'publico' | 'reservado';

export interface Tramo {
  id: number;
  orden: number;
  tipo: TramoTipo;
  capacidad: number;
  ocupados: number;
  etiqueta: string | null;
}

export interface Fila {
  id: number;
  seccion: Seccion;
  numero: number;
  fragmentada: boolean;
  verificadaEn: string | null;
  tramos: Tramo[];
}

export interface Pendiente {
  id: string;
  seccion: Seccion;
  cantidad: number;
  creadoEn: string;
  sedeId: string | null;
}

export interface EstadoSalon {
  serverNow: string;
  filas: Fila[];
  pendientes: Pendiente[];
  sesion: SesionEnCurso | null;
  reservas: Reserva[];
  sectores: Sector[];
}

export type Rol = 'puerta' | Seccion | 'supervisor' | 'sede';
