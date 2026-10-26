'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { leerAcceso } from '@/lib/acceso';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { SalonProvider } from '@/state/SalonProvider';
import { MarcoSalon } from '@/components/paginas/MarcoSalon';
import { PantallaClaveInvalida } from '@/components/paginas/PantallaClaveInvalida';
import { ProveedorPreparacion } from './usePreparacion';

export type ClavesSalon = { claveUjier: string; claveSupervisor: string };
type Carga = { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'claveInvalida' };
type ValorSupervisor = { claves: ClavesSalon; origen: string; renovar(nuevas: ClavesSalon): void };

const SupervisorContext = createContext<ValorSupervisor | null>(null);

export function useSupervisor(): ValorSupervisor {
  const v = useContext(SupervisorContext);
  if (v === null) throw new Error('useSupervisor se usa dentro de <SupervisorShell>');
  return v;
}

/**
 * Los QR de los ujieres necesitan las dos claves y solo la clave de supervisor puede pedirlas
 * (`obtener_claves`). Se piden en paralelo con la carga del salón.
 */
function useClavesDelSalon() {
  const [claves, setClaves] = useState<ClavesSalon | null>(null);
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const acceso = leerAcceso();
    if (acceso === null) {
      // sin clave guardada no hay nada que pedir: el provider ya muestra "Pedí un QR nuevo"
      return;
    }
    let vivo = true;
    llamarRpc('obtener_claves', { p_clave: acceso.clave })
      .then((res) => {
        if (!vivo) return;
        if (!res.success) {
          setCarga({ estado: 'error', mensaje: mensajeDeError(String(res.error)) });
          return;
        }
        const { clave_ujier, clave_supervisor } = res;
        if (typeof clave_ujier === 'string' && clave_ujier !== '' && typeof clave_supervisor === 'string' && clave_supervisor !== '') {
          setClaves({ claveUjier: clave_ujier, claveSupervisor: clave_supervisor });
        } else {
          setCarga({ estado: 'error', mensaje: mensajeDeError('RESPUESTA_INVALIDA') });
        }
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setCarga(
          e instanceof ClaveInvalidaError
            ? { estado: 'claveInvalida' }
            : { estado: 'error', mensaje: mensajeDeError('ERROR_DE_RED') },
        );
      });
    return () => {
      vivo = false;
    };
  }, [intento]);

  return {
    claves,
    carga,
    fijarClaves: setClaves,
    reintentar: () => {
      setCarga({ estado: 'cargando' });
      setIntento((n) => n + 1);
    },
  };
}

function Contenido({ claves, carga, onReintentar, onRenovadas, children }: {
  claves: ClavesSalon | null;
  carga: Carga;
  onReintentar(): void;
  onRenovadas(claves: ClavesSalon): void;
  children: ReactNode;
}) {
  // Solo se llega con claves ya cargadas (en el navegador): `window` existe.
  const valor = useMemo(
    () => (claves === null ? null : { claves, origen: window.location.origin, renovar: onRenovadas }),
    [claves, onRenovadas],
  );

  if (valor !== null) {
    return (
      <SupervisorContext.Provider value={valor}>
        <ProveedorPreparacion clave={valor.claves.claveSupervisor}>{children}</ProveedorPreparacion>
      </SupervisorContext.Provider>
    );
  }

  if (carga.estado === 'error') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
        <h1 className="font-titulo text-2xl text-texto">No pudimos abrir el panel</h1>
        <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
          {carga.mensaje}
        </p>
        <button
          type="button"
          onClick={onReintentar}
          className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-borde bg-superficie-alta px-6 text-lg font-semibold text-texto"
        >
          Probar de nuevo
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
      <p role="status" className="text-base text-texto-suave">
        Preparando…
      </p>
    </main>
  );
}

/**
 * Claves, `SalonProvider` y estado de los pasos compartidos por todas las rutas de `/supervisor`
 * (lo monta `layout.tsx`, así sobreviven a la navegación). Tras "Renovar claves" el provider se vuelve a
 * montar (`key`) para que sincronice con la clave de supervisor nueva: la vieja ya no sirve en el servidor
 * y, sin remontar, la propia pantalla caería en "Pedí un QR nuevo". La ruta no cambia.
 */
export function SupervisorShell({ children }: { children: ReactNode }) {
  const { claves, carga, fijarClaves, reintentar } = useClavesDelSalon();
  const [generacion, setGeneracion] = useState(0);

  const renovar = useCallback(
    (nuevas: ClavesSalon) => {
      fijarClaves(nuevas);
      setGeneracion((g) => g + 1);
    },
    [fijarClaves],
  );

  if (carga.estado === 'claveInvalida') return <PantallaClaveInvalida />;

  return (
    <SalonProvider key={generacion}>
      <MarcoSalon>
        <Contenido
          claves={claves}
          carga={carga}
          onReintentar={reintentar}
          onRenovadas={renovar}
        >
          {children}
        </Contenido>
      </MarcoSalon>
    </SalonProvider>
  );
}
