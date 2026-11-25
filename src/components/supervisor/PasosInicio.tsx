'use client';

import Link from 'next/link';
import { Check, ChevronDown, X } from 'lucide-react';
import { Boton } from '@/components/ui/Boton';
import { GuiaUso } from '@/components/ui/GuiaUso';
import { useSalon } from '@/state/SalonProvider';
import { IconoEstado, textoEstado, type TextoEstado } from './BarraPasos';
import { ENLACE_PRIMARIO, EstadoDeCarga } from './EstadoPreparacion';
import { usePreparacion } from './usePreparacion';

const BADGE_ESTADO: Record<TextoEstado, string> = {
  Listo: 'border-libre/50 bg-libre/15 text-libre',
  'Con avisos': 'border-advertencia/50 bg-advertencia/15 text-advertencia',
  Pendiente: 'border-acento/60 bg-acento/15 text-acento',
  Bloqueado: 'border-borde bg-superficie-alta text-texto-suave',
  'Sin revisar': 'border-borde bg-superficie-alta text-texto-suave',
};

export function PasosInicio() {
  const { estado, pasos, recargar } = usePreparacion();
  const { cargando, derivado } = useSalon();
  const revisado = estado === 'listo';
  const { ocupados, capacidad, porcentaje } = derivado.ocupacion;
  const listos = pasos.filter((p) => p.completo).length;
  const pctPasos = pasos.length === 0 ? 0 : Math.round((listos / pasos.length) * 100);
  const proximoPaso = revisado ? pasos.find((p) => !p.completo && !p.bloqueado) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {revisado && (
          <section className="flex flex-col justify-between gap-3 rounded-2xl border border-borde bg-superficie p-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Preparación</p>
              <p className="text-lg font-bold text-texto tabular-nums">
                {listos} de {pasos.length} pasos listos
              </p>
              <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-superficie-alta">
                <div
                  className="h-full rounded-full bg-libre transition-[width] duration-300 ease-out"
                  style={{ width: `${pctPasos}%` }}
                />
              </div>
            </div>
            {proximoPaso && (
              <Link href={proximoPaso.ruta} className={`${ENLACE_PRIMARIO} text-base`}>
                Continuar: {proximoPaso.titulo} →
              </Link>
            )}
          </section>
        )}

        {!cargando && (
          <section className="flex flex-col justify-between gap-2 rounded-2xl border border-borde bg-superficie p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Salón en vivo</p>
            <p className="text-base font-semibold text-texto tabular-nums">
              {`Ocupación: ${ocupados} de ${capacidad} lugares (${porcentaje}%)`}
            </p>
            <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-superficie-alta">
              <div
                className="h-full rounded-full bg-acento transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, porcentaje))}%` }}
              />
            </div>
          </section>
        )}
      </div>

      <EstadoDeCarga estado={estado} recargar={recargar} />

      <ol className="flex flex-col gap-2.5">
        {pasos.map((p, i) => {
          const est = textoEstado(p, revisado);
          // Sin revisar no hay bloqueo que mostrar: la acción queda habilitada y el marco del paso decide.
          const bloqueado = revisado && p.bloqueado;
          const esProximo = proximoPaso?.id === p.id;
          return (
            <li key={p.id}>
              <details
                className={`desplegable-fluido group rounded-2xl border bg-superficie transition-colors ${
                  esProximo ? 'border-acento' : 'border-borde'
                } ${est === 'Bloqueado' ? 'text-texto-suave opacity-85' : 'text-texto'}`}
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-superficie-alta/60 [&::-webkit-details-marker]:hidden">
                  <IconoEstado estado={est} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      <span>
                        <span className="text-texto-suave">{i + 1}</span> <span>{p.titulo}</span>
                      </span>{' '}
                      <span
                        className={
                          revisado
                            ? `inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE_ESTADO[est]}`
                            : 'sr-only'
                        }
                      >
                        {est}
                      </span>
                    </span>
                    {revisado && <span className="text-sm text-texto-suave">{p.resumen}</span>}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-texto-suave transition-transform duration-250 ease-out group-open:rotate-180"
                  />
                </summary>
                <div className="flex flex-col gap-3 border-t border-borde/70 px-4 py-4">
                  {revisado && (
                    <ul className="flex flex-col gap-2 text-base">
                      {p.requisitos.map((r) => (
                        <li key={r.texto} className="flex flex-col">
                          <span className="flex items-start gap-2">
                            {r.ok ? (
                              <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-libre" />
                            ) : (
                              <X aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-peligro" />
                            )}
                            <span className="sr-only">{r.ok ? 'Cumplido' : 'Falta'}</span>
                            {r.texto}
                          </span>
                          {r.ejemplo && <span className="pl-7 text-sm text-texto-suave">Ejemplo: {r.ejemplo}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {revisado && p.avisos.length > 0 && (
                    <ul className="flex flex-col gap-1 rounded-xl border border-advertencia/40 bg-superficie-alta p-3 text-sm text-advertencia">
                      {p.avisos.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                  {bloqueado ? (
                    <>
                      <Boton tamano="grande" disabled aria-describedby={`motivo-${p.id}`}>
                        Completar este paso →
                      </Boton>
                      <p id={`motivo-${p.id}`} className="text-sm text-texto-suave">
                        {p.motivoBloqueo}
                      </p>
                    </>
                  ) : (
                    <Link href={p.ruta} className={ENLACE_PRIMARIO}>
                      Completar este paso →
                    </Link>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      <GuiaUso rol="supervisor" />
    </div>
  );
}
