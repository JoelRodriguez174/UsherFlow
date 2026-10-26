'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PasoId } from '@/domain/preparacion';
import { Boton } from '@/components/ui/Boton';
import { BarraPasos } from './BarraPasos';
import { usePreparacion } from './usePreparacion';

/**
 * Marco común de las pantallas de cada paso: barra de pasos, el contenido (solo si el paso no está bloqueado)
 * y "Siguiente". Es el `<main>` de la página; el título lo pone el contenido.
 */
export function MarcoPaso({ paso: id, children }: { paso: PasoId; children: ReactNode }) {
  const { estado, pasos, recargar } = usePreparacion();
  const i = pasos.findIndex((p) => p.id === id);
  const paso = pasos[i];
  const siguiente = pasos[i + 1];

  let cuerpo: ReactNode;
  if (estado === 'cargando') {
    cuerpo = <p role="status" className="text-base text-texto-suave">Cargando…</p>;
  } else if (estado === 'error') {
    cuerpo = (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
          No pudimos revisar el estado
        </p>
        <Boton variante="secundario" onClick={recargar}>Probar de nuevo</Boton>
      </div>
    );
  } else if (paso.bloqueado) {
    // Se nombra el mismo paso que dice `motivoBloqueo`; si falta, el incompleto anterior más cercano.
    const bloqueante =
      pasos.find((p) => paso.motivoBloqueo?.endsWith(p.titulo)) ?? pasos.slice(0, i).reverse().find((p) => !p.completo);
    cuerpo = (
      <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie-alta p-4">
        <p className="text-base text-texto">Completá {bloqueante?.titulo ?? 'el paso anterior'} primero</p>
        {bloqueante && (
          <Link href={bloqueante.ruta} className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-acento px-4 text-base font-semibold text-fondo">
            Ir a {bloqueante.titulo}
          </Link>
        )}
      </div>
    );
  } else {
    const falta = paso.requisitos.filter((r) => !r.ok).map((r) => r.texto).join(', ');
    cuerpo = (
      <>
        {children}
        {siguiente &&
          (paso.completo ? (
            <Link href={siguiente.ruta} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-acento px-6 text-lg font-semibold text-fondo">
              Siguiente: {siguiente.titulo}
            </Link>
          ) : (
            <div className="flex flex-col gap-2">
              <Boton tamano="grande" disabled>Siguiente: {siguiente.titulo}</Boton>
              <p className="text-sm text-texto-suave">Falta: {falta}</p>
            </div>
          ))}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <BarraPasos actual={id} />
      {cuerpo}
    </main>
  );
}
