'use client';

import { useMemo, type ComponentProps } from 'react';
import { Gauge } from 'lucide-react';
import { SECCIONES } from '@/domain/types';
import { useAjusteBooleano } from '@/lib/ajustes';
import { SalonProvider, useSalon } from '@/state/SalonProvider';
import { PuertaView } from '@/components/puerta/PuertaView';
import { ControlSonido } from './ControlSonido';
import { MarcoSalon } from './MarcoSalon';

type SeccionesPuerta = ComponentProps<typeof PuertaView>['secciones'];

export const CLAVE_MODO_PICO = 'usherflow.modoPico';

function ControlModoPico({ activo, onCambiar }: { activo: boolean; onCambiar(v: boolean): void }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={() => onCambiar(!activo)}
      className={[
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium',
        activo ? 'border-acento text-acento' : 'border-borde text-texto-suave',
      ].join(' ')}
    >
      <Gauge aria-hidden="true" className="size-5 shrink-0" />
      Hora pico
    </button>
  );
}

function PuertaContenido() {
  const { derivado, acciones } = useSalon();
  const [modoPico, setModoPico] = useAjusteBooleano(CLAVE_MODO_PICO, false);

  const secciones = useMemo(
    () =>
      Object.fromEntries(
        SECCIONES.map((s) => [
          s,
          { ...derivado.resumenPorSeccion[s], pendientes: derivado.pendientesPorSeccion[s].length },
        ]),
      ) as SeccionesPuerta,
    [derivado],
  );

  return (
    <MarcoSalon
      controles={
        <>
          <ControlModoPico activo={modoPico} onCambiar={setModoPico} />
          <ControlSonido />
        </>
      }
    >
      <PuertaView
        secciones={secciones}
        modoPico={modoPico}
        sedes={derivado.sedes}
        liberado={derivado.liberado}
        resumenParaSede={derivado.resumenParaSede}
        onMandar={acciones.mandar}
      />
    </MarcoSalon>
  );
}

/**
 * El SalonProvider se monta acá, dentro de la página y no en un layout: así, tras /entrar (que guarda la
 * clave y navega), esta página monta un provider nuevo que lee la clave recién guardada.
 */
export function PuertaPagina() {
  return (
    <SalonProvider>
      <PuertaContenido />
    </SalonProvider>
  );
}
