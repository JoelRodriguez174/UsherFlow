'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SECCIONES, type Rol } from '@/domain/types';
import { guardarAcceso } from '@/lib/acceso';

const ROLES: readonly Rol[] = ['puerta', ...SECCIONES, 'supervisor', 'sede'];

function esRol(v: string | null): v is Rol {
  return v !== null && (ROLES as readonly string[]).includes(v);
}

/** El rol del enlace solo decide a qué pantalla ir; el servidor valida únicamente la clave. */
function destinoDe(rol: Rol): string {
  if (rol === 'puerta') return '/puerta';
  if (rol === 'supervisor') return '/supervisor';
  if (rol === 'sede') return '/sede';
  return `/seccion/${rol}`;
}

export function EntrarContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const clave = params.get('k') ?? '';
  const crudo = params.get('rol');
  const rol = esRol(crudo) ? crudo : null;
  const valido = clave !== '' && rol !== null;

  useEffect(() => {
    if (clave === '' || rol === null) return;
    guardarAcceso(clave, rol);
    // replace: el enlace con la clave no queda en el historial. La pantalla de destino monta su propio
    // SalonProvider, que lee la clave recién guardada al montarse.
    router.replace(destinoDe(rol));
  }, [clave, rol, router]);

  if (!valido) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
        <h1 className="font-titulo text-3xl text-texto">No pudimos abrir el acceso</h1>
        <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
          Este enlace está incompleto o no es válido. Pedile al supervisor que te muestre el QR de nuevo y
          escanealo otra vez.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <h1 className="font-titulo text-3xl text-texto">Entrando…</h1>
      <p role="status" className="text-base text-texto-suave">
        Estamos abriendo tu pantalla.
      </p>
    </main>
  );
}
