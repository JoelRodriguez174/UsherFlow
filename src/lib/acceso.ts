import type { Rol } from '@/domain/types';
import { SECCIONES } from '@/domain/types';

const CLAVE_STORAGE = 'usherflow.acceso';
const ROLES: readonly Rol[] = ['puerta', ...SECCIONES, 'supervisor', 'sede'];

function esRol(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Guarda clave y rol para esta pestaña. Acceso a sessionStorage siempre dentro de try/catch (modo privado, bloqueado, SSR). */
export function guardarAcceso(clave: string, rol: Rol): void {
  try {
    sessionStorage.setItem(CLAVE_STORAGE, JSON.stringify({ clave, rol }));
  } catch {
    // sin almacenamiento: el acceso vive solo en memoria de la sesión actual
  }
}

export function leerAcceso(): { clave: string; rol: Rol } | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_STORAGE);
    if (!crudo) return null;
    const v: unknown = JSON.parse(crudo);
    if (typeof v !== 'object' || v === null) return null;
    const { clave, rol } = v as { clave?: unknown; rol?: unknown };
    if (typeof clave !== 'string' || clave === '' || !esRol(rol)) return null;
    return { clave, rol };
  } catch {
    return null;
  }
}

/** Enlace/QR de acceso. El rol es solo una conveniencia de la interfaz: el servidor valida únicamente la clave. */
export function armarEnlace(origen: string, clave: string, rol: Rol): string {
  return `${origen}/entrar?k=${encodeURIComponent(clave)}&rol=${rol}`;
}
