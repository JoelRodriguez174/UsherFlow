import { SECCIONES, type Seccion } from "@/domain/types";

export type EstadoSector = "disponible" | "agotado" | "preferido" | "asignado";

export interface SectorMapa {
  id: number;
  seccion: Seccion;
  nombre: string;
  filaDesde: number;
  filaHasta: number;
  estado: EstadoSector;
  detalle?: string;
}

interface MapaSalonProps {
  sectores: SectorMapa[];
  onAlternar?(id: number): void;
  deshabilitado?: boolean;
  etiquetaEscenario?: string;
  /** Texto del estado "preferido" (estado y leyenda). El pastor ve "Tu preferencia"; el supervisor, "Pedido por alguna sede". */
  etiquetaPreferido?: string;
}

const TITULOS: Record<Seccion, string> = { izquierda: "Izquierda", centro: "Centro", derecha: "Derecha" };

// El estado va siempre en texto: el color solo lo refuerza.
const ESTADOS: Record<EstadoSector, { texto: string; clases: string; muestra: string }> = {
  disponible: { texto: "Disponible", clases: "border-libre bg-superficie text-texto", muestra: "border-libre bg-superficie" },
  agotado: { texto: "Agotado", clases: "border-borde bg-ocupado text-texto", muestra: "border-borde bg-ocupado" },
  preferido: {
    texto: "Tu preferencia",
    clases: "border-dashed border-acento bg-superficie-alta text-texto",
    muestra: "border-dashed border-acento bg-superficie-alta",
  },
  asignado: { texto: "Asignado", clases: "border-acento bg-acento text-fondo", muestra: "border-acento bg-acento" },
};

const LEYENDA: EstadoSector[] = ["disponible", "agotado", "preferido", "asignado"];

export function MapaSalon({
  sectores,
  onAlternar,
  deshabilitado = false,
  etiquetaEscenario = "ESCENARIO",
  etiquetaPreferido = "Tu preferencia",
}: MapaSalonProps) {
  const textoDe = (e: EstadoSector) => (e === "preferido" ? etiquetaPreferido : ESTADOS[e].texto);
  if (sectores.length === 0) {
    return <p className="text-base text-texto-suave">El supervisor todavía no definió los sectores.</p>;
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-borde bg-superficie p-3">
      <div className="mx-auto w-3/5 rounded bg-superficie-alta py-2 text-center text-xs font-bold tracking-[0.3em] text-texto-suave">
        {etiquetaEscenario}
      </div>

      <div className="flex items-stretch">
        {SECCIONES.map((seccion, i) => {
          const idTitulo = `mapa-${seccion}`;
          return (
            <div
              key={seccion}
              role="group"
              aria-labelledby={idTitulo}
              className={`flex min-w-0 flex-col gap-1.5 ${seccion === "centro" ? "flex-[1.7]" : "flex-1"} ${
                i > 0 ? "ml-2 border-l-2 border-borde pl-2" : ""
              }`}
            >
              <h3 id={idTitulo} className="text-center text-xs font-bold uppercase tracking-widest text-texto-suave">
                {TITULOS[seccion]}
              </h3>
              {sectores
                .filter((s) => s.seccion === seccion)
                .map((s) => {
                  const { clases } = ESTADOS[s.estado];
                  const alternable = s.estado === "disponible" || s.estado === "preferido";
                  const inactivo = deshabilitado || !onAlternar || !alternable;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={onAlternar && alternable ? s.estado === "preferido" : undefined}
                      aria-disabled={inactivo || undefined}
                      onClick={() => {
                        if (!inactivo) onAlternar?.(s.id);
                      }}
                      className={`flex min-h-16 min-w-0 flex-col items-center justify-center rounded-lg border-2 px-1 py-2 text-center break-words transition-colors ${clases} ${
                        inactivo ? "cursor-default" : "cursor-pointer hover:brightness-110"
                      } ${deshabilitado ? "opacity-60" : ""}`}
                    >
                      <span className="text-sm font-bold">{s.nombre}</span>
                      <span className="text-xs">{`filas ${s.filaDesde}–${s.filaHasta}`}</span>
                      {s.detalle && <span className="text-xs">{s.detalle}</span>}
                      <span className="text-xs font-semibold">{textoDe(s.estado)}</span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>

      <ul aria-label="Leyenda" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-texto-suave">
        {LEYENDA.map((e) => (
          <li key={e} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block size-3 rounded-sm border-2 ${ESTADOS[e].muestra}`} />
            {textoDe(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}
