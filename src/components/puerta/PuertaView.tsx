"use client";

import { useState } from "react";
import { SECCIONES, type Seccion } from "@/domain/types";
import type { ResumenSeccion } from "@/domain/resumen";
import { playSuccessSound } from "@/utils/audio";
import type { SedeVista } from "@/state/derivar";
import { Boton } from "@/components/ui/Boton";

type SeccionPuerta = ResumenSeccion & { pendientes: number };

type PuertaViewProps = {
  secciones: Record<Seccion, SeccionPuerta>;
  /** Hora pico: la Puerta se mantiene mínima y oculta el contador de pendientes. */
  modoPico: boolean;
  /** Sedes con reserva en la sesión en curso. Vacío: no se muestra la fila de chips. */
  sedes?: SedeVista[];
  /** Pasada la liberación no se muestra "quedan N": las reservas ya no se cuidan. */
  liberado?: boolean;
  /** Resumen desde el punto de vista de una sede (su apartado no se descuenta); null = sin sede. */
  resumenParaSede?(sedeId: string | null): Record<Seccion, ResumenSeccion>;
  onMandar(seccion: Seccion, cantidad: number, sedeId: string | null): Promise<{ ok: boolean; error?: string }>;
};

const NOMBRES: Record<Seccion, string> = {
  izquierda: "Izquierda",
  centro: "Centro",
  derecha: "Derecha",
};

// "Mandar 3 al Centro" / "Mandar 3 a la Izquierda"
const DESTINOS: Record<Seccion, string> = {
  izquierda: "a la Izquierda",
  centro: "al Centro",
  derecha: "a la Derecha",
};

const TAMANOS = [
  { valor: 1, texto: "1" },
  { valor: 2, texto: "2" },
  { valor: 3, texto: "3" },
  { valor: 4, texto: "4" },
  { valor: 5, texto: "5+" },
] as const;

function vibrar(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(40);
    }
  } catch {
    // La vibración es un extra: si el navegador la rechaza, no pasa nada.
  }
}

/** Una línea por sector reservado; sección entera (o sin sectores): la línea única de siempre. */
function LineasQuedan({ sede, reserva }: { sede: string; reserva: NonNullable<SedeVista["porSeccion"][Seccion]> }) {
  const sectores = reserva.sectores.filter((s) => s.sectorId !== null);
  if (sectores.length === 0) {
    return <p className="text-base font-semibold text-acento">{`${sede}: quedan ${reserva.quedan}`}</p>;
  }
  return (
    <>
      {sectores.map((s) => (
        <p key={s.sectorId} className="text-base font-semibold text-acento">
          {`${s.nombre} (filas ${s.filaDesde}–${s.filaHasta}): quedan ${s.quedan}`}
        </p>
      ))}
    </>
  );
}

export function PuertaView({ secciones, modoPico, onMandar, sedes = [], liberado = false, resumenParaSede }: PuertaViewProps) {
  const [cantidad, setCantidad] = useState(2);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sedeElegida, setSedeElegida] = useState<string | null>(null);

  // Una sede que ya no existe o está completa se comporta como "Sin sede".
  const sede = sedes.find((x) => x.sedeId === sedeElegida && !x.completo) ?? null;
  const sedeId = sede?.sedeId ?? null;
  const resumen = sede && resumenParaSede ? resumenParaSede(sede.sedeId) : null;

  async function mandar(seccion: Seccion) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await onMandar(seccion, cantidad, sedeId);
      if (resultado.ok) {
        vibrar();
        playSuccessSound();
      } else {
        setError(resultado.error ?? "No se pudo mandar el grupo. Probá de nuevo.");
      }
    } catch {
      setError("No se pudo mandar el grupo. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-4">
      <h1 className="font-titulo text-2xl text-texto">Puerta</h1>

      {sedes.length > 0 && (
        <section aria-labelledby="puerta-sede" className="flex flex-col gap-2">
          <h2 id="puerta-sede" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
            ¿De qué sede?
          </h2>
          <div role="group" aria-labelledby="puerta-sede" className="flex flex-wrap gap-2">
            {[{ sedeId: null, nombre: "Sin sede", completo: false }, ...sedes].map((x) => {
              const activo = sedeId === x.sedeId;
              return (
                <button
                  key={x.sedeId ?? "sin-sede"}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setSedeElegida(x.sedeId)}
                  className={[
                    "min-h-11 rounded-full border px-4 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento",
                    activo
                      ? "border-acento bg-acento text-fondo"
                      : "border-borde bg-superficie-alta text-texto hover:border-texto-suave",
                  ].join(" ")}
                >
                  {x.completo ? `${x.nombre} (completo)` : x.nombre}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="puerta-cuantos" className="flex flex-col gap-2">
        <h2 id="puerta-cuantos" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          ¿Cuántos son?
        </h2>
        <div role="group" aria-labelledby="puerta-cuantos" className="grid grid-cols-5 gap-2">
          {TAMANOS.map(({ valor, texto }) => {
            const activo = cantidad === valor;
            return (
              <button
                key={valor}
                type="button"
                aria-pressed={activo}
                onClick={() => setCantidad(valor)}
                className={[
                  "min-h-14 rounded-2xl border text-xl font-bold transition-colors",
                  activo
                    ? "border-acento bg-acento text-fondo"
                    : "border-borde bg-superficie-alta text-texto hover:border-texto-suave",
                ].join(" ")}
              >
                {texto}
              </button>
            );
          })}
        </div>
      </section>

      {error !== null && (
        <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-3 text-base text-texto">
          {error}
        </p>
      )}

      <section aria-labelledby="puerta-derivar" className="flex flex-col gap-3">
        <h2 id="puerta-derivar" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Derivar a
        </h2>
        {SECCIONES.map((seccion) => {
          const { pendientes } = secciones[seccion];
          const { libres, grupoMaxJunto } = (resumen ?? secciones)[seccion];
          const reservaSede = sede?.porSeccion[seccion];
          const entra = cantidad <= grupoMaxJunto;
          // Un solo sector real para la sede en esta sección: el botón lo nombra (mismo toque, más claro).
          const reales = reservaSede?.sectores.filter((x) => x.sectorId !== null) ?? [];
          const unico = !liberado && reales.length === 1 ? reales[0].nombre : null;
          return (
            <article
              key={seccion}
              aria-labelledby={`puerta-${seccion}`}
              className={`flex flex-col gap-3 rounded-2xl border bg-superficie p-4 ${
                entra ? "border-acento" : "border-borde"
              } ${sede && !reservaSede ? "opacity-70" : ""}`}
            >
              <div className="flex flex-col gap-1">
                <h3 id={`puerta-${seccion}`} className="font-titulo text-xl text-texto">
                  {NOMBRES[seccion]}
                </h3>
                <p className="text-base text-texto-suave">
                  {`hasta ${grupoMaxJunto} juntos · ${libres} libres`}
                </p>
                {sede && reservaSede && !liberado && (
                  <LineasQuedan sede={sede.nombre} reserva={reservaSede} />
                )}
                {!modoPico && pendientes > 0 && (
                  <p className="text-sm text-en-camino">{`${pendientes} sin confirmar`}</p>
                )}
              </div>
              <Boton
                tamano="grande"
                variante={entra ? "primario" : "secundario"}
                disabled={!entra || enviando}
                onClick={() => mandar(seccion)}
                className="w-full"
              >
                {entra ? `Mandar ${cantidad}${sede ? ` de ${sede.nombre}` : ""} ${DESTINOS[seccion]}${unico ? ` — ${unico}` : ""}` : `No entran ${cantidad}`}
              </Boton>
            </article>
          );
        })}
      </section>
    </main>
  );
}
