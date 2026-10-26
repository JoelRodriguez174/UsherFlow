'use client';

import Link from 'next/link';
import { Check, ChevronDown, X } from 'lucide-react';
import { Boton } from '@/components/ui/Boton';
import { useSalon } from '@/state/SalonProvider';
import { IconoEstado, textoEstado } from './BarraPasos';
import { ENLACE_PRIMARIO, EstadoDeCarga } from './EstadoPreparacion';
import { usePreparacion } from './usePreparacion';

export function PasosInicio() {
  const { estado, pasos, recargar } = usePreparacion();
  const { cargando, derivado } = useSalon();
  const revisado = estado === 'listo';
  const { ocupados, capacidad, porcentaje } = derivado.ocupacion;

  return (
    <div className="flex flex-col gap-3">
      {!cargando && <p className="text-base text-texto-suave">{`Ocupación: ${ocupados} de ${capacidad} lugares (${porcentaje}%)`}</p>}
      <EstadoDeCarga estado={estado} recargar={recargar} />
      {revisado && <p className="text-base text-texto-suave">{pasos.filter((p) => p.completo).length} de {pasos.length} pasos listos</p>}
      <ol className="flex flex-col gap-2">
        {pasos.map((p, i) => {
          const est = textoEstado(p, revisado);
          // Sin revisar no hay bloqueo que mostrar: la acción queda habilitada y el marco del paso decide.
          const bloqueado = revisado && p.bloqueado;
          return (
            <li key={p.id}>
              <details className={`group rounded-2xl border border-borde bg-superficie ${est === 'Bloqueado' ? 'text-texto-suave' : 'text-texto'}`}>
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                  <IconoEstado estado={est} />
                  <span className="flex flex-1 flex-col">
                    <span className="font-semibold">
                      <span className="text-texto-suave">{i + 1}</span> <span>{p.titulo}</span> <span className="sr-only">{est}</span>
                    </span>
                    {revisado && <span className="text-sm text-texto-suave">{p.resumen}</span>}
                  </span>
                  <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {revisado && (
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
                  )}
                  {revisado && p.avisos.length > 0 && (
                    <ul className="flex flex-col gap-1 text-sm text-advertencia">
                      {p.avisos.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  )}
                  {bloqueado ? (
                    <>
                      <Boton tamano="grande" disabled aria-describedby={`motivo-${p.id}`}>Completar este paso →</Boton>
                      <p id={`motivo-${p.id}`} className="text-sm text-texto-suave">{p.motivoBloqueo}</p>
                    </>
                  ) : (
                    <Link href={p.ruta} className={ENLACE_PRIMARIO}>Completar este paso →</Link>
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
