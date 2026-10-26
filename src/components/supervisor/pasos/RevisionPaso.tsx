'use client';

import Link from 'next/link';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { MarcoPaso } from '@/components/supervisor/MarcoPaso';
import { usePreparacion } from '@/components/supervisor/usePreparacion';

/** Paso 6: repasa los pasos 1 a 5, qué falta en cada uno y qué avisos quedan. */
export function RevisionPaso() {
  const { estado, pasos } = usePreparacion();
  const previos = pasos.filter((p) => p.id !== 'revision');
  // Solo con datos listos: en 'cargando' o 'error' nada de esto es cierto todavía.
  const todoListo = estado === 'listo' && previos.length > 0 && previos.every((p) => p.completo);

  return (
    <MarcoPaso paso="revision">
      <h1 className="font-titulo text-2xl text-texto">Revisión</h1>
      {estado === 'listo' && (
        <>
          {todoListo && (
            <p role="status" className="rounded-2xl border border-acento bg-superficie-alta p-4 text-lg font-semibold text-texto">
              Todo listo
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {previos.map((p) => {
              const [Icono, color] = !p.completo ? [CircleX, 'text-peligro'] : p.avisos.length > 0 ? [TriangleAlert, 'text-advertencia'] : [CircleCheck, 'text-libre'];
              const estadoTexto = !p.completo ? 'Incompleto' : p.avisos.length > 0 ? 'Con avisos' : 'Listo';
              return (
                <li key={p.id} className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie-alta p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-texto">
                      <Icono aria-hidden="true" className={`size-5 shrink-0 ${color}`} />
                      {p.titulo}
                      <span className="sr-only">: {estadoTexto}</span>
                    </h2>
                    <Link href={p.ruta} className="inline-flex min-h-11 items-center text-base font-semibold text-acento">
                      {p.completo ? 'Ver' : 'Completar'}
                      <span className="sr-only"> {p.titulo}</span>
                    </Link>
                  </div>
                  {!p.completo && (
                    <ul className="list-disc pl-5 text-sm text-texto-suave">
                      {p.requisitos.filter((r) => !r.ok).map((r) => <li key={r.texto}>{r.texto}</li>)}
                    </ul>
                  )}
                  {p.avisos.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-texto-suave">
                      {p.avisos.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </MarcoPaso>
  );
}
