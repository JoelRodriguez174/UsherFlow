'use client';

import { useId, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Seccion } from '@/domain/types';
import { acotarCantidad } from '@/domain/reservasMapa';
import { Boton } from '@/components/ui/Boton';

const NOMBRES_SECCION: Record<Seccion, string> = {
  izquierda: 'Izquierda',
  centro: 'Centro',
  derecha: 'Derecha',
};

export type SectorEditable = {
  id: number;
  seccion: Seccion;
  nombre: string;
  filaDesde: number;
  filaHasta: number;
  disponibles: number;
  capacidad: number;
};

type EditorSectorProps = {
  sector: SectorEditable;
  cantidadActual: number;
  /** Se dispara en vivo cada vez que cambia el valor para sincronizar la barra del mapa. */
  onCambiar?(cantidad: number): void;
  onAplicar(cantidad: number): void;
  onCancelar(): void;
};

export function EditorSector({ sector, cantidadActual, onCambiar, onAplicar, onCancelar }: EditorSectorProps) {
  const inputId = useId();
  const inicial = cantidadActual > 0 ? cantidadActual : Math.min(1, sector.disponibles);
  const [texto, setTexto] = useState(() => String(inicial));

  const numero = acotarCantidad(texto.trim() === '' ? 0 : Number(texto), sector.disponibles);
  const libresDespues = Math.max(0, sector.disponibles - numero);
  const otrasSedes = Math.max(0, sector.capacidad - sector.disponibles);
  const cap = Math.max(1, sector.capacidad);
  const pctOtras = Math.min(100, Math.round((otrasSedes / cap) * 100));
  const pctPropio = Math.min(100 - pctOtras, Math.round((numero / cap) * 100));

  function fijar(nuevo: number) {
    const acotado = acotarCantidad(nuevo, sector.disponibles);
    setTexto(String(acotado));
    onCambiar?.(acotado);
  }

  function alEscribir(valor: string) {
    setTexto(valor);
    const parsed = valor.trim() === '' ? 0 : Number(valor);
    onCambiar?.(acotarCantidad(parsed, sector.disponibles));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    onAplicar(numero);
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          {`${NOMBRES_SECCION[sector.seccion]} · filas ${sector.filaDesde}–${sector.filaHasta}`}
        </p>
        <p className="text-base text-texto tabular-nums">
          {sector.disponibles === 1
            ? 'Podés reservar hasta 1 lugar en este sector.'
            : `Podés reservar hasta ${sector.disponibles} lugares en este sector.`}
        </p>
      </div>

      {/* Barra interactiva de ocupación del sector sincronizada con el contador */}
      <div className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-fondo/70 p-3">
        <div className="flex items-baseline justify-between gap-2 text-xs font-medium text-texto-suave tabular-nums">
          <span>{`Tu reserva: ${numero}`}</span>
          <span>{libresDespues === 1 ? '1 libre' : `${libresDespues} libres`}</span>
        </div>
        <div
          aria-hidden="true"
          className="flex h-3 w-full overflow-hidden rounded-full bg-superficie-alta"
        >
          {pctOtras > 0 && (
            <div
              className="h-full bg-ocupado transition-[width] duration-300 ease-out"
              style={{ width: `${pctOtras}%` }}
            />
          )}
          <div
            className="h-full bg-acento transition-[width] duration-300 ease-out"
            style={{ width: `${pctPropio}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold text-texto-suave">
          Cantidad de lugares
        </label>
        <div className="flex items-center gap-2">
          <Boton
            variante="secundario"
            tamano="grande"
            etiqueta="Restar 1 lugar"
            disabled={numero <= 0}
            onClick={() => fijar(numero - 1)}
            className="min-w-12 px-3"
          >
            <Minus aria-hidden="true" className="size-5" />
          </Boton>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            max={sector.disponibles}
            value={texto}
            data-autofocus
            onChange={(e) => alEscribir(e.target.value)}
            onBlur={() => setTexto(String(numero))}
            className="min-h-12 w-full rounded-2xl border border-borde bg-fondo px-3 text-center text-xl font-bold text-texto tabular-nums"
          />
          <Boton
            variante="secundario"
            tamano="grande"
            etiqueta="Sumar 1 lugar"
            disabled={numero >= sector.disponibles}
            onClick={() => fijar(numero + 1)}
            className="min-w-12 px-3"
          >
            <Plus aria-hidden="true" className="size-5" />
          </Boton>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-texto-suave tabular-nums">
          <span>{libresDespues === 1 ? 'Quedaría 1 lugar libre' : `Quedarían ${libresDespues} lugares libres`}</span>
          {sector.disponibles >= 5 && numero < sector.disponibles && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fijar(numero + 5)}
                className="min-h-9 rounded-xl border border-borde bg-superficie-alta px-3 text-sm font-semibold text-texto transition-colors hover:border-texto-suave"
              >
                +5
              </button>
              {sector.disponibles >= 10 && numero + 10 <= sector.disponibles && (
                <button
                  type="button"
                  onClick={() => fijar(numero + 10)}
                  className="min-h-9 rounded-xl border border-borde bg-superficie-alta px-3 text-sm font-semibold text-texto transition-colors hover:border-texto-suave"
                >
                  +10
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Boton type="submit" tamano="grande" className="w-full">
          {numero === 0 ? 'Quitar de mi reserva' : `Aplicar ${numero} ${numero === 1 ? 'lugar' : 'lugares'}`}
        </Boton>
        <div className="flex gap-2">
          {cantidadActual > 0 && (
            <Boton
              variante="secundario"
              className="flex-1"
              onClick={() => onAplicar(0)}
            >
              <Trash2 aria-hidden="true" className="size-4 shrink-0" />
              Quitar reserva
            </Boton>
          )}
          <Boton variante="fantasma" className="flex-1" onClick={onCancelar}>
            Cancelar
          </Boton>
        </div>
      </div>
    </form>
  );
}
