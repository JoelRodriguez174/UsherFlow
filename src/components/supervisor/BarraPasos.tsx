'use client';

import Link from 'next/link';
import { CircleAlert, CircleCheck, Lock } from 'lucide-react';
import type { Paso, PasoId } from '@/domain/preparacion';
import { usePreparacion } from './usePreparacion';

/** Nunca se muestra "listo" si el estado no se pudo revisar o todavía carga. */
export function textoEstado(paso: Paso, revisado: boolean): 'Listo' | 'Con avisos' | 'Pendiente' | 'Bloqueado' {
  if (paso.bloqueado) return 'Bloqueado';
  if (!revisado || !paso.completo) return 'Pendiente';
  return paso.avisos.length > 0 ? 'Con avisos' : 'Listo';
}

/** ✅ listo, 🟡 falta o con avisos, 🔒 bloqueado: ícono decorativo + texto para lectores de pantalla. */
export function IconoEstado({ estado }: { estado: ReturnType<typeof textoEstado> }) {
  const Icono = estado === 'Listo' ? CircleCheck : estado === 'Bloqueado' ? Lock : CircleAlert;
  const color = estado === 'Listo' ? 'text-libre' : estado === 'Bloqueado' ? 'text-texto-suave' : 'text-advertencia';
  return (
    <>
      <Icono aria-hidden="true" className={`size-5 shrink-0 ${color}`} />
      <span className="sr-only">{estado}</span>
    </>
  );
}

export function BarraPasos({ actual }: { actual: PasoId }) {
  const { estado, pasos } = usePreparacion();
  return (
    <nav aria-label="Pasos" className="-mx-4 overflow-x-auto px-4">
      <ol className="flex gap-2">
        {pasos.map((p, i) => (
          <li key={p.id} className="shrink-0">
            <Link
              href={p.ruta}
              aria-current={p.id === actual ? 'step' : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-2xl border px-3 text-sm ${
                p.id === actual ? 'border-acento bg-superficie-alta font-semibold text-texto' : 'border-borde bg-superficie text-texto-suave'
              }`}
            >
              <IconoEstado estado={textoEstado(p, estado === 'listo')} />
              {i + 1}. {p.titulo}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
