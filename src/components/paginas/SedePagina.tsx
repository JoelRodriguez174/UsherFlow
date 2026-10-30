'use client';

import { useSyncExternalStore } from 'react';
import { leerAcceso } from '@/lib/acceso';
import { SedePanel } from '@/components/sede/SedePanel';
import { PantallaClaveInvalida } from './PantallaClaveInvalida';

const sinSuscripcion = () => () => {};

/**
 * El pastor no usa SalonProvider (sus claves no sirven para obtener_estado_salon): la pantalla pide su propio
 * mapa. La clave se lee de sessionStorage tras hidratar; en el servidor el snapshot es `undefined`.
 */
export function SedePagina() {
  const clave = useSyncExternalStore(
    sinSuscripcion,
    () => leerAcceso()?.clave ?? null,
    () => undefined,
  );

  if (clave === null) return <PantallaClaveInvalida tipo="sede" />;

  return (
    <>
      <header className="safe-top border-b border-borde bg-superficie px-4 pb-3">
        <p className="mx-auto w-full max-w-md font-titulo lg:max-w-6xl text-lg text-texto">UsherFlow</p>
      </header>
      {clave === undefined ? (
        <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
          <p role="status" className="text-base text-texto-suave">
            Cargando…
          </p>
        </main>
      ) : (
        <SedePanel clave={clave} />
      )}
    </>
  );
}
