'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Seccion } from '@/domain/types';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { MapaSalon, type EstadoSector, type SectorMapa } from '@/components/mapa/MapaSalon';
import { PantallaClaveInvalida } from '@/components/paginas/PantallaClaveInvalida';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';

type SectorServidor = { id: number; seccion: Seccion; nombre: string; fila_desde: number; fila_hasta: number };
type SesionServidor = {
  id: string;
  nombre: string;
  inicio_at: string;
  sectores: Array<{ sector_id: number; agotado: boolean; asignado: number }>;
};
type Mapa = {
  sede: { id: string; nombre: string };
  fecha_limite: string | null;
  abierto: boolean;
  sectores: SectorServidor[];
  preferencias: number[];
  sesiones: SesionServidor[];
};

// shortcut: polling, subir a realtime si hace falta
const POLLING_MS = 30_000;
const ZONA = 'America/Argentina/Buenos_Aires';
const mostrarFecha = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, dateStyle: 'long', timeStyle: 'short', hour12: false }).format(new Date(iso));

function estadoDe(id: number, preferencias: number[], sesion: SesionServidor | undefined) {
  const dato = sesion?.sectores.find((x) => x.sector_id === id);
  const asignado = dato?.asignado ?? 0;
  let estado: EstadoSector = preferencias.includes(id) ? 'preferido' : 'disponible';
  if (dato?.agotado) estado = 'agotado';
  if (asignado > 0) estado = 'asignado';
  return { estado, detalle: asignado > 0 ? `Tenés ${asignado} ${asignado === 1 ? 'lugar' : 'lugares'}` : undefined };
}

export function SedePanel({ clave }: { clave: string }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [preferencias, setPreferencias] = useState<number[]>([]);
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  const [claveInvalida, setClaveInvalida] = useState(false);
  // La versión sube al empezar y al terminar cada guardado: una carga que se superpone con un guardado no pisa la preferencia optimista.
  const version = useRef(0);
  const guardando = useRef(false);

  const cargar = useCallback(async () => {
    const desde = version.current;
    try {
      const res = await llamarRpc('obtener_mapa_sede', { p_clave: clave });
      if (!res.success) throw new Error(String(res.error));
      if (desde !== version.current || guardando.current) return;
      const m = res as unknown as Mapa;
      setMapa(m);
      setPreferencias(m.preferencias);
      setFalloCarga(false);
    } catch (e) {
      if (e instanceof ClaveInvalidaError) setClaveInvalida(true);
      else setFalloCarga(true); // si ya había mapa se conserva el último: el próximo sondeo reintenta
    }
  }, [clave]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void cargar();
    const timer = setInterval(() => void cargar(), POLLING_MS);
    return () => clearInterval(timer);
  }, [cargar]);

  if (claveInvalida) return <PantallaClaveInvalida tipo="sede" />;

  if (mapa === null) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
        {falloCarga ? (
          <>
            <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
              {mensajeDeError('ERROR_DE_RED')}
            </p>
            <Boton variante="secundario" onClick={() => void cargar()}>
              Probar de nuevo
            </Boton>
          </>
        ) : (
          <p role="status" className="text-base text-texto-suave">
            Cargando el mapa…
          </p>
        )}
      </main>
    );
  }

  const sesion = mapa.sesiones.find((s) => s.id === sesionId) ?? mapa.sesiones[0];
  const sectores: SectorMapa[] = mapa.sectores.map((s) => ({
    id: s.id,
    seccion: s.seccion,
    nombre: s.nombre,
    filaDesde: s.fila_desde,
    filaHasta: s.fila_hasta,
    ...estadoDe(s.id, preferencias, sesion),
  }));

  async function alternar(id: number) {
    if (guardando.current || !mapa?.abierto) return;
    const anteriores = preferencias;
    const nuevas = anteriores.includes(id) ? anteriores.filter((x) => x !== id) : [...anteriores, id];
    guardando.current = true;
    version.current++;
    setPreferencias(nuevas);
    setAviso(null);
    let recargar = false;
    try {
      const res = await llamarRpc('guardar_preferencias', { p_clave: clave, p_sectores: nuevas });
      recargar = true; // resincroniza con el servidor (el cupo agotado pudo cambiar)
      if (!res.success) {
        setPreferencias(anteriores);
        if (res.error === 'FECHA_LIMITE_VENCIDA') setMapa((m) => m && { ...m, abierto: false });
        setAviso(mensajeDeError(String(res.error)));
      }
    } catch (e) {
      if (e instanceof ClaveInvalidaError) {
        setClaveInvalida(true);
        return;
      }
      setPreferencias(anteriores);
      setAviso(mensajeDeError('ERROR_DE_RED'));
    } finally {
      guardando.current = false;
      version.current++;
    }
    // fuera del finally: la carga debe arrancar con la versión final para que no se descarte
    if (recargar) void cargar();
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-titulo text-3xl text-texto">{mapa.sede.nombre}</h1>
        {!mapa.abierto ? (
          <p className="text-base font-semibold text-peligro">Cerrado</p>
        ) : (
          mapa.fecha_limite && (
            <p className="text-base text-texto-suave">
              Podés cambiar tu preferencia hasta el {mostrarFecha(mapa.fecha_limite)}
            </p>
          )
        )}
      </header>

      <Aviso mensaje={aviso} tipo="error" onCerrar={() => setAviso(null)} />

      {!mapa.sesiones.some((s) => s.sectores.some((x) => x.asignado > 0)) && (
        <p className="text-base text-texto-suave">Todavía no te asignaron lugares.</p>
      )}

      <section aria-labelledby="titulo-mapa" className="flex flex-col gap-3">
        <h2 id="titulo-mapa" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Mapa del salón
        </h2>
        {mapa.sesiones.length > 0 && (
          <div role="group" aria-label="Sesión" className="flex flex-wrap gap-2">
            {mapa.sesiones.map((s) => (
              <Boton
                key={s.id}
                variante={s.id === sesion?.id ? 'primario' : 'secundario'}
                aria-pressed={s.id === sesion?.id}
                onClick={() => setSesionId(s.id)}
              >
                {s.nombre}
              </Boton>
            ))}
          </div>
        )}
        <MapaSalon sectores={sectores} onAlternar={(id) => void alternar(id)} deshabilitado={!mapa.abierto} />
      </section>
    </main>
  );
}
