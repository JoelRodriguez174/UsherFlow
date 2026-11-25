import { useId } from "react";
import { SECCIONES, type Seccion } from "@/domain/types";

export type EstadoSector = "disponible" | "pocos" | "agotado" | "preferido" | "asignado";

export interface SectorMapa {
  id: number;
  seccion: Seccion;
  nombre: string;
  filaDesde: number;
  filaHasta: number;
  estado: EstadoSector;
  detalle?: string;
  /** Capacidad total del sector; junto con `libres` dibuja la barra de ocupación. */
  capacidad?: number;
  /** Lugares todavía libres en el sector (después de descontar lo reservado). */
  libres?: number;
  /** Marca visual para el sector abierto actualmente en el editor. */
  seleccionado?: boolean;
  /** Resalta cuando la reserva de este sector tiene cambios sin confirmar. */
  sinConfirmar?: boolean;
}

interface MapaSalonProps {
  sectores: SectorMapa[];
  onAlternar?(id: number): void;
  deshabilitado?: boolean;
  etiquetaEscenario?: string;
  /** Texto del estado "preferido" (estado y leyenda). El pastor ve "Tu preferencia"; el supervisor, "Pedido por alguna sede". */
  etiquetaPreferido?: string;
  /** Texto del estado "asignado" (estado y leyenda). Por defecto "Asignado"; en reservas del pastor, "Tu reserva". */
  etiquetaAsignado?: string;
  /** Estados visibles en la leyenda inferior. */
  leyenda?: EstadoSector[];
  /** Si es true, también se pueden tocar sectores en estado "asignado" o "pocos" (modo reserva). */
  permitirAsignado?: boolean;
}

const TITULOS: Record<Seccion, string> = { izquierda: "Izquierda", centro: "Centro", derecha: "Derecha" };

// El estado va siempre en texto: el color solo lo refuerza.
const ESTADOS: Record<EstadoSector, { texto: string; clases: string; muestra: string }> = {
  disponible: {
    texto: "Disponible",
    clases: "border-libre bg-superficie text-texto",
    muestra: "border-libre bg-superficie",
  },
  pocos: {
    texto: "Quedan pocos",
    clases: "border-advertencia bg-superficie-alta text-texto",
    muestra: "border-advertencia bg-superficie-alta",
  },
  agotado: {
    texto: "Agotado",
    clases: "border-borde bg-ocupado text-texto",
    muestra: "border-borde bg-ocupado",
  },
  preferido: {
    texto: "Tu preferencia",
    clases: "border-dashed border-acento bg-superficie-alta text-texto",
    muestra: "border-dashed border-acento bg-superficie-alta",
  },
  asignado: {
    texto: "Asignado",
    clases: "border-acento bg-acento text-fondo",
    muestra: "border-acento bg-acento",
  },
};

const LEYENDA_DEFECTO: EstadoSector[] = ["disponible", "agotado", "preferido", "asignado"];

/** Altura mínima suavemente proporcional a la cantidad de filas que abarca el sector. */
function alturaPorFilas(desde: number, hasta: number): string {
  const filas = Math.max(1, hasta - desde + 1);
  if (filas >= 8) return "min-h-24 lg:min-h-28";
  if (filas >= 5) return "min-h-20 lg:min-h-24";
  return "min-h-16 lg:min-h-20";
}

export function MapaSalon({
  sectores,
  onAlternar,
  deshabilitado = false,
  etiquetaEscenario = "ESCENARIO",
  etiquetaPreferido = "Tu preferencia",
  etiquetaAsignado = "Asignado",
  leyenda = LEYENDA_DEFECTO,
  permitirAsignado = false,
}: MapaSalonProps) {
  const prefijoId = useId();
  const textoDe = (e: EstadoSector) => {
    if (e === "preferido") return etiquetaPreferido;
    if (e === "asignado") return etiquetaAsignado;
    return ESTADOS[e].texto;
  };

  if (sectores.length === 0) {
    return <p className="text-base text-texto-suave">El supervisor todavía no definió los sectores.</p>;
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-borde bg-superficie p-3 lg:p-5">
      <div className="mx-auto flex w-4/5 flex-col items-center gap-1">
        <div className="w-full rounded-b-3xl rounded-t-md border-b-2 border-acento/60 bg-superficie-alta py-2 text-center text-xs font-bold tracking-[0.3em] text-texto-suave">
          {etiquetaEscenario}
        </div>
      </div>

      <div className="flex items-stretch">
        {SECCIONES.map((seccion, i) => {
          const idTitulo = `${prefijoId}-mapa-${seccion}`;
          return (
            <div
              key={seccion}
              role="group"
              aria-labelledby={idTitulo}
              className={`flex min-w-0 flex-col gap-2 ${seccion === "centro" ? "flex-[1.7]" : "flex-1"} ${
                i > 0 ? "ml-2 border-l-2 border-dashed border-borde pl-2" : ""
              }`}
            >
              <h3 id={idTitulo} className="text-center text-xs font-bold uppercase tracking-widest text-texto-suave">
                {TITULOS[seccion]}
              </h3>
              {sectores
                .filter((s) => s.seccion === seccion)
                .map((s) => {
                  const { clases } = ESTADOS[s.estado];
                  const alternable =
                    s.estado === "disponible" ||
                    s.estado === "pocos" ||
                    s.estado === "preferido" ||
                    (permitirAsignado && s.estado === "asignado");
                  const inactivo = deshabilitado || !onAlternar || !alternable;
                  const mostrarBarra =
                    typeof s.capacidad === "number" &&
                    s.capacidad > 0 &&
                    typeof s.libres === "number" &&
                    s.estado !== "agotado";
                  const pctOcupado = mostrarBarra
                    ? Math.min(100, Math.max(0, Math.round(((s.capacidad! - s.libres!) / s.capacidad!) * 100)))
                    : 0;

                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={
                        onAlternar && alternable
                          ? permitirAsignado
                            ? Boolean(s.seleccionado)
                            : s.estado === "preferido"
                          : undefined
                      }
                      aria-disabled={inactivo || undefined}
                      onClick={() => {
                        if (!inactivo) onAlternar?.(s.id);
                      }}
                      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1.5 py-2 text-center break-words transition-[filter,transform,border-color] ${alturaPorFilas(s.filaDesde, s.filaHasta)} ${clases} ${
                        inactivo ? "cursor-default" : "cursor-pointer hover:brightness-110 active:scale-[0.99]"
                      } ${s.seleccionado ? "ring-2 ring-texto ring-offset-2 ring-offset-superficie" : ""} ${
                        s.sinConfirmar ? "border-dashed" : ""
                      } ${deshabilitado ? "opacity-60" : ""}`}
                    >
                      <span className="text-sm font-bold leading-tight">{s.nombre}</span>
                      <span className="text-xs opacity-90">{`filas ${s.filaDesde}–${s.filaHasta}`}</span>
                      {s.detalle && <span className="text-xs font-medium tabular-nums">{s.detalle}</span>}
                      <span className="text-xs font-semibold">
                        {textoDe(s.estado)}
                        {s.sinConfirmar ? " · sin confirmar" : ""}
                      </span>
                      {mostrarBarra && (
                        <span
                          aria-hidden="true"
                          className={`mt-1 h-1.5 w-full max-w-20 overflow-hidden rounded-full ${
                            s.estado === "asignado" ? "bg-fondo/25" : "bg-borde/70"
                          }`}
                        >
                          <span
                            className={`block h-full rounded-full transition-[width,background-color] duration-300 ease-out ${
                              s.estado === "asignado"
                                ? "bg-fondo"
                                : s.estado === "pocos"
                                  ? "bg-advertencia"
                                  : "bg-libre"
                            }`}
                            style={{ width: `${pctOcupado}%` }}
                          />
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>

      <ul aria-label="Leyenda" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-texto-suave">
        {leyenda.map((e) => (
          <li key={e} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block size-3 rounded-sm border-2 ${ESTADOS[e].muestra}`} />
            {textoDe(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}
