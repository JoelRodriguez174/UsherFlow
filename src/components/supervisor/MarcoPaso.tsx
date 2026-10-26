'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PasoId } from '@/domain/preparacion';
import { Boton } from '@/components/ui/Boton';
import { BarraPasos } from './BarraPasos';
import { ENLACE_PRIMARIO, EstadoDeCarga } from './EstadoPreparacion';
import { usePreparacion } from './usePreparacion';

/**
 * Marco común de las pantallas de cada paso: barra de pasos, el contenido (solo si el paso está listo para
 * mostrarse y no bloqueado) y "Siguiente". Es el `<main>` de la página; el título lo pone el contenido.
 */
export function MarcoPaso({ paso: id, children }: { paso: PasoId; children: ReactNode }) {
  const { estado, pasos, recargar } = usePreparacion();
  const i = pasos.findIndex((p) => p.id === id);
  const paso = pasos[i];
  const siguiente = pasos[i + 1];

  let cuerpo: ReactNode;
  if (estado !== 'listo') {
    cuerpo = <EstadoDeCarga estado={estado} recargar={recargar} />;
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
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-6">
      <BarraPasos actual={id} />
      {cuerpo}
    </main>
  );
}
