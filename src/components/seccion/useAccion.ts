import { useCallback, useRef, useState } from "react";

/** Contexto de "una acción a la vez" que SeccionView reparte a sus hijos. */
export interface Accion {
  /** Clave de la acción en curso (null si no hay ninguna). */
  clave: string | null;
  /**
   * Corre `fn` si no hay otra acción en curso. Devuelve false si la ignoró, si `fn` falló
   * o si `fn` devolvió false (el error visible lo muestra la capa de arriba).
   */
  ejecutar(clave: string, fn: () => Promise<boolean>): Promise<boolean>;
}

/**
 * Guarda contra el doble toque mientras un callback async está esperando. Usa un ref
 * (síncrono, vale aunque dos clics lleguen antes de re-renderizar) y siempre libera en `finally`.
 */
export function useAccionUnica(): Accion {
  const [clave, setClave] = useState<string | null>(null);
  const enCurso = useRef(false);

  const ejecutar = useCallback(async (k: string, fn: () => Promise<boolean>) => {
    if (enCurso.current) return false;
    enCurso.current = true;
    setClave(k);
    try {
      return await fn();
    } catch {
      return false;
    } finally {
      enCurso.current = false;
      setClave(null);
    }
  }, []);

  return { clave, ejecutar };
}

/**
 * Atributos para un botón que dispara una acción async. NO usa `disabled` nativo
 * (el botón apretado perdería el foco): aria-disabled + aria-busy, y el guard está en `ejecutar`.
 */
export function atributosAccion(accion: Accion, clave: string) {
  return {
    "aria-disabled": accion.clave !== null ? true : undefined,
    "aria-busy": accion.clave === clave ? true : undefined,
  } as const;
}

export const CLASE_ACCION = "aria-disabled:opacity-60";
