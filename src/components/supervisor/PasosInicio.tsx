'use client';

import Link from 'next/link';
import { Check, ChevronDown, X } from 'lucide-react';
import { Boton } from '@/components/ui/Boton';
import { IconoEstado, textoEstado } from './BarraPasos';
import { usePreparacion } from './usePreparacion';

export function PasosInicio() {
  const { estado, pasos, recargar } = usePreparacion();
  const revisado = estado === 'listo';
  const listos = revisado ? pasos.filter((p) => p.completo).length : 0;

  return (
    <div className="flex flex-col gap-3">
      {estado === 'cargando' && <p role="status" className="text-base text-texto-suave">Cargando…</p>}
      {estado === 'error' && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
            No pudimos revisar el estado
          </p>
          <Boton variante="secundario" onClick={recargar}>Probar de nuevo</Boton>
        </div>
      )}
      <p className="text-base text-texto-suave">{listos} de {pasos.length} pasos listos</p>
      <ol className="flex flex-col gap-2">
        {pasos.map((p) => {
          const est = textoEstado(p, revisado);
          return (
            <li key={p.id}>
              <details className={`group rounded-2xl border border-borde bg-superficie ${est === 'Bloqueado' ? 'text-texto-suave' : 'text-texto'}`}>
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                  <IconoEstado estado={est} />
                  <span className="flex flex-1 flex-col">
                    <span className="font-semibold">{p.titulo}</span>
                    <span className="text-sm text-texto-suave">{p.resumen}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  <ul className="flex flex-col gap-2 text-base">
                    {p.requisitos.map((r) => (
                      <li key={r.texto} className="flex flex-col">
                        <span className="flex items-start gap-2">
                          {r.ok ? <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-libre" /> : <X aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-peligro" />}
                          <span className="sr-only">{r.ok ? 'Cumplido' : 'Falta'}</span>
                          {r.texto}
                        </span>
                        {r.ejemplo && <span className="pl-7 text-sm text-texto-suave">Ejemplo: {r.ejemplo}</span>}
                      </li>
                    ))}
                  </ul>
                  {p.avisos.length > 0 && (
                    <ul className="flex flex-col gap-1 text-sm text-advertencia">
                      {p.avisos.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  )}
                  {p.bloqueado ? (
                    <>
                      <Boton tamano="grande" disabled>Completar este paso →</Boton>
                      <p className="text-sm text-texto-suave">{p.motivoBloqueo}</p>
                    </>
                  ) : (
                    <Link href={p.ruta} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-acento px-6 text-lg font-semibold text-fondo">
                      Completar este paso →
                    </Link>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
