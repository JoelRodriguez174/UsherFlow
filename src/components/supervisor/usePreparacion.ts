'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { calcularPasos, type DatosPreparacion, type Paso } from '@/domain/preparacion';
import { llamarRpc } from '@/lib/rpc';
import { useSalon } from '@/state/SalonProvider';
import { leerMapa, type MapaServidor } from './MapaSupervisor';

type Reservas = DatosPreparacion['sesiones'];
type Estado = 'cargando' | 'error' | 'listo';
type Valor = { estado: Estado; pasos: Paso[]; recargar(): void };

const PreparacionContext = createContext<Valor | null>(null);

const VACIO: Omit<DatosPreparacion, 'ahoraMs'> = { filas: [], sectores: [], sedes: [], fechaLimite: null, sesiones: [] };

/**
 * Pide mapa y reservas con la clave de supervisor y calcula los pasos con las filas del salón.
 * Mientras carga o si algo falla no se muestra nada como hecho: los pasos salen siempre incompletos.
 */
export function ProveedorPreparacion({ clave, children }: { clave: string; children: ReactNode }) {
  const { filas } = useSalon();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [datos, setDatos] = useState<{ mapa: MapaServidor; sesiones: Reservas; ahoraMs: number } | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      llamarRpc('obtener_mapa_supervisor', { p_clave: clave }),
      llamarRpc('obtener_reservas', { p_clave: clave }),
    ])
      .then(([mapa, reservas]) => {
        if (!vivo) return;
        if (!mapa.success || !reservas.success || !Array.isArray(reservas.sesiones)) {
          setEstado('error');
          return;
        }
        setDatos({ mapa: leerMapa(mapa), sesiones: reservas.sesiones as Reservas, ahoraMs: Date.now() });
        setEstado('listo');
      })
      .catch(() => {
        if (vivo) setEstado('error');
      });
    return () => {
      vivo = false;
    };
  }, [clave, intento]);

  // Recargar con datos ya vistos no vuelve a "cargando": los hijos (con formularios) no se pisan.
  const recargar = useCallback(() => {
    setEstado((e) => (e === 'error' ? 'cargando' : e));
    setIntento((n) => n + 1);
  }, []);

  // `ahoraMs` es la hora en que llegaron los datos (render puro); se renueva con cada recarga.
  const pasos = useMemo(() => {
    if (estado !== 'listo' || datos === null) {
      return calcularPasos({ ...VACIO, ahoraMs: 0 }).map((p) => ({ ...p, completo: false }));
    }
    const { mapa, sesiones, ahoraMs } = datos;
    return calcularPasos({
      filas: Object.values(filas),
      sectores: mapa.sectores,
      sedes: mapa.sedes,
      fechaLimite: mapa.fechaLimite,
      sesiones,
      ahoraMs,
    });
  }, [estado, datos, filas]);

  const valor = useMemo(() => ({ estado, pasos, recargar }), [estado, pasos, recargar]);
  return createElement(PreparacionContext.Provider, { value: valor }, children);
}

export function usePreparacion(): Valor {
  const v = useContext(PreparacionContext);
  if (v === null) throw new Error('usePreparacion se usa dentro de <SupervisorShell>');
  return v;
}
