"use client";

import type { FilaVista } from "@/state/derivar";
import { Modal } from "@/components/ui/Modal";
import { atributosAccion, CLASE_ACCION, type Accion } from "./useAccion";
import { opcionesUbicacion } from "./helpers";

type ElegirUbicacionProps = {
  cantidad: number;
  filas: FilaVista[];
  accion: Accion;
  clave: string;
  /** Sienta el grupo en el tramo elegido. Devuelve true si salió bien (el selector se cierra). */
  onElegir(tramoId: number): Promise<boolean>;
  onCerrar(): void;
};

/** Selector de "Otra fila…": un botón grande por cada tramo donde el grupo entra junto. */
export function ElegirUbicacion({ cantidad, filas, accion, clave, onElegir, onCerrar }: ElegirUbicacionProps) {
  const opciones = opcionesUbicacion(filas, cantidad);

  async function elegir(tramoId: number) {
    const salioBien = await accion.ejecutar(clave, () => onElegir(tramoId));
    if (salioBien) onCerrar();
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`¿Dónde sentás a los ${cantidad}?`}>
      {opciones.length === 0 ? (
        <p className="text-base text-texto-suave">{`No hay ningún tramo donde entren ${cantidad} juntos.`}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {opciones.map(({ fila, tramo, texto }, i) => (
            <li key={tramo.id}>
              <button
                type="button"
                data-autofocus={i === 0 ? "" : undefined}
                onClick={() => elegir(tramo.id)}
                {...atributosAccion(accion, clave)}
                className={`flex min-h-12 w-full flex-wrap items-center justify-between gap-x-3 rounded-2xl border border-borde bg-superficie-alta px-4 py-2 text-left text-lg font-semibold text-texto hover:border-texto-suave ${CLASE_ACCION}`}
              >
                <span>{texto}</span>
                {fila.fragmentada && (
                  <span className="text-sm font-normal text-advertencia">Tiene lugares sueltos</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
