'use client';

import { useId, useState, type ReactNode } from 'react';
import type { Rol } from '@/domain/types';
import { armarEnlace, guardarAcceso } from '@/lib/acceso';
import { mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { MarcoPaso } from '../MarcoPaso';
import { TarjetaEnlace } from '../TarjetaEnlace';
import { useArmado } from '../useArmado';
import { usePreparacion } from '../usePreparacion';
import { useRpcSupervisor } from '../useRpcSupervisor';
import { useSupervisor } from '../SupervisorShell';

const DESTINOS_UJIER: ReadonlyArray<{ rol: Rol; titulo: string; descripcion: string }> = [
  { rol: 'puerta', titulo: 'Puerta', descripcion: 'acceso de la Puerta' },
  { rol: 'izquierda', titulo: 'Izquierda', descripcion: 'acceso de la sección Izquierda' },
  { rol: 'centro', titulo: 'Centro', descripcion: 'acceso de la sección Centro' },
  { rol: 'derecha', titulo: 'Derecha', descripcion: 'acceso de la sección Derecha' },
];

function esTexto(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/** Paso QR: nunca se bloquea (los avisos de salón incompleto se muestran arriba) y permite renovar las claves. */
export function QrPaso() {
  const { claves, origen, renovar } = useSupervisor();
  const { pasos } = usePreparacion();
  const { llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const avisos = pasos.find((p) => p.id === 'qr')?.avisos ?? [];

  async function confirmar() {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await llamarOk('regenerar_claves');
      if (!res || !res.success) return;
      const nuevaUjier = res.clave_ujier;
      const nuevaSupervisor = res.clave_supervisor;
      if (esTexto(nuevaUjier) && esTexto(nuevaSupervisor)) {
        // La sesión del propio supervisor sigue funcionando con la clave nueva.
        guardarAcceso(nuevaSupervisor, 'supervisor');
        setMensaje({ tipo: 'info', texto: 'Claves renovadas. Los QR anteriores ya no sirven: repartí los nuevos.' });
        renovar({ claveUjier: nuevaUjier, claveSupervisor: nuevaSupervisor });
      } else {
        setMensaje({ tipo: 'error', texto: mensajeDeError('RESPUESTA_INVALIDA') });
      }
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  }

  function cerrar() {
    if (!ocupado) setConfirmando(false);
  }

  return (
    <MarcoPaso paso="qr">
      <h1 className="font-titulo text-2xl text-texto">QR de ujieres</h1>

      {avisos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {avisos.map((a) => (
            <li key={a} className="rounded-2xl border border-borde bg-superficie-alta p-4 text-base text-texto">
              {a}
            </li>
          ))}
        </ul>
      )}

      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />

      <section aria-labelledby="qr-ujieres" className="flex flex-col gap-3">
        <h2 id="qr-ujieres" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Enlaces para ujieres
        </h2>
        <p className="text-base text-texto-suave">Cada ujier escanea el QR de su lugar con la cámara del celular.</p>
        <ul aria-labelledby="qr-ujieres" className="flex flex-col gap-4">
          {DESTINOS_UJIER.map(({ rol, titulo, descripcion }) => (
            <li key={rol}>
              <TarjetaEnlace titulo={titulo} descripcion={descripcion} url={armarEnlace(origen, claves.claveUjier, rol)} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="qr-propio" className="flex flex-col gap-3">
        <h2 id="qr-propio" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Tu acceso de supervisor
        </h2>
        <TarjetaEnlace
          titulo="Supervisor"
          descripcion="acceso del supervisor"
          url={armarEnlace(origen, claves.claveSupervisor, 'supervisor')}
        />
      </section>

      <section aria-labelledby="qr-acciones" className="flex flex-col gap-3">
        <h2 id="qr-acciones" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Acciones
        </h2>
        <Boton variante="secundario" tamano="grande" onClick={() => setConfirmando(true)}>
          Renovar claves
        </Boton>
      </section>

      <Modal abierto={confirmando} onCerrar={cerrar} titulo="Renovar claves">
        <div className="flex flex-col gap-4">
          <p className="text-base text-texto">
            Los QR y enlaces actuales dejan de funcionar: cada ujier tendrá que escanear el QR nuevo. Tu sesión sigue activa.
          </p>
          <div className="flex flex-col gap-2">
            <Boton variante="secundario" data-autofocus onClick={cerrar} disabled={ocupado} className="w-full">
              Cancelar
            </Boton>
            <BotonConfirmar ocupado={ocupado} onConfirmar={confirmar}>
              Sí, renovar
            </BotonConfirmar>
          </div>
        </div>
      </Modal>
    </MarcoPaso>
  );
}

/**
 * Botón destructivo del diálogo: arranca deshabilitado y se arma tras ARMADO_MS (anti doble toque). Mientras
 * tanto un texto visible, enlazado con aria-describedby, explica por qué no responde.
 */
function BotonConfirmar({ ocupado, onConfirmar, children }: { ocupado: boolean; onConfirmar(): void; children: ReactNode }) {
  const armado = useArmado();
  const esperando = !armado;
  const idAyuda = useId();
  return (
    <>
      <Boton
        variante="peligro"
        onClick={onConfirmar}
        disabled={ocupado || esperando}
        aria-describedby={esperando ? idAyuda : undefined}
        className="w-full"
      >
        {ocupado ? 'Trabajando…' : children}
      </Boton>
      <p id={idAyuda} className="min-h-5 text-center text-sm text-texto-suave">
        {esperando ? 'Esperá un instante…' : ''}
      </p>
    </>
  );
}
