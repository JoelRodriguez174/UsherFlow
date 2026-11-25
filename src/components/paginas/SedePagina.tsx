'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { leerAcceso } from '@/lib/acceso';
import { Boton } from '@/components/ui/Boton';
import { SedePanel } from '@/components/sede/SedePanel';

type EventoPastor = {
  id: string;
  nombre: string;
  fecha_limite: string | null;
  abierto: boolean;
};

type EstadoAcceso =
  | { tipo: 'cargando' }
  | { tipo: 'autenticado'; sedeNombre: string; eventos: EventoPastor[] }
  | { tipo: 'clave_legacy'; clave: string }
  | { tipo: 'sin_sesion' };

/**
 * Pantalla del pastor de sede: usa la sesión autenticada con 2FA (cookies HttpOnly vía /api/sede/sesion).
 * Si no hay sesión ni clave heredada, redirige a `/sede/ingresar`.
 */
export function SedePagina() {
  const router = useRouter();
  const [acceso, setAcceso] = useState<EstadoAcceso>({ tipo: 'cargando' });
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    async function comprobar() {
      try {
        const res = await fetch('/api/sede/sesion');
        if (res.ok) {
          const data = (await res.json()) as {
            autenticado?: boolean;
            sede?: { nombre?: string };
            eventos?: EventoPastor[];
          };
          if (vivo && data.autenticado) {
            const lista = Array.isArray(data.eventos) ? data.eventos : [];
            setAcceso({ tipo: 'autenticado', sedeNombre: data.sede?.nombre ?? 'Mi sede', eventos: lista });
            if (lista[0]) setEventoId(lista[0].id);
            return;
          }
        }
      } catch {
        // Si falla la consulta, probamos fallback legacy o pedimos ingreso.
      }
      if (!vivo) return;
      const legacy = leerAcceso()?.clave ?? null;
      if (legacy) {
        setAcceso({ tipo: 'clave_legacy', clave: legacy });
      } else {
        setAcceso({ tipo: 'sin_sesion' });
      }
    }
    void comprobar();
    return () => {
      vivo = false;
    };
  }, []);

  async function cerrarSesion() {
    if (saliendo) return;
    setSaliendo(true);
    try {
      await fetch('/api/sede/auth/salir', { method: 'POST' });
    } finally {
      router.replace('/sede/ingresar');
    }
  }

  return (
    <>
      <header className="safe-top border-b border-borde bg-superficie px-4 pb-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 lg:max-w-7xl">
          <p className="font-titulo text-lg text-texto">UsherFlow</p>
          {acceso.tipo === 'autenticado' && (
            <button
              type="button"
              disabled={saliendo}
              onClick={() => void cerrarSesion()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-borde px-3 text-sm font-medium text-texto-suave transition-colors hover:border-texto-suave hover:text-texto"
            >
              <LogOut aria-hidden="true" className="size-4 shrink-0" />
              {saliendo ? 'Saliendo…' : 'Cerrar sesión'}
            </button>
          )}
        </div>
      </header>

      {acceso.tipo === 'cargando' && (
        <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
          <p role="status" className="text-base text-texto-suave">
            Cargando…
          </p>
        </main>
      )}

      {acceso.tipo === 'sin_sesion' && (
        <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
          <h1 className="font-titulo text-3xl text-texto">Ingresá con tu cuenta de sede</h1>
          <p className="text-base text-texto-suave">
            Para ver el mapa y reservar lugares para tu sede necesitás iniciar sesión con tu email autorizado y el código de verificación.
          </p>
          <Link
            href="/sede/ingresar"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-acento px-6 text-lg font-semibold text-fondo hover:brightness-110"
          >
            Ingresar a mi sede
          </Link>
        </main>
      )}

      {acceso.tipo === 'clave_legacy' && <SedePanel clave={acceso.clave} />}

      {acceso.tipo === 'autenticado' && (
        <>
          {acceso.eventos.length === 0 ? (
            <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
              <h1 className="font-titulo text-3xl text-texto">{acceso.sedeNombre}</h1>
              <p className="text-base text-texto-suave">Todavía no hay ningún evento abierto para reservar.</p>
            </main>
          ) : (
            <>
              {acceso.eventos.length > 1 && (
                <div className="mx-auto flex w-full max-w-md flex-wrap items-center gap-2 px-4 pt-4 lg:max-w-7xl">
                  <span className="text-sm font-semibold uppercase tracking-wider text-texto-suave">Evento:</span>
                  {acceso.eventos.map((ev) => (
                    <Boton
                      key={ev.id}
                      variante={ev.id === (eventoId ?? acceso.eventos[0].id) ? 'primario' : 'secundario'}
                      aria-pressed={ev.id === (eventoId ?? acceso.eventos[0].id)}
                      onClick={() => setEventoId(ev.id)}
                    >
                      {ev.nombre}
                    </Boton>
                  ))}
                </div>
              )}
              <SedePanel
                key={eventoId ?? acceso.eventos[0].id}
                eventoId={eventoId ?? acceso.eventos[0].id}
                onSesionExpirada={() => router.replace('/sede/ingresar')}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
