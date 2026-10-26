"use client";

import { useId, useState } from "react";
import { CheckCheck, Clock, TriangleAlert } from "lucide-react";
import { libresTramo } from "@/domain/disponibilidad";
import type { FilaVista } from "@/state/derivar";
import { Boton } from "@/components/ui/Boton";
import { CorregirConteo } from "./CorregirConteo";
import { atributosAccion, CLASE_ACCION, type Accion } from "./useAccion";
import { haceCuanto, nombreTramo, textoLibres, tramosPublicos } from "./helpers";

type FilaItemProps = {
  vista: FilaVista;
  ahoraServidorMs: number;
  accion: Accion;
  onSeLevanto(tramoId: number): Promise<boolean>;
  onCorregir(tramoId: number, libresVistos: number): Promise<boolean>;
  onJuntar(filaId: number): Promise<boolean>;
  onVerificar(filaId: number): Promise<boolean>;
};

export function FilaItem({
  vista,
  ahoraServidorMs,
  accion,
  onSeLevanto,
  onCorregir,
  onJuntar,
  onVerificar,
}: FilaItemProps) {
  const { fila, libres, estaLlena } = vista;
  const tituloId = useId();
  const [eligiendoTramo, setEligiendoTramo] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);

  const publicos = tramosPublicos(fila);
  const sinPublicos = publicos.length === 0;
  const variosPublicos = publicos.length > 1;
  const hayGente = publicos.some((t) => t.ocupados >= 1);
  const mostrarTramos = variosPublicos || publicos.length !== fila.tramos.length;

  async function seLevanto(tramoId: number) {
    const salioBien = await accion.ejecutar(`levanto-${tramoId}`, () => onSeLevanto(tramoId));
    if (salioBien) setEligiendoTramo(false);
  }

  const estado = sinPublicos ? "Reservada" : estaLlena ? "Llena" : textoLibres(libres);
  const verificacion = haceCuanto(fila.verificadaEn, ahoraServidorMs);

  return (
    <div
      role="group"
      aria-labelledby={tituloId}
      className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={tituloId} className="font-titulo text-2xl text-texto">
          {`Fila ${fila.numero}`}
        </h3>
        <p className={`text-lg font-semibold ${!sinPublicos && !estaLlena ? "text-libre" : "text-texto-suave"}`}>
          {estado}
        </p>
      </div>

      {mostrarTramos && (
        <ul className="flex flex-col gap-0.5 text-sm text-texto-suave">
          {fila.tramos.map((t) => (
            <li key={t.id}>
              {t.tipo === "reservado"
                ? t.etiqueta
                  ? `${t.etiqueta} · reservado`
                  : "Reservado"
                : `${nombreTramo(fila, t)} · ${textoLibres(libresTramo(t))} de ${t.capacidad}`}
            </li>
          ))}
        </ul>
      )}

      {!sinPublicos && (
        <p className="flex items-center gap-1.5 text-sm text-texto-suave">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {fila.verificadaEn === null ? "Sin verificar" : `Verificada ${verificacion}`}
        </p>
      )}

      {fila.fragmentada && (
        <div className="flex flex-col gap-2 rounded-xl border border-advertencia p-3">
          <p className="flex items-start gap-2 text-base font-semibold text-advertencia">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Hay lugares sueltos separados. Mirá la fila.
          </p>
          <Boton
            className={`w-full ${CLASE_ACCION}`}
            onClick={() => accion.ejecutar(`juntar-${fila.id}`, () => onJuntar(fila.id))}
            {...atributosAccion(accion, `juntar-${fila.id}`)}
          >
            Juntos
          </Boton>
        </div>
      )}

      {!sinPublicos && (
        <div className="grid grid-cols-2 gap-2">
          {hayGente && (
            <Boton
              variante="secundario"
              className={`w-full ${CLASE_ACCION}`}
              aria-expanded={variosPublicos ? eligiendoTramo : undefined}
              onClick={() => {
                if (variosPublicos) setEligiendoTramo((v) => !v);
                else void seLevanto(publicos[0].id);
              }}
              {...atributosAccion(accion, `levanto-${publicos[0].id}`)}
            >
              Se levantó alguien
            </Boton>
          )}
          <Boton variante="secundario" className="w-full" onClick={() => setCorrigiendo(true)}>
            Corregir conteo
          </Boton>
          <Boton
            variante="fantasma"
            className={`col-span-2 w-full ${CLASE_ACCION}`}
            onClick={() => accion.ejecutar(`verificar-${fila.id}`, () => onVerificar(fila.id))}
            {...atributosAccion(accion, `verificar-${fila.id}`)}
          >
            <CheckCheck aria-hidden="true" className="size-5 shrink-0" />
            Ya revisé
          </Boton>
        </div>
      )}

      {variosPublicos && eligiendoTramo && (
        <div role="group" aria-label="¿En qué tramo se levantó?" className="flex flex-col gap-2">
          <p className="text-base font-semibold text-texto">¿En qué tramo se levantó?</p>
          {publicos
            .filter((t) => t.ocupados >= 1)
            .map((t) => (
              <Boton
                key={t.id}
                variante="secundario"
                tamano="grande"
                className={`w-full ${CLASE_ACCION}`}
                onClick={() => void seLevanto(t.id)}
                {...atributosAccion(accion, `levanto-${t.id}`)}
              >
                {`${nombreTramo(fila, t)} · ${t.ocupados} sentados`}
              </Boton>
            ))}
          <Boton variante="fantasma" className="w-full" onClick={() => setEligiendoTramo(false)}>
            Cancelar
          </Boton>
        </div>
      )}

      {corrigiendo && (
        <CorregirConteo fila={fila} accion={accion} onCorregir={onCorregir} onCerrar={() => setCorrigiendo(false)} />
      )}
    </div>
  );
}
