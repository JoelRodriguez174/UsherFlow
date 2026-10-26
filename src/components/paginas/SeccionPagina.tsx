'use client';

import { useEffect, useRef } from 'react';
import type { Seccion } from '@/domain/types';
import { ahoraServidor } from '@/domain/pendientes';
import { SalonProvider, useSalon, useTick } from '@/state/SalonProvider';
import { SeccionView } from '@/components/seccion/SeccionView';
import { ControlSonido } from './ControlSonido';
import { MarcoSalon } from './MarcoSalon';

/** La hora relativa de las filas ("verificada hace…") se refresca a este ritmo. */
const REFRESCO_RELOJ_MS = 15_000;

function vibrar(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([60, 40, 60]);
    }
  } catch {
    // La vibración es un extra: si el navegador la rechaza, no pasa nada.
  }
}

function SeccionContenido({ seccion }: { seccion: Seccion }) {
  const { derivado, acciones, offsetMs, cargando } = useSalon();
  const ahoraLocal = useTick(true, REFRESCO_RELOJ_MS);
  const ahoraServidorMs = ahoraServidor(ahoraLocal, offsetMs);

  const filas = derivado.filasPorSeccion[seccion];
  const pendientes = derivado.pendientesPorSeccion[seccion];

  // Vibra cuando llega un grupo nuevo a ESTA sección (no con la carga inicial ni cuando uno se resuelve).
  const vistos = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (cargando) return;
    const ids = new Set(pendientes.map((v) => v.pendiente.id));
    const previos = vistos.current;
    vistos.current = ids;
    if (previos === null) return;
    for (const id of ids) {
      if (!previos.has(id)) {
        vibrar();
        return;
      }
    }
  }, [cargando, pendientes]);

  return (
    <MarcoSalon controles={<ControlSonido />}>
      <SeccionView
        seccion={seccion}
        filas={filas}
        pendientes={pendientes}
        sedes={derivado.sedes}
        ahoraServidorMs={ahoraServidorMs}
        onSentar={acciones.sentar}
        onNoLlegaron={acciones.noLlegaron}
        onSeLevanto={acciones.seLevanto}
        onCorregir={acciones.corregir}
        onJuntar={acciones.juntar}
        onVerificar={acciones.verificar}
        onAgregarFila={() => acciones.agregarFila(seccion)}
      />
    </MarcoSalon>
  );
}

/** Ver `PuertaPagina`: el provider se monta dentro de la página para que tras /entrar lea la clave nueva. */
export function SeccionPagina({ seccion }: { seccion: Seccion }) {
  return (
    <SalonProvider>
      <SeccionContenido seccion={seccion} />
    </SalonProvider>
  );
}
