import { CircleAlert, Info, X } from "lucide-react";

type AvisoProps = {
  mensaje: string | null;
  tipo?: "error" | "info";
  onCerrar(): void;
};

const ESTILOS = {
  error: "border-peligro text-texto",
  info: "border-borde text-texto",
} as const;

export function Aviso({ mensaje, tipo = "info", onCerrar }: AvisoProps) {
  if (mensaje === null) return null;

  const esError = tipo === "error";
  const Icono = esError ? CircleAlert : Info;

  return (
    <div
      role={esError ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl border bg-superficie-alta p-3 ${ESTILOS[tipo]}`}
    >
      <Icono
        aria-hidden="true"
        className={`mt-0.5 size-5 shrink-0 ${esError ? "text-peligro" : "text-acento"}`}
      />
      <p className="min-w-0 flex-1 py-0.5 text-base">{mensaje}</p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={onCerrar}
        className="-my-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-superficie hover:text-texto"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
