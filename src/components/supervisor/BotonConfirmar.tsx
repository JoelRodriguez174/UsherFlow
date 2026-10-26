'use client';

import { useId, type ReactNode } from 'react';
import { Boton } from '@/components/ui/Boton';
import { useArmado } from './useArmado';

/**
 * Botón de confirmación del diálogo. Los destructivos (`peligro`, por defecto) arrancan deshabilitados y se
 * arman tras ARMADO_MS (el diálogo se monta de nuevo en cada paso, así que cada paso vuelve a armarse).
 * Mientras tanto un texto visible, enlazado con aria-describedby, explica por qué no responde.
 */
export function BotonConfirmar({
  peligro = true,
  ocupado,
  onConfirmar,
  children,
}: {
  peligro?: boolean;
  ocupado: boolean;
  onConfirmar(): void;
  children: ReactNode;
}) {
  const armado = useArmado();
  const esperando = peligro && !armado;
  const idAyuda = useId();
  return (
    <>
      <Boton
        variante={peligro ? 'peligro' : 'primario'}
        onClick={onConfirmar}
        disabled={ocupado || esperando}
        aria-describedby={esperando ? idAyuda : undefined}
        className="w-full"
      >
        {ocupado ? 'Trabajando…' : children}
      </Boton>
      <p id={idAyuda} className="min-h-5 text-center text-sm text-texto-suave">
        {esperando ? 'Esperá un instante…' : ''}
      </p>
    </>
  );
}
