'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import type { Seccion } from '@/domain/types';

export type FiltroZona = 'todas' | Seccion;

const OPCIONES: ReadonlyArray<{ valor: FiltroZona; etiqueta: string; descripcion: string }> = [
  { valor: 'todas', etiqueta: 'Todas las zonas', descripcion: 'Plano completo del salón' },
  { valor: 'izquierda', etiqueta: 'Izquierda', descripcion: 'Solo zona izquierda' },
  { valor: 'centro', etiqueta: 'Centro', descripcion: 'Solo zona central' },
  { valor: 'derecha', etiqueta: 'Derecha', descripcion: 'Solo zona derecha' },
];

type SelectorZonaProps = {
  valor: FiltroZona;
  onCambiar(zona: FiltroZona): void;
};

/** Dropdown animado y accesible para filtrar el mapa por zona (Izquierda, Centro, Derecha o Todas). */
export function SelectorZona({ valor, onCambiar }: SelectorZonaProps) {
  const [abierto, setAbierto] = useState(false);
  const contRef = useRef<HTMLDivElement>(null);
  const listaId = useId();
  const actual = OPCIONES.find((o) => o.valor === valor) ?? OPCIONES[0];

  useEffect(() => {
    if (!abierto) return;
    const alClick = (e: MouseEvent) => {
      if (contRef.current && e.target instanceof Node && !contRef.current.contains(e.target)) {
        setAbierto(false);
      }
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', alClick);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('mousedown', alClick);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  return (
    <div ref={contRef} className="relative inline-block min-w-48">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={listaId}
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl border border-borde bg-superficie-alta px-3.5 text-sm font-semibold text-texto transition-colors hover:border-acento"
      >
        <span className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-acento" />
          <span>{actual.etiqueta}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-texto-suave transition-transform duration-200 ease-out ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={listaId}
        role="listbox"
        aria-label="Elegir zona del salón"
        aria-hidden={!abierto}
        className={`absolute left-0 right-0 z-20 mt-1.5 grid origin-top transition-[grid-template-rows,opacity,transform] duration-200 ease-out ${
          abierto
            ? 'pointer-events-auto translate-y-0 grid-rows-[1fr] opacity-100'
            : 'pointer-events-none -translate-y-1 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden rounded-2xl border border-borde bg-superficie shadow-xl">
          <ul className="flex flex-col p-1.5">
            {OPCIONES.map((op) => {
              const elegida = op.valor === valor;
              return (
                <li key={op.valor}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={elegida}
                    tabIndex={abierto ? 0 : -1}
                    onClick={() => {
                      onCambiar(op.valor);
                      setAbierto(false);
                    }}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                      elegida
                        ? 'bg-acento/15 text-texto'
                        : 'text-texto-suave hover:bg-superficie-alta hover:text-texto'
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{op.etiqueta}</span>
                      <span className="text-xs text-texto-suave">{op.descripcion}</span>
                    </span>
                    {elegida && <Check aria-hidden="true" className="size-4 shrink-0 text-acento" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
