"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ModalProps = {
  abierto: boolean;
  onCerrar(): void;
  titulo: string;
  children: ReactNode;
};

const FOCUSABLES = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const noSuscribir = () => () => {};

export function Modal({ abierto, onCerrar, titulo, children }: ModalProps) {
  // El portal solo existe en el cliente (evita mismatch de hidratación).
  const enCliente = useSyncExternalStore(
    noSuscribir,
    () => true,
    () => false,
  );
  const idTitulo = useId();
  const dialogoRef = useRef<HTMLDivElement>(null);
  // Última versión de onCerrar sin re-ejecutar el efecto de foco en cada render.
  const onCerrarRef = useRef(onCerrar);
  useEffect(() => {
    onCerrarRef.current = onCerrar;
  });

  const visible = abierto && enCliente;

  useEffect(() => {
    if (!visible) return;
    const dialogo = dialogoRef.current;
    if (!dialogo) return;

    const abridor = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const enfocables = () =>
      Array.from(dialogo.querySelectorAll<HTMLElement>(FOCUSABLES)).filter(
        (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
      );

    // El foco entra al diálogo: al elemento con data-autofocus o al contenedor.
    (dialogo.querySelector<HTMLElement>("[data-autofocus]") ?? dialogo).focus();

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCerrarRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = enfocables();
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === dialogo)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (!(activo instanceof Node) || !dialogo.contains(activo)) {
        e.preventDefault();
        primero.focus();
      }
    };

    // Si el foco escapa del diálogo (clic fuera, lector de pantalla), se lo trae de vuelta.
    const alEnfocar = (e: FocusEvent) => {
      if (e.target instanceof Node && !dialogo.contains(e.target)) dialogo.focus();
    };

    document.addEventListener("keydown", alTeclear);
    document.addEventListener("focusin", alEnfocar);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.removeEventListener("focusin", alEnfocar);
      document.body.style.overflow = overflowPrevio;
      // El foco vuelve a quien abrió el modal.
      if (abridor && abridor.isConnected) abridor.focus();
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      data-testid="modal-fondo"
      className="fixed inset-0 z-50 flex items-end justify-center bg-fondo/80 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl border border-borde bg-superficie shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-borde px-5 py-3">
          <h2 id={idTitulo} className="font-titulo text-xl font-semibold text-texto">
            {titulo}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCerrar}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-superficie-alta hover:text-texto"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="safe-bottom overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
