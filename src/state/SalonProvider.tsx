'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ahoraServidor } from '@/domain/pendientes';
import type { Fila, Seccion } from '@/domain/types';
import { leerAcceso } from '@/lib/acceso';
import { ClaveInvalidaError, llamarRpc } from '@/lib/rpc';
import { derivarSalon, type SalonDerivado } from './derivar';
import { estadoInicial, salonReducer, type Mutacion, type SalonAction, type SalonState } from './salonReducer';
import { crearSalonSync, mensajeDeError, type EstadoConexion, type ResultadoMutacion, type SalonSync } from './sync';

export interface SalonAcciones {
  mandar(seccion: Seccion, cantidad: number, sedeId?: string | null): Promise<{ ok: boolean; error?: string }>;
  sentar(pendienteId: string, tramoId: number): Promise<ResultadoMutacion>;
  noLlegaron(pendienteId: string): Promise<boolean>;
  seLevanto(tramoId: number): Promise<boolean>;
  corregir(tramoId: number, libresVistos: number): Promise<boolean>;
  juntar(filaId: number): Promise<boolean>;
  verificar(filaId: number): Promise<boolean>;
  agregarFila(seccion: Seccion): Promise<boolean>;
}

export interface SalonContexto {
  derivado: SalonDerivado;
  filas: Record<number, Fila>;
  /** Diferencia (ms) entre el reloj del servidor y el local: `ahoraServidor(Date.now(), offsetMs)`. */
  offsetMs: number;
  conexion: EstadoConexion;
  error: string | null;
  claveInvalida: boolean;
  cargando: boolean;
  acciones: SalonAcciones;
  limpiarError(): void;
}

const SESION_DURACION_MS = 3 * 60 * 60 * 1000;

/** Fuente externa del reloj local: el temporizador existe solo mientras haya suscriptores y `activo`. */
function crearRelojTick(activo: boolean, intervaloMs: number) {
  let ahora: number | null = null;
  return {
    getSnapshot: (): number => (ahora ??= Date.now()),
    subscribe: (avisar: () => void): (() => void) => {
      if (!activo) return () => {};
      // Al activarse se toma la hora actual de inmediato (no la del último tick).
      ahora = Date.now();
      avisar();
      const id = setInterval(() => {
        ahora = Date.now();
        avisar();
      }, intervaloMs);
      return () => clearInterval(id);
    },
  };
}

/**
 * Hora local en ms. Solo programa un temporizador cuando `activo` es true; al reactivarse
 * toma la hora actual de inmediato (no arrastra la del último tick).
 */
export function useTick(activo: boolean, intervaloMs = 1000): number {
  const reloj = useMemo(() => crearRelojTick(activo, intervaloMs), [activo, intervaloMs]);
  return useSyncExternalStore(reloj.subscribe, reloj.getSnapshot, reloj.getSnapshot);
}

function idTemporal(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const sinSuscripcion = () => () => {};
/** La clave vive en sessionStorage: en el servidor / durante la hidratación es `undefined` (aún no se sabe). */
const leerClave = (): string | null => leerAcceso()?.clave ?? null;
const claveEnServidor = (): undefined => undefined;

const Contexto = createContext<SalonContexto | null>(null);

export function SalonProvider({ children }: { children: ReactNode }) {
  const clave = useSyncExternalStore<string | null | undefined>(sinSuscripcion, leerClave, claveEnServidor);

  const [state, setState] = useState<SalonState>(estadoInicial);
  const [conexion, setConexion] = useState<EstadoConexion>('connected');
  const [error, setError] = useState<string | null>(null);
  const [claveCaducada, setClaveCaducada] = useState(false);

  // El sync lee el estado justo después de despachar (p. ej. para revertir): un ref espeja el último estado
  // de forma síncrona, mientras que `state` es lo que renderiza React.
  const stateRef = useRef<SalonState>(estadoInicial);
  const syncRef = useRef<SalonSync | null>(null);
  const claveRef = useRef<string | null>(null);

  const dispatch = useCallback((a: SalonAction) => {
    const siguiente = salonReducer(stateRef.current, a);
    if (siguiente === stateRef.current) return;
    stateRef.current = siguiente;
    setState(siguiente);
  }, []);

  useEffect(() => {
    if (typeof clave !== 'string') return;
    let vivo = true;
    const sync: SalonSync = crearSalonSync({
      clave,
      getState: () => stateRef.current,
      dispatch: (a) => {
        if (vivo) dispatch(a);
      },
      onError: (msg) => {
        if (vivo) setError(msg);
      },
      onClaveInvalida: () => {
        if (!vivo) return;
        setClaveCaducada(true);
        sync.detener(); // sin reintentos
      },
      onConexion: (s) => {
        if (vivo) setConexion(s);
      },
    });
    syncRef.current = sync;
    claveRef.current = clave;
    void sync.iniciar();
    return () => {
      vivo = false;
      sync.detener();
      if (syncRef.current === sync) {
        syncRef.current = null;
        claveRef.current = null;
      }
    };
  }, [clave, dispatch]);

  const acciones = useMemo<SalonAcciones>(() => {
    const ejecutar = async (m: Mutacion): Promise<ResultadoMutacion> => {
      const sync = syncRef.current;
      if (!sync) return { ok: false, error: 'CLAVE_INVALIDA' };
      return sync.ejecutar(m);
    };
    const ok = async (m: Mutacion) => (await ejecutar(m)).ok;

    // verificar / agregarFila no tienen mutación optimista: se llama a la RPC y se resincroniza.
    const rpcYResync = async (nombre: string, params: Record<string, unknown>): Promise<boolean> => {
      const sync = syncRef.current;
      const clave = claveRef.current;
      if (!sync || clave === null) return false;
      try {
        const res = await llamarRpc(nombre, { p_clave: clave, ...params });
        if (!res.success) {
          setError(mensajeDeError(String(res.error)));
          return false;
        }
        await sync.resync();
        return true;
      } catch (e) {
        if (e instanceof ClaveInvalidaError) {
          setClaveCaducada(true);
          sync.detener();
        } else {
          setError(mensajeDeError('ERROR_DE_RED'));
        }
        return false;
      }
    };

    return {
      mandar: (seccion, cantidad, sedeId = null) =>
        ejecutar({
          tipo: 'mandar',
          pendienteTmpId: idTemporal(),
          seccion,
          cantidad,
          sedeId,
          creadoEn: new Date(ahoraServidor(Date.now(), stateRef.current.offsetMs)).toISOString(),
        }),
      sentar: (pendienteId, tramoId) => ejecutar({ tipo: 'sentar', pendienteId, tramoId }),
      noLlegaron: (pendienteId) => ok({ tipo: 'noLlegaron', pendienteId }),
      seLevanto: (tramoId) => ok({ tipo: 'seLevanto', tramoId }),
      corregir: (tramoId, libresVistos) => ok({ tipo: 'corregir', tramoId, libresVistos }),
      juntar: (filaId) => ok({ tipo: 'juntar', filaId }),
      verificar: (filaId) => rpcYResync('verificar_fila', { p_fila_id: filaId }),
      agregarFila: (seccion) => rpcYResync('agregar_fila_al_fondo', { p_seccion: seccion }),
    };
  }, []);

  const limpiarError = useCallback(() => setError(null), []);

  // El servidor pasa a la sesión siguiente a inicio + 3 h sin avisar por realtime: se resincroniza al llegar ese momento.
  const { sesion, offsetMs } = state;
  useEffect(() => {
    if (!sesion) return;
    const espera = Date.parse(sesion.inicioAt) + SESION_DURACION_MS - ahoraServidor(Date.now(), offsetMs) + 1000;
    // Mínimo 1 s: si el servidor aún devuelve la misma sesión, reintenta sin hacer spin.
    // setTimeout admite hasta 2^31-1 ms: más que eso dispara de inmediato y haría un bucle de resync.
    const id = setTimeout(() => void syncRef.current?.resync(), Math.min(Math.max(espera, 1000), 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [sesion, offsetMs]);

  // El tick de 1 s solo corre con pendientes (su ámbar) o con sesión en curso (la liberación de lo apartado).
  const hayPendientes = useMemo(() => Object.keys(state.pendientes).length > 0, [state.pendientes]);
  const ahora = useTick(hayPendientes || state.sesion !== null);
  const derivado = useMemo(() => derivarSalon(state, ahora), [state, ahora]);

  const claveInvalida = clave === null || claveCaducada;
  const cargando = clave === undefined || (!claveInvalida && !state.cargado);

  const valor = useMemo<SalonContexto>(
    () => ({
      derivado,
      filas: state.filas,
      offsetMs: state.offsetMs,
      conexion,
      error,
      claveInvalida,
      cargando,
      acciones,
      limpiarError,
    }),
    [derivado, state.filas, state.offsetMs, conexion, error, claveInvalida, cargando, acciones, limpiarError],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSalon(): SalonContexto {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useSalon debe usarse dentro de <SalonProvider>');
  return ctx;
}
