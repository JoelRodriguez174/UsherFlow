"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { libresTramo } from "@/domain/disponibilidad";
import type { Fila, Tramo } from "@/domain/types";
import { Boton } from "@/components/ui/Boton";
import { Modal } from "@/components/ui/Modal";
import { atributosAccion, CLASE_ACCION, type Accion } from "./useAccion";
import { nombreTramo, tramosPublicos } from "./helpers";

type CorregirConteoProps = {
  fila: Fila;
  accion: Accion;
  onCorregir(tramoId: number, libresVistos: number): Promise<boolean>;
  onCerrar(): void;
};

/** Devuelve el entero 0..max que representa `texto`, o null si no es válido. */
function leerLibres(texto: string, max: number): number | null {
  if (!/^\d+$/.test(texto.trim())) return null;
  const n = Number(texto);
  return n <= max ? n : null;
}

type TramoCorregirProps = {
  fila: Fila;
  tramo: Tramo;
  varios: boolean;
  accion: Accion;
  onCorregir(tramoId: number, libresVistos: number): Promise<boolean>;
  onCerrar(): void;
};

function CorregirTramo({ fila, tramo, varios, accion, onCorregir, onCerrar }: TramoCorregirProps) {
  const id = useId();
  const inicial = libresTramo(tramo);
  const [texto, setTexto] = useState(String(inicial));
  const valor = leerLibres(texto, tramo.capacidad);
  const invalido = valor === null;
  const clave = `corregir-${tramo.id}`;
  const nombre = nombreTramo(fila, tramo);
  const pregunta = "¿Cuántos lugares libres ves?";

  function ajustar(delta: number) {
    const base = valor ?? inicial;
    setTexto(String(Math.min(tramo.capacidad, Math.max(0, base + delta))));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (valor === null) return;
    const salioBien = await accion.ejecutar(clave, () => onCorregir(tramo.id, valor));
    if (salioBien) onCerrar();
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-3 border-b border-borde pb-4 last:border-b-0 last:pb-0">
      <label htmlFor={`${id}-libres`} className="text-lg font-semibold text-texto">
        {varios ? `${nombre} (${tramo.capacidad} lugares) ` : ""}
        {pregunta}
      </label>
      <div className="flex items-center gap-3">
        <Boton
          variante="secundario"
          tamano="grande"
          etiqueta="Un lugar libre menos"
          className="size-14 shrink-0 px-0"
          onClick={() => ajustar(-1)}
        >
          <Minus aria-hidden="true" className="size-6" />
        </Boton>
        <input
          id={`${id}-libres`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-invalid={invalido}
          aria-describedby={invalido ? `${id}-error` : undefined}
          className="h-14 min-w-0 flex-1 rounded-2xl border border-borde bg-fondo px-3 text-center text-3xl font-bold text-texto"
        />
        <Boton
          variante="secundario"
          tamano="grande"
          etiqueta="Un lugar libre más"
          className="size-14 shrink-0 px-0"
          onClick={() => ajustar(1)}
        >
          <Plus aria-hidden="true" className="size-6" />
        </Boton>
      </div>
      {invalido && (
        <p id={`${id}-error`} className="text-base text-peligro">
          {`Ingresá un número entre 0 y ${tramo.capacidad}.`}
        </p>
      )}
      <Boton
        type="submit"
        tamano="grande"
        className={`w-full ${CLASE_ACCION}`}
        {...atributosAccion(accion, clave)}
        aria-disabled={invalido || accion.clave !== null ? true : undefined}
      >
        {varios ? `Guardar ${nombre}` : "Guardar"}
      </Boton>
    </form>
  );
}

/** "Corregir conteo": el ujier dice cuántos lugares libres ve; si hay varios tramos públicos, uno por tramo. */
export function CorregirConteo({ fila, accion, onCorregir, onCerrar }: CorregirConteoProps) {
  const publicos = tramosPublicos(fila);
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Corregir conteo · Fila ${fila.numero}`}>
      <div className="flex flex-col gap-4">
        {publicos.map((t) => (
          <CorregirTramo
            key={t.id}
            fila={fila}
            tramo={t}
            varios={publicos.length > 1}
            accion={accion}
            onCorregir={onCorregir}
            onCerrar={onCerrar}
          />
        ))}
      </div>
    </Modal>
  );
}
