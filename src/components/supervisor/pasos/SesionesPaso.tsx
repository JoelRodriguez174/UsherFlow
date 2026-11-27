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

type EventoSesion = { id: string; nombre: string; inicio_at: string; fin_at?: string | null };

export function SesionesPaso() {
  const { claves } = useSupervisor();
  const { recargar: recargarPreparacion } = usePreparacion();
  const { llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [eventos, setEventos] = useState<EventoSesion[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [liberacion, setLiberacion] = useState('');
  const [aBorrar, setABorrar] = useState<EventoSesion | null>(null);
  const idNombre = useId();
  const idInicio = useId();
  const idFin = useId();
  const idLiberacion = useId();

  const cargar = useCallback(async () => {
    const res = await llamarOk('obtener_reservas');
    if (res?.success && Array.isArray(res.sesiones) && typeof res.liberacion_min === 'number') {
      setEventos(res.sesiones as EventoSesion[]);
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

  const guardarEvento = (e: FormEvent) => {
    e.preventDefault();
    const inicioIso = deLocalAr(inicio);
    const finIso = fin.trim() ? deLocalAr(fin) : null;
    if (finIso && Date.parse(finIso) <= Date.parse(inicioIso)) {
      setMensaje({ tipo: 'error', texto: 'La fecha de fin tiene que ser posterior al inicio.' });
      return;
    }
    void accion(async () => {
      const params: Record<string, unknown> = { p_nombre: nombre, p_inicio_at: inicioIso };
      if (finIso) params.p_fin_at = finIso;
      const r = await llamarOk('guardar_sesion', params);
      if (r) {
        setNombre('');
        setInicio('');
        setFin('');
      }
      return r;
    }, 'Evento guardado.');
  };

  const guardarLiberacion = (e: FormEvent) => {
    e.preventDefault();
    void accion(() => llamarOk('guardar_liberacion', { p_minutos: Number(liberacion) }), 'Liberación guardada.');
  };

  const borrar = () => {
    const evento = aBorrar;
    if (!evento) return;
    setABorrar(null);
    void accion(() => llamarOk('borrar_sesion', { p_sesion_id: evento.id }), 'Evento borrado.');
  };

  return (
    <MarcoPaso paso="sesiones">
      <h1 className="font-titulo text-2xl text-texto">Eventos</h1>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {eventos === null && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      <section aria-labelledby="ses-eventos" className="flex flex-col gap-3">
        <h2 id="ses-eventos" className={CLASE_TITULO}>
          Eventos
        </h2>
        {eventos?.length === 0 && <p className="text-base text-texto-suave">Todavía no hay eventos.</p>}
        <ul className="flex flex-col gap-2">
          {eventos?.map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie-alta p-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold text-texto">{ev.nombre}</span>
                <span className="text-sm text-texto-suave tabular-nums">
                  {ev.fin_at
                    ? `${mostrarHora(ev.inicio_at)} → ${mostrarHora(ev.fin_at)}`
                    : mostrarHora(ev.inicio_at)}
                </span>
              </div>
              <Boton variante="fantasma" etiqueta={`Borrar ${ev.nombre}`} disabled={ocupado} onClick={() => setABorrar(ev)}>
                Borrar
              </Boton>
            </li>
          ))}
        </ul>
        <form onSubmit={guardarEvento} className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={idNombre} className="text-base text-texto">
              Nombre del evento
            </label>
            <input id={idNombre} type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="off" placeholder="Ej. Sábado Mañana" className={CLASE_INPUT} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={idInicio} className="text-base text-texto">
                Inicio
              </label>
              <input id={idInicio} type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required className={CLASE_INPUT} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={idFin} className="text-base text-texto">
                Fin
              </label>
              <input id={idFin} type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} className={CLASE_INPUT} />
            </div>
          </div>
          <p className="text-sm text-texto-suave">Hora de Argentina. Si el nombre ya existe, se actualizan sus horarios.</p>
          <Boton type="submit" disabled={ocupado}>
            Guardar evento
          </Boton>
        </form>
      </section>

      <section aria-labelledby="ses-liberacion" className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
        <h2 id="ses-liberacion" className={CLASE_TITULO}>
          Liberación
        </h2>
        <form onSubmit={guardarLiberacion} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idLiberacion} className="text-base text-texto">
              Minutos de liberación
            </label>
            <input id={idLiberacion} type="number" inputMode="numeric" min={0} max={180} step={1} value={liberacion} onChange={(e) => setLiberacion(e.target.value)} required className={CLASE_INPUT} />
            <p className="text-sm text-texto-suave">Las reservas se liberan estos minutos antes de que empiece el evento (0 a 180).</p>
          </div>
          <Boton type="submit" variante="secundario" disabled={ocupado}>
            Guardar
          </Boton>
        </form>
      </section>

      <Modal abierto={aBorrar !== null} onCerrar={() => setABorrar(null)} titulo="Borrar evento">
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
