'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { guardarAcceso } from '@/lib/acceso';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { MarcaICC } from '@/components/ui/MarcaICC';
import { CLASE_INPUT } from './estilos';

/** Ruta apartada (sin enlaces públicos) para que el supervisor ingrese su clave directamente. */
export function AccesoSupervisor() {
  const router = useRouter();
  const idClave = useId();
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);

  function entrar(e: FormEvent) {
    e.preventDefault();
    const limpia = clave.trim();
    if (!limpia) {
      setError('Ingresá la clave de supervisor.');
      return;
    }
    guardarAcceso(limpia, 'supervisor');
    router.replace('/supervisor');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <MarcaICC subtitulo="Panel de Administración" tamano="grande" />

      <Aviso mensaje={error} tipo="error" onCerrar={() => setError(null)} />

      <section className="rounded-3xl border border-borde bg-superficie p-6 shadow-xl">
        <form onSubmit={entrar} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-acento">
            <LockKeyhole aria-hidden="true" className="size-4" />
            <span>Acceso reservado para supervisores</span>
          </div>
          <h1 className="font-titulo text-2xl text-texto">Ingresar al panel</h1>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={idClave} className="text-base text-texto">
              Clave de supervisor
            </label>
            <input
              id={idClave}
              type="password"
              autoComplete="off"
              required
              placeholder="Pegá tu clave de supervisor"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className={CLASE_INPUT}
            />
          </div>
          <Boton type="submit" tamano="grande" className="w-full">
            Entrar al panel
          </Boton>
        </form>
      </section>
    </main>
  );
}
