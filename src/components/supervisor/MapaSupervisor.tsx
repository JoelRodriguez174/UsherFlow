'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Seccion } from '@/domain/types';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { MapaSalon, type SectorMapa } from '@/components/mapa/MapaSalon';
import { SelectorZona, type FiltroZona } from '@/components/mapa/SelectorZona';
import { CLASE_TITULO } from './estilos';

export type SectorServidor = { id: number; seccion: Seccion; nombre: string; fila_desde: number; fila_hasta: number; capacidad: number };
export type SedeServidor = {
  sede_id: string;
  nombre: string;
  clave_acceso: string | null;
  email_autorizado?: string | null;
  cuenta_activa?: boolean;
  preferencias: number[];
};
export type SesionServidor = { id: string; nombre: string; inicio_at: string; asignado: Array<{ sector_id: number; sede_id: string; cantidad: number }> };
/** Respuesta de `obtener_mapa_supervisor` ya normalizada (arreglos siempre presentes). */
export type MapaServidor = { fechaLimite: string | null; sectores: SectorServidor[]; sedes: SedeServidor[]; sesiones: SesionServidor[] };

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function leerMapa(res: Record<string, unknown>): MapaServidor {
  return {
    fechaLimite: typeof res.fecha_limite === 'string' ? res.fecha_limite : null,
    sectores: lista<SectorServidor>(res.sectores),
    sedes: lista<SedeServidor>(res.sedes),
    sesiones: lista<SesionServidor>(res.sesiones),
  };
}

/** `version`: al cambiar vuelve a pedir el mapa (p. ej. tras guardar sectores). */
export function MapaSupervisor({ clave, version = 0 }: { clave: string; version?: number }) {
  const [mapa, setMapa] = useState<MapaServidor | null>(null);
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [zona, setZona] = useState<FiltroZona>('todas');
  const [sectorActivoId, setSectorActivoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await llamarRpc('obtener_mapa_supervisor', { p_clave: clave });
      if (!res.success) setError(mensajeDeError(String(res.error)));
      else setMapa(leerMapa(res));
    } catch (e) {
      setError(mensajeDeError(e instanceof ClaveInvalidaError ? 'CLAVE_INVALIDA' : 'ERROR_DE_RED'));
    }
  }, [clave]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void cargar();
  }, [cargar, version]);

  const sesion = mapa?.sesiones.find((s) => s.id === sesionId) ?? mapa?.sesiones[0] ?? null;

  const sectores: SectorMapa[] = (mapa?.sectores ?? []).map((s) => {
    const piden = mapa?.sedes.filter((d) => d.preferencias.includes(s.id)).map((d) => d.nombre) ?? [];
    const asignado = sesion?.asignado.filter((a) => a.sector_id === s.id).reduce((n, a) => n + a.cantidad, 0) ?? 0;
    return {
      id: s.id,
      seccion: s.seccion,
      nombre: s.nombre,
      filaDesde: s.fila_desde,
      filaHasta: s.fila_hasta,
      estado: asignado > 0 ? 'asignado' : piden.length > 0 ? 'preferido' : 'disponible',
      detalle: `${piden.length > 0 ? `Piden: ${piden.join(', ')}` : 'Sin pedidos'} · Asignado: ${asignado}/${s.capacidad}`,
      capacidad: s.capacidad,
      libres: Math.max(0, s.capacidad - asignado),
      seleccionado: sectorActivoId === s.id,
    };
  });

  const sectorActivo = mapa?.sectores.find((s) => s.id === sectorActivoId) ?? null;
  const reservasSector = sectorActivo
    ? (sesion?.asignado ?? [])
        .filter((a) => a.sector_id === sectorActivo.id && a.cantidad > 0)
        .map((a) => ({
          sedeId: a.sede_id,
          nombre: mapa?.sedes.find((d) => d.sede_id === a.sede_id)?.nombre ?? 'Sede',
          cantidad: a.cantidad,
        }))
    : [];
  const totalSector = reservasSector.reduce((n, r) => n + r.cantidad, 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 lg:max-w-none lg:px-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-titulo text-xl text-texto">Mapa de ocupación por sector</h2>
        {mapa && mapa.sectores.length > 0 && <SelectorZona valor={zona} onCambiar={setZona} />}
      </div>

      <Aviso mensaje={error} tipo="error" onCerrar={() => setError(null)} />
      {mapa === null && error === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}
      {mapa && mapa.sectores.length === 0 && <p className="text-base text-texto-suave">Todavía no definiste sectores.</p>}
      {mapa && mapa.sectores.length > 0 && (
        <>
          {mapa.sesiones.length > 0 && (
            <div role="group" aria-labelledby="mapa-sup-sesion" className="flex flex-col gap-2">
              <p id="mapa-sup-sesion" className={CLASE_TITULO}>
                Sesión
              </p>
              <div className="flex flex-wrap gap-2">
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
            </div>
          )}
          <MapaSalon
            sectores={sectores}
            etiquetaPreferido="Pedido por alguna sede"
            zona={zona}
            permitirAsignado
            onAlternar={(id) => setSectorActivoId((prev) => (prev === id ? null : id))}
          />

          <div
            aria-hidden={!sectorActivo}
            className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
              sectorActivo ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
              {sectorActivo && (
                <section className="flex flex-col gap-2 rounded-2xl border border-acento/60 bg-superficie p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-titulo text-lg text-texto">
                      {`${sectorActivo.nombre} · filas ${sectorActivo.fila_desde}–${sectorActivo.fila_hasta}`}
                    </h3>
                    <span className="text-sm font-semibold text-acento tabular-nums">
                      {`${totalSector} / ${sectorActivo.capacidad} lugares`}
                    </span>
                  </div>
                  {reservasSector.length === 0 ? (
                    <p className="text-sm text-texto-suave">Sin reservas en este sector para esta sesión.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {reservasSector.map((r) => (
                        <li
                          key={r.sedeId}
                          className="rounded-xl border border-borde bg-fondo px-3 py-1.5 text-sm text-texto tabular-nums"
                        >
                          <span className="font-semibold">{r.nombre}</span>
                          {`: ${r.cantidad} ${r.cantidad === 1 ? 'lugar' : 'lugares'}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </div>
        </>
      )}
      <Boton variante="secundario" onClick={() => void cargar()} className="w-fit">
        Actualizar
      </Boton>
    </div>
  );
}
