'use client';

import { Boton } from '@/components/ui/Boton';

/** `Link` con el aspecto del botón primario (el `Boton` solo renderiza `<button>`). */
export const ENLACE_PRIMARIO =
  'inline-flex min-h-12 items-center justify-center rounded-2xl bg-acento px-6 text-lg font-semibold text-fondo';

/** "Cargando…" o "No pudimos revisar el estado" + reintento; no muestra nada cuando el estado ya está `listo`. */
export function EstadoDeCarga({ estado, recargar }: { estado: 'cargando' | 'error' | 'listo'; recargar(): void }) {
  if (estado === 'cargando') return <p role="status" className="text-base text-texto-suave">Cargando…</p>;
  if (estado === 'listo') return null;
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
        No pudimos revisar el estado
      </p>
      <Boton variante="secundario" onClick={recargar}>Probar de nuevo</Boton>
    </div>
  );
}
