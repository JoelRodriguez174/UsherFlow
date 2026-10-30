'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PasoId } from '@/domain/preparacion';
import { Boton } from '@/components/ui/Boton';
import { BarraPasos } from './BarraPasos';
import { ENLACE_PRIMARIO, EstadoDeCarga } from './EstadoPreparacion';
import { usePreparacion } from './usePreparacion';

/**
 * Marco común de las pantallas de cada paso: barra de pasos, avisos del paso, el contenido (solo si el paso está
 * listo para mostrarse y no bloqueado) y "Siguiente". Es el `<main>` de la página; el título lo pone el contenido.
 * QR es la excepción: sus enlaces y "Renovar claves" no dependen del estado de preparación, así que se ven siempre.
 */
export function MarcoPaso({ paso: id, children }: { paso: PasoId; children: ReactNode }) {
  const { estado, pasos, recargar } = usePreparacion();
  const i = pasos.findIndex((p) => p.id === id);
  const paso = pasos[i];
  const siguiente = pasos[i + 1];

  let cuerpo: ReactNode;
  if (estado !== 'listo') {
    cuerpo = (
      <>
        <EstadoDeCarga estado={estado} recargar={recargar} />
        {id === 'qr' && children}
      </>
    );
  } else if (paso.bloqueado) {
    const bloqueante = pasos.find((p) => p.id === paso.bloqueadoPor);
    cuerpo = (
      <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie-alta p-4">
        <p className="text-base text-texto">Completá {bloqueante?.titulo ?? 'el paso anterior'} primero</p>
        {bloqueante && <Link href={bloqueante.ruta} className={ENLACE_PRIMARIO}>Ir a {bloqueante.titulo}</Link>}
      </div>
    );
  } else {
    const falta = paso.requisitos.filter((r) => !r.ok).map((r) => r.texto).join(', ');
    cuerpo = (
      <>
        {/* Revisión ya lista los avisos de cada paso: repetirlos acá los duplicaría. */}
        {id !== 'revision' && paso.avisos.length > 0 && (
          <ul aria-label="Avisos" className="flex flex-col gap-1 rounded-2xl border border-advertencia bg-superficie-alta p-3 text-sm text-advertencia">
            {paso.avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
        {children}
        {siguiente &&
          (paso.completo ? (
            <Link href={siguiente.ruta} className={ENLACE_PRIMARIO}>Siguiente: {siguiente.titulo}</Link>
          ) : (
            <div className="flex flex-col gap-2">
              <Boton tamano="grande" disabled aria-describedby="motivo-siguiente">Siguiente: {siguiente.titulo}</Boton>
              <p id="motivo-siguiente" className="text-sm text-texto-suave">Falta: {falta}</p>
            </div>
          ))}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-6 lg:grid lg:max-w-6xl lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:pt-6">
      <BarraPasos actual={id} />
      <div className="flex min-w-0 flex-col gap-4 lg:max-w-3xl">{cuerpo}</div>
    </main>
  );
}
