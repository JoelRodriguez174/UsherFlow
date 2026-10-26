'use client';

import { useEffect, useState } from 'react';
import { leerAcceso } from '@/lib/acceso';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { SalonProvider, useSalon } from '@/state/SalonProvider';
import { MapaSupervisor } from '@/components/supervisor/MapaSupervisor';
import { ReservasPanel } from '@/components/supervisor/ReservasPanel';
import { SectoresPanel } from '@/components/supervisor/SectoresPanel';
import { SupervisorPanel, type ClavesSalon } from '@/components/supervisor/SupervisorPanel';
import { MarcoSalon } from './MarcoSalon';
import { PantallaClaveInvalida } from './PantallaClaveInvalida';

type Carga = { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'claveInvalida' };

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

type SupervisorContenidoProps = {
  claves: ClavesSalon | null;
  carga: Carga;
  onReintentar(): void;
  onRenovadas(claves: ClavesSalon): void;
};

function SupervisorContenido({ claves, carga, onReintentar, onRenovadas }: SupervisorContenidoProps) {
  const { derivado, filas } = useSalon();
  // Cada panel recarga cuando cambia lo que el otro escribió, no lo propio (evita pedir dos veces):
  // guardar sectores -> ReservasPanel y MapaSupervisor; reservas/sesiones (crean sedes) -> SectoresPanel y MapaSupervisor.
  const [vSectores, setVSectores] = useState(0);
  const [vReservas, setVReservas] = useState(0);

  if (claves !== null) {
    return (
      <main>
        <SupervisorPanel
          claveUjier={claves.claveUjier}
          claveSupervisor={claves.claveSupervisor}
          origen={window.location.origin}
          ocupacion={derivado.ocupacion}
          onClavesRenovadas={onRenovadas}
        />
        <ReservasPanel clave={claves.claveSupervisor} version={vSectores} onCambio={() => setVReservas((v) => v + 1)} />
        <SectoresPanel clave={claves.claveSupervisor} filas={Object.values(filas)} version={vReservas} onGuardado={() => setVSectores((v) => v + 1)} />
        <MapaSupervisor clave={claves.claveSupervisor} version={vSectores + vReservas} />
      </main>
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
        Preparando los QR…
      </p>
    </main>
  );
}

/**
 * Ver `PuertaPagina` sobre el montaje del provider. Acá, además, tras "Renovar claves" el provider se
 * vuelve a montar (`key`) para que sincronice con la clave de supervisor nueva: la vieja ya no sirve en el
 * servidor y, sin remontar, la propia pantalla del supervisor caería en "Pedí un QR nuevo".
 */
export function SupervisorPagina() {
  const { claves, carga, fijarClaves, reintentar } = useClavesDelSalon();
  const [generacion, setGeneracion] = useState(0);

  if (carga.estado === 'claveInvalida') return <PantallaClaveInvalida />;

  return (
    <SalonProvider key={generacion}>
      <MarcoSalon>
        <SupervisorContenido
          claves={claves}
          carga={carga}
          onReintentar={reintentar}
          onRenovadas={(nuevas) => {
            fijarClaves(nuevas);
            setGeneracion((g) => g + 1);
          }}
        />
      </MarcoSalon>
    </SalonProvider>
  );
}
