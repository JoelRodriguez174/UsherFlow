'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, Lock } from 'lucide-react';
import type { Paso, PasoId } from '@/domain/preparacion';
import { usePreparacion } from './usePreparacion';

export type TextoEstado = 'Listo' | 'Con avisos' | 'Pendiente' | 'Bloqueado' | 'Sin revisar';

/** Mientras no esté `listo` (cargando o error) no se afirma nada: ni "listo" ni "bloqueado". */
export function textoEstado(paso: Paso, revisado: boolean): TextoEstado {
  if (!revisado) return 'Sin revisar';
  if (paso.bloqueado) return 'Bloqueado';
  if (!paso.completo) return 'Pendiente';
  return paso.avisos.length > 0 ? 'Con avisos' : 'Listo';
}

const ICONOS = { Listo: CircleCheck, Bloqueado: Lock, 'Sin revisar': CircleDashed, 'Con avisos': CircleAlert, Pendiente: CircleAlert };
const COLORES = { Listo: 'text-libre', Bloqueado: 'text-texto-suave', 'Sin revisar': 'text-texto-suave', 'Con avisos': 'text-advertencia', Pendiente: 'text-advertencia' };

/** ✅ listo, 🟡 falta o con avisos, 🔒 bloqueado: ícono decorativo; el texto va aparte (`sr-only`) después del título. */
export function IconoEstado({ estado }: { estado: TextoEstado }) {
  const Icono = ICONOS[estado];
  return <Icono aria-hidden="true" className={`size-5 shrink-0 ${COLORES[estado]}`} />;
}

export function BarraPasos({ actual }: { actual: PasoId }) {
  const { estado, pasos } = usePreparacion();
  const nav = useRef<HTMLElement>(null);

  // En 360 px la barra desborda: el chip actual se trae a la vista (sin mover la página: block "nearest").
  useEffect(() => {
    nav.current?.querySelector('[aria-current="step"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [actual]);

  return (
    <nav ref={nav} aria-label="Pasos" className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-fondo px-4 py-2 lg:top-6 lg:mx-0 lg:overflow-visible lg:p-0">
      <ol className="flex gap-2 lg:flex-col">
        {pasos.map((p, i) => {
          const est = textoEstado(p, estado === 'listo');
          return (
            <li key={p.id} className="shrink-0 lg:shrink">
              <Link
                href={p.ruta}
                aria-current={p.id === actual ? 'step' : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 lg:flex rounded-2xl border px-3 text-sm ${
                  p.id === actual ? 'border-acento bg-superficie-alta font-semibold text-texto' : 'border-borde bg-superficie text-texto-suave'
                }`}
              >
                <IconoEstado estado={est} />
                <span>
                  {i + 1}. {p.titulo} <span className="sr-only">{est}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
