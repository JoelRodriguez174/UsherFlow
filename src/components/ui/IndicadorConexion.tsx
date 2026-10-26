import { LoaderCircle, Wifi, WifiOff } from "lucide-react";
import { Boton } from "./Boton";

type IndicadorConexionProps = {
  estado: "connected" | "reconnecting" | "offline";
  sincronizando?: boolean;
  onReintentar(): void;
};

const TEXTO = {
  connected: "Conectado",
  reconnecting: "Reconectando…",
  offline: "Sin conexión",
} as const;

const COLOR = {
  connected: "text-libre",
  reconnecting: "text-advertencia",
  offline: "text-peligro",
} as const;

export function IndicadorConexion({
  estado,
  sincronizando = false,
  onReintentar,
}: IndicadorConexionProps) {
  const Icono = estado === "offline" ? WifiOff : estado === "reconnecting" ? LoaderCircle : Wifi;
  const girar = estado === "reconnecting" ? "animate-spin" : "";

  return (
    <div className="flex items-center gap-2">
      {/* El estado siempre va en texto; el color y el ícono solo lo refuerzan. */}
      <p role="status" className={`flex items-center gap-1.5 text-sm font-medium ${COLOR[estado]}`}>
        <Icono aria-hidden="true" className={`size-4 shrink-0 ${girar}`} />
        <span>{TEXTO[estado]}</span>
        {sincronizando && <span className="text-texto-suave">· Sincronizando…</span>}
      </p>
      {estado !== "connected" && (
        <Boton variante="secundario" onClick={onReintentar} className="min-h-11 text-sm">
          Reintentar
        </Boton>
      )}
    </div>
  );
}
