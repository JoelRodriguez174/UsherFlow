'use client';

import type { ReactNode } from 'react';
import { useSalon } from '@/state/SalonProvider';
import { Aviso } from '@/components/ui/Aviso';
import { IndicadorConexion } from '@/components/ui/IndicadorConexion';
import { PantallaClaveInvalida } from './PantallaClaveInvalida';

type MarcoSalonProps = {
  /** Controles propios de la pantalla (sonido, modo pico) que van en el encabezado. */
  controles?: ReactNode;
  children: ReactNode;
};

/**
 * Estructura común de las pantallas de rol. Debe ir DENTRO de un <SalonProvider>.
 * Un solo <main> por página: lo aporta la vista (Puerta, Sección) o `children`; acá solo hay
 * un <header> y, mientras carga, un <main> de espera.
 */
export function MarcoSalon({ controles, children }: MarcoSalonProps) {
  const { claveInvalida, cargando, conexion, error, limpiarError } = useSalon();

  if (claveInvalida) return <PantallaClaveInvalida />;

  return (
    <>
      <header className="safe-top border-b border-borde bg-superficie px-4 pb-3">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="font-titulo text-lg text-texto">UsherFlow</p>
            {controles !== undefined && <div className="flex items-center gap-2">{controles}</div>}
          </div>
          <IndicadorConexion estado={conexion} onReintentar={() => window.location.reload()} />
          <Aviso mensaje={error} tipo="error" onCerrar={limpiarError} />
        </div>
      </header>
      {cargando ? (
        <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
          <p role="status" className="text-base text-texto-suave">
            Cargando el salón…
          </p>
        </main>
      ) : (
        children
      )}
    </>
  );
}
