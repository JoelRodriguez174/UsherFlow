import { useEffect, useState } from 'react';

/** Tiempo (ms) que un botón de confirmación destructiva espera antes de poder usarse. */
export const ARMADO_MS = 800;

/**
 * `true` recién pasados `ms` desde que se monta el componente que lo usa. Evita que un doble toque
 * rápido (el segundo botón queda en el mismo lugar de la pantalla) ejecute la acción destructiva
 * sin una confirmación deliberada. Cada vez que el componente se vuelve a montar, se re-arma.
 */
export function useArmado(ms: number = ARMADO_MS): boolean {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmado(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return armado;
}
