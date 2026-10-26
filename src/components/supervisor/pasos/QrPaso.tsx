'use client';

import { useState } from 'react';
import type { Rol } from '@/domain/types';
import { armarEnlace, guardarAcceso } from '@/lib/acceso';
import { mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { BotonConfirmar } from '../BotonConfirmar';
import { CLASE_TITULO } from '../estilos';
import { MarcoPaso } from '../MarcoPaso';
import { TarjetaEnlace } from '../TarjetaEnlace';
import { useRpcSupervisor, type Mensaje } from '../useRpcSupervisor';
import { useSupervisor } from '../SupervisorShell';

const DESTINOS_UJIER: ReadonlyArray<{ rol: Rol; titulo: string; descripcion: string }> = [
  { rol: 'puerta', titulo: 'Puerta', descripcion: 'acceso de la Puerta' },
  { rol: 'izquierda', titulo: 'Izquierda', descripcion: 'acceso de la sección Izquierda' },
  { rol: 'centro', titulo: 'Centro', descripcion: 'acceso de la sección Centro' },
  { rol: 'derecha', titulo: 'Derecha', descripcion: 'acceso de la sección Derecha' },
];

const BANDERA_RENOVADAS = 'usherflow:claves-renovadas';
const TEXTO_RENOVADAS = 'Claves renovadas. Los QR anteriores ya no sirven: repartí los nuevos.';

/** `renovar()` remonta el paso: la bandera lleva el aviso de éxito a la montura nueva (se consume una sola vez). */
function consumirBandera(): Mensaje {
  try {
    if (sessionStorage.getItem(BANDERA_RENOVADAS) === null) return null;
    sessionStorage.removeItem(BANDERA_RENOVADAS);
    return { tipo: 'info', texto: TEXTO_RENOVADAS };
  } catch {
    return null; // sin storage no hay aviso
  }
}

function esTexto(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/** Paso QR: nunca se bloquea (el aviso de salón incompleto lo muestra `MarcoPaso`) y permite renovar las claves. */
export function QrPaso() {
  const { claves, origen, renovar } = useSupervisor();
  const { llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [renovadas, setRenovadas] = useState<Mensaje>(consumirBandera);

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
        setMensaje({ tipo: 'info', texto: TEXTO_RENOVADAS });
        try {
          sessionStorage.setItem(BANDERA_RENOVADAS, '1');
        } catch {
          // sin storage el aviso solo se ve si el paso no se remonta
        }
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

      <Aviso
        mensaje={(mensaje ?? renovadas)?.texto ?? null}
        tipo={(mensaje ?? renovadas)?.tipo}
        onCerrar={() => {
          setMensaje(null);
          setRenovadas(null);
        }}
      />

      <section aria-labelledby="qr-ujieres" className="flex flex-col gap-3">
        <h2 id="qr-ujieres" className={CLASE_TITULO}>
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
        <h2 id="qr-propio" className={CLASE_TITULO}>
          Tu acceso de supervisor
        </h2>
        <TarjetaEnlace
          titulo="Supervisor"
          descripcion="acceso del supervisor"
          url={armarEnlace(origen, claves.claveSupervisor, 'supervisor')}
        />
      </section>

      <section aria-labelledby="qr-acciones" className="flex flex-col gap-3">
        <h2 id="qr-acciones" className={CLASE_TITULO}>
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
