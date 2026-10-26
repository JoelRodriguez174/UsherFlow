'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { deLocalAr, mostrarHora } from '@/lib/fechas';
import type { ResultadoRpc } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { CLASE_INPUT, CLASE_TITULO } from '../estilos';
import { MarcoPaso } from '../MarcoPaso';
import { useSupervisor } from '../SupervisorShell';
import { usePreparacion } from '../usePreparacion';
import { useRpcSupervisor } from '../useRpcSupervisor';

type Sesion = { id: string; nombre: string; inicio_at: string };


export function SesionesPaso() {
  const { claves } = useSupervisor();
  const { recargar: recargarPreparacion } = usePreparacion();
  const { llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState('');
  const [liberacion, setLiberacion] = useState('');
  const [aBorrar, setABorrar] = useState<Sesion | null>(null);
  const idNombre = useId();
  const idInicio = useId();
  const idLiberacion = useId();

  const cargar = useCallback(async () => {
    const res = await llamarOk('obtener_reservas');
    if (res?.success && Array.isArray(res.sesiones) && typeof res.liberacion_min === 'number') {
      setSesiones(res.sesiones as Sesion[]);
      setLiberacion(String(res.liberacion_min));
    }
  }, [llamarOk]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void cargar();
  }, [cargar]);

  /** Bloquea los botones mientras corre; si salió bien, recarga la lista y el estado de los pasos, y avisa. */
  async function accion(hacer: () => Promise<ResultadoRpc | null>, exito: string) {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    try {
      if (await hacer()) {
        await cargar();
        recargarPreparacion();
        setMensaje((m) => m ?? { tipo: 'info', texto: exito });
      }
    } finally {
      setOcupado(false);
    }
  }

  const guardarSesion = (e: FormEvent) => {
    e.preventDefault();
    void accion(async () => {
      const r = await llamarOk('guardar_sesion', { p_nombre: nombre, p_inicio_at: deLocalAr(inicio) });
      if (r) {
        setNombre('');
        setInicio('');
      }
      return r;
    }, 'Sesión guardada.');
  };

  const guardarLiberacion = (e: FormEvent) => {
    e.preventDefault();
    void accion(() => llamarOk('guardar_liberacion', { p_minutos: Number(liberacion) }), 'Liberación guardada.');
  };

  const borrar = () => {
    const sesion = aBorrar;
    if (!sesion) return;
    setABorrar(null);
    void accion(() => llamarOk('borrar_sesion', { p_sesion_id: sesion.id }), 'Sesión borrada.');
  };

  return (
    <MarcoPaso paso="sesiones">
      <h1 className="font-titulo text-2xl text-texto">Sesiones</h1>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {sesiones === null && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      <section aria-labelledby="ses-sesiones" className="flex flex-col gap-3">
        <h2 id="ses-sesiones" className={CLASE_TITULO}>
          Sesiones
        </h2>
        {sesiones?.length === 0 && <p className="text-base text-texto-suave">Todavía no hay sesiones.</p>}
        <ul className="flex flex-col gap-2">
          {sesiones?.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie-alta p-3">
              <span className="min-w-0 text-base text-texto">{`${s.nombre} · ${mostrarHora(s.inicio_at)}`}</span>
              <Boton variante="fantasma" etiqueta={`Borrar ${s.nombre}`} disabled={ocupado} onClick={() => setABorrar(s)}>
                Borrar
              </Boton>
            </li>
          ))}
        </ul>
        <form onSubmit={guardarSesion} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idNombre} className="text-base text-texto">
              Nombre de la sesión
            </label>
            <input id={idNombre} type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="off" className={CLASE_INPUT} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={idInicio} className="text-base text-texto">
              Inicio
            </label>
            <input id={idInicio} type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required className={CLASE_INPUT} />
            <p className="text-sm text-texto-suave">Hora de Argentina. Si el nombre ya existe, se actualiza el inicio.</p>
          </div>
          <Boton type="submit" disabled={ocupado}>
            Guardar sesión
          </Boton>
        </form>
      </section>

      <section aria-labelledby="ses-liberacion" className="flex flex-col gap-3">
        <h2 id="ses-liberacion" className={CLASE_TITULO}>
          Liberación
        </h2>
        <form onSubmit={guardarLiberacion} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idLiberacion} className="text-base text-texto">
              Minutos de liberación
            </label>
            <input id={idLiberacion} type="number" inputMode="numeric" min={0} max={180} step={1} value={liberacion} onChange={(e) => setLiberacion(e.target.value)} required className={CLASE_INPUT} />
            <p className="text-sm text-texto-suave">Las reservas se liberan estos minutos antes de que empiece la sesión (0 a 180).</p>
          </div>
          <Boton type="submit" variante="secundario" disabled={ocupado}>
            Guardar
          </Boton>
        </form>
      </section>

      <Modal abierto={aBorrar !== null} onCerrar={() => setABorrar(null)} titulo="Borrar sesión">
        <div className="flex flex-col gap-4">
          <p className="text-base text-texto">{`Se borra "${aBorrar?.nombre ?? ''}" y todas sus reservas. No se puede deshacer.`}</p>
          <div className="flex flex-col gap-2">
            <Boton variante="secundario" data-autofocus onClick={() => setABorrar(null)} className="w-full">
              Cancelar
            </Boton>
            <Boton variante="peligro" onClick={borrar} className="w-full">
              Sí, borrar
            </Boton>
          </div>
        </div>
      </Modal>
    </MarcoPaso>
  );
}
