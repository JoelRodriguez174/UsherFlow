'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type DesplegableProps = {
  titulo: string;
  subtitulo?: string;
  icono?: ReactNode;
  abiertoInicial?: boolean;
  children: ReactNode;
};

/** Acordeón con animación fluida por CSS grid (0fr → 1fr) accesible y sin dependencias. */
export function Desplegable({
  titulo,
  subtitulo,
  icono,
  abiertoInicial = false,
  children,
}: DesplegableProps) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const panelId = useId();

  return (
    <div className="rounded-2xl border border-borde bg-superficie transition-colors">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((v) => !v)}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-superficie-alta/70"
      >
        {icono && <span aria-hidden="true" className="shrink-0 text-acento">{icono}</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-semibold text-texto">{titulo}</span>
          {subtitulo && <span className="text-sm text-texto-suave">{subtitulo}</span>}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-5 shrink-0 text-texto-suave transition-transform duration-250 ease-out ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={panelId}
        aria-hidden={!abierto}
        className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
          abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-borde/70 px-4 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
