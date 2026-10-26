"use client";

import { useState } from "react";
import { Armchair, TriangleAlert } from "lucide-react";
import { sugerirUbicacion } from "@/domain/sugerencia";
import type { FilaVista, PendienteVista, SectorVista } from "@/state/derivar";
import { Boton } from "@/components/ui/Boton";
import { ElegirUbicacion } from "./ElegirUbicacion";
import { atributosAccion, CLASE_ACCION, type Accion } from "./useAccion";
import { nombreTramo, opcionesUbicacion, tramosPublicos } from "./helpers";

type PendienteCardProps = {
  vista: PendienteVista;
  filas: FilaVista[];
  /** Nombre de la sede de la que viene el grupo; null si no tiene o no se conoce. */
  sede: string | null;
  /** Sectores de esa sede en esta sección; sin sectores (o sección entera) no se muestra nada. */
  sectoresSede?: SectorVista[];
  /** Cuántos grupos más esperan detrás de este. */
  esperando: number;
  accion: Accion;
  onSentar(pendienteId: string, tramoId: number): Promise<boolean>;
  onNoLlegaron(pendienteId: string): Promise<boolean>;
};

export function PendienteCard({ vista, filas, sede, sectoresSede = [], esperando, accion, onSentar, onNoLlegaron }: PendienteCardProps) {
  const { pendiente, ambar } = vista;
  const [eligiendo, setEligiendo] = useState(false);

  const conFilas = sectoresSede.filter((s) => s.sectorId !== null);
  // Con sectores asignados a la sede se prueba primero dentro de sus filas; si ahí no entra, cae a toda la sección.
  const enSector = filas.filter((v) =>
    conFilas.some((s) => s.filaDesde !== null && s.filaHasta !== null && v.fila.numero >= s.filaDesde && v.fila.numero <= s.filaHasta),
  );
  const sugerida =
    (conFilas.length > 0 ? sugerirUbicacion(enSector.map((v) => v.fila), pendiente.cantidad) : null) ??
    sugerirUbicacion(filas.map((v) => v.fila), pendiente.cantidad);
  const filaSugerida = sugerida ? filas.find((v) => v.fila.id === sugerida.filaId)?.fila : undefined;
  const tramoSugerido = filaSugerida?.tramos.find((t) => t.id === sugerida?.tramoId);
  const destino = filaSugerida && tramoSugerido ? { fila: filaSugerida, tramo: tramoSugerido } : null;

  const opciones = opcionesUbicacion(filas, pendiente.cantidad);
  // "Otra fila…" solo tiene sentido si hay algo más que la fila ya sugerida.
  const hayOtras = opciones.some((o) => o.tramo.id !== destino?.tramo.id);

  let textoSentar = "";
  if (destino) {
    textoSentar = `Sentar en Fila ${destino.fila.numero}`;
    if (tramosPublicos(destino.fila).length > 1) textoSentar += ` · ${nombreTramo(destino.fila, destino.tramo)}`;
  }

  const textoSectores = sede && conFilas.length > 0
    ? `Sede ${sede}: ${conFilas.map((s) => `${s.nombre} (filas ${s.filaDesde}–${s.filaHasta})`).join(", ")}`
    : null;

  const titulo = pendiente.cantidad === 1 ? "Viene 1" : `Vienen ${pendiente.cantidad}`;

  return (
    <article
      aria-labelledby={`pendiente-${pendiente.id}`}
      className={`flex flex-col gap-3 rounded-3xl border-2 bg-superficie p-4 ${
        ambar ? "border-advertencia" : "border-acento"
      }`}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wider text-texto-suave">Vienen de la puerta</p>
        <h2 id={`pendiente-${pendiente.id}`} className="font-titulo text-4xl font-bold text-texto">
          {titulo}
        </h2>
        {sede && <p className="text-lg font-semibold text-texto">{`${pendiente.cantidad} de ${sede}`}</p>}
        {textoSectores && <p className="text-base text-texto-suave">{textoSectores}</p>}
        {ambar && (
          <p role="status" className="flex items-center gap-2 text-lg font-semibold text-advertencia">
            <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
            Falta confirmar
          </p>
        )}
        {esperando > 0 && (
          <p className="text-sm text-texto-suave">
            {esperando === 1 ? "1 grupo más esperando" : `${esperando} grupos más esperando`}
          </p>
        )}
      </div>

      {destino ? (
        <Boton
          tamano="grande"
          className={`w-full ${CLASE_ACCION}`}
          onClick={() => accion.ejecutar("sentar", () => onSentar(pendiente.id, destino.tramo.id))}
          {...atributosAccion(accion, "sentar")}
        >
          <Armchair aria-hidden="true" className="size-6 shrink-0" />
          {textoSentar}
        </Boton>
      ) : (
        <>
          <p className="text-base text-texto-suave">{`No hay lugar para ${pendiente.cantidad} juntos en tus filas.`}</p>
          {opciones.length > 0 && (
            <Boton tamano="grande" className="w-full" onClick={() => setEligiendo(true)}>
              Elegir fila…
            </Boton>
          )}
        </>
      )}

      <div className={`grid gap-2 ${destino && hayOtras ? "grid-cols-2" : "grid-cols-1"}`}>
        {destino && hayOtras && (
          <Boton variante="secundario" className="w-full" onClick={() => setEligiendo(true)}>
            Otra fila…
          </Boton>
        )}
        <Boton
          variante={opciones.length === 0 ? "primario" : "secundario"}
          tamano={opciones.length === 0 ? "grande" : "normal"}
          className={`w-full ${CLASE_ACCION}`}
          onClick={() => accion.ejecutar("no-llegaron", () => onNoLlegaron(pendiente.id))}
          {...atributosAccion(accion, "no-llegaron")}
        >
          No llegaron
        </Boton>
      </div>

      {eligiendo && (
        <ElegirUbicacion
          cantidad={pendiente.cantidad}
          filas={filas}
          accion={accion}
          clave="sentar"
          onElegir={(tramoId) => onSentar(pendiente.id, tramoId)}
          onCerrar={() => setEligiendo(false)}
        />
      )}
    </article>
  );
}
