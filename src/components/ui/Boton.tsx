import type { ComponentProps } from "react";

export type VarianteBoton = "primario" | "secundario" | "peligro" | "fantasma";
export type TamanoBoton = "normal" | "grande";

export type BotonProps = ComponentProps<"button"> & {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  /** Se usa como aria-label. Obligatorio si el botón no tiene texto hijo (solo ícono). */
  etiqueta?: string;
};

const VARIANTES: Record<VarianteBoton, string> = {
  primario: "bg-acento text-fondo hover:brightness-110 active:brightness-95",
  secundario:
    "border border-borde bg-superficie-alta text-texto hover:border-texto-suave active:bg-superficie",
  peligro: "bg-peligro text-fondo hover:brightness-110 active:brightness-95",
  fantasma: "bg-transparent text-texto-suave hover:bg-superficie-alta hover:text-texto",
};

// normal >= 44px, grande >= 48px de alto (objetivo táctil cómodo con una mano)
const TAMANOS: Record<TamanoBoton, string> = {
  normal: "min-h-11 px-4 text-base",
  grande: "min-h-12 px-6 text-lg",
};

export function Boton({
  variante = "primario",
  tamano = "normal",
  etiqueta,
  type = "button",
  className,
  children,
  ...resto
}: BotonProps) {
  const clases = [
    "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold",
    "transition-[filter,background-color,border-color] duration-150",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTES[variante],
    TAMANOS[tamano],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} aria-label={etiqueta} className={clases} {...resto}>
      {children}
    </button>
  );
}
