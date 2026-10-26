"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Seccion } from "@/domain/types";
import type { FilaVista, PendienteVista, SedeVista } from "@/state/derivar";
import { Aviso } from "@/components/ui/Aviso";
import { Boton } from "@/components/ui/Boton";
import { PendienteCard } from "./PendienteCard";
import { FilaItem } from "./FilaItem";
import { atributosAccion, CLASE_ACCION, useAccionUnica } from "./useAccion";

export type SeccionViewProps = {
  seccion: Seccion;
  filas: FilaVista[];
  pendientes: PendienteVista[];
  sedes: SedeVista[];
  ahoraServidorMs: number;
  /** `fueraDeSector`: sectores de la sede cuando se sentó fuera de ellos (se avisa, no se bloquea). */
  onSentar(pendienteId: string, tramoId: number): Promise<{ ok: boolean; fueraDeSector?: string[] }>;
  onNoLlegaron(pendienteId: string): Promise<boolean>;
  onSeLevanto(tramoId: number): Promise<boolean>;
  onCorregir(tramoId: number, libresVistos: number): Promise<boolean>;
  onJuntar(filaId: number): Promise<boolean>;
  onVerificar(filaId: number): Promise<boolean>;
  onAgregarFila(): Promise<boolean>;
};

const NOMBRES: Record<Seccion, string> = {
  izquierda: "Izquierda",
  centro: "Centro",
  derecha: "Derecha",
};

export function SeccionView({
  seccion,
  filas,
  pendientes,
  sedes,
  ahoraServidorMs,
  onSentar,
  onNoLlegaron,
  onSeLevanto,
  onCorregir,
  onJuntar,
  onVerificar,
  onAgregarFila,
}: SeccionViewProps) {
  const accion = useAccionUnica();
  // Orden fijo como el salón: reordenar al tocar "Ya revisé" ponía otra fila bajo el dedo.
  const misFilas = useMemo(() => [...filas].sort((a, b) => a.fila.numero - b.fila.numero), [filas]);
  const [avisoSector, setAvisoSector] = useState<string | null>(null);
  const primero = pendientes[0];
  const sedeDe = (id: string | null) => sedes.find((s) => s.sedeId === id)?.nombre ?? null;
  const sectoresDe = (id: string | null) => sedes.find((s) => s.sedeId === id)?.porSeccion[seccion]?.sectores;

  async function sentar(pendienteId: string, tramoId: number): Promise<boolean> {
    const sede = sedeDe(pendientes.find((v) => v.pendiente.id === pendienteId)?.pendiente.sedeId ?? null);
    const r = await onSentar(pendienteId, tramoId);
    setAvisoSector(
      r.fueraDeSector ? `Esa fila está fuera del sector asignado a ${sede ?? "la sede"}: ${r.fueraDeSector.join(", ")}` : null,
    );
    return r.ok;
  }
  const resumen = sedes
    .flatMap((s) => {
      const r = s.porSeccion[seccion];
      return r ? [`${s.nombre} ${r.consumido}/${r.cantidad}`] : [];
    })
    .join(" · ");

  return (
    <main className="safe-bottom mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-4">
      <h1 className="font-titulo text-2xl text-texto">{`Sección ${NOMBRES[seccion]}`}</h1>

      <Aviso mensaje={avisoSector} onCerrar={() => setAvisoSector(null)} />

      <div aria-live="polite" className="flex flex-col gap-3">
        {primero ? (
          <PendienteCard
            key={primero.pendiente.id}
            vista={primero}
            filas={filas}
            sede={sedeDe(primero.pendiente.sedeId)}
            sectoresSede={sectoresDe(primero.pendiente.sedeId)}
            esperando={pendientes.length - 1}
            accion={accion}
            onSentar={sentar}
            onNoLlegaron={onNoLlegaron}
          />
        ) : (
          <p className="rounded-2xl border border-borde bg-superficie p-4 text-base text-texto-suave">
            No hay grupos en camino.
          </p>
        )}
      </div>

      <section aria-labelledby="seccion-mis-filas" className="flex flex-col gap-3">
        <h2 id="seccion-mis-filas" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Mis filas
        </h2>
        <ul aria-labelledby="seccion-mis-filas" className="flex flex-col gap-3">
          {misFilas.map((vista) => (
            <li key={vista.fila.id}>
              <FilaItem
                vista={vista}
                ahoraServidorMs={ahoraServidorMs}
                accion={accion}
                onSeLevanto={onSeLevanto}
                onCorregir={onCorregir}
                onJuntar={onJuntar}
                onVerificar={onVerificar}
              />
            </li>
          ))}
        </ul>
        <Boton
          variante="secundario"
          className={`w-full ${CLASE_ACCION}`}
          onClick={() => accion.ejecutar("agregar-fila", onAgregarFila)}
          {...atributosAccion(accion, "agregar-fila")}
        >
          <Plus aria-hidden="true" className="size-5 shrink-0" />
          Agregar fila
        </Boton>
      </section>

      {resumen && <p className="text-sm text-texto-suave">{resumen}</p>}
    </main>
  );
}
