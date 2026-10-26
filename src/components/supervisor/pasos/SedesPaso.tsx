'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { armarEnlace } from '@/lib/acceso';
import { mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { leerMapa, type SedeServidor } from '../MapaSupervisor';
import { MarcoPaso } from '../MarcoPaso';
import { TarjetaEnlace } from '../TarjetaEnlace';
import { useRpcSupervisor } from '../useRpcSupervisor';
import { useSupervisor } from '../SupervisorShell';
import { usePreparacion } from '../usePreparacion';

const CLASE_INPUT =
  'min-h-11 w-full rounded-xl border border-borde bg-superficie-alta px-3 text-base text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento';
const CLASE_TITULO = 'text-sm font-semibold uppercase tracking-wider text-texto-suave';

// Argentina es UTC-3 todo el año (sin horario de verano): se convierte explícito, sin depender del navegador.
const deLocalAr = (v: string) => `${v}:00-03:00`;
const aLocalAr = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 16);

export function SedesPaso() {
  const { claves } = useSupervisor();
  const { pasos, recargar } = usePreparacion();
  const { llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [fecha, setFecha] = useState('');
  const [sedes, setSedes] = useState<SedeServidor[]>([]);
  const [cargado, setCargado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aRotar, setARotar] = useState<SedeServidor | null>(null);
  const [nuevaSede, setNuevaSede] = useState('');
  const idFecha = useId();
  const idBase = useId();
  const avisos = pasos.find((p) => p.id === 'sedes')?.avisos ?? [];

  /** Trae el mapa; la carga inicial llena también la fecha, las siguientes solo refrescan las sedes (no pisan lo que se edita). */
  const cargar = useCallback(
    async (inicial: boolean) => {
      const res = await llamarOk('obtener_mapa_supervisor');
      if (!res) return;
      const mapa = leerMapa(res);
      setSedes(mapa.sedes);
      if (!inicial) return;
      setFecha(mapa.fechaLimite ? aLocalAr(mapa.fechaLimite) : '');
      setCargado(true);
    },
    [llamarOk],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga desde el servidor
    void cargar(true);
  }, [cargar]);

  /** Bloquea los botones mientras corre. */
  async function accion(hacer: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    try {
      await hacer();
    } finally {
      setOcupado(false);
    }
  }

  const guardarFecha = (valor: string | null) =>
    accion(async () => {
      const res = await llamarOk('guardar_fecha_limite', { p_fecha: valor === null ? null : deLocalAr(valor) });
      if (!res) return;
      if (valor === null) setFecha('');
      setMensaje({ tipo: 'info', texto: valor === null ? 'Quitaste la fecha límite.' : 'Fecha límite guardada.' });
      recargar();
    });

  const agregarSede = (e: FormEvent) => {
    e.preventDefault();
    void accion(async () => {
      const res = await llamarOk('guardar_sede', { p_nombre: nuevaSede });
      if (!res) return;
      setNuevaSede('');
      await cargar(false);
      recargar();
    });
  };

  const enlaceSede = (sede: SedeServidor, rotar: boolean) =>
    accion(async () => {
      const res = await llamarOk('generar_acceso_sede', { p_sede_id: sede.sede_id, p_rotar: rotar });
      if (!res) return;
      if (!res.success || typeof res.clave !== 'string') return setMensaje({ tipo: 'error', texto: mensajeDeError('RESPUESTA_INVALIDA') });
      const claveNueva = res.clave;
      setSedes((ss) => ss.map((s) => (s.sede_id === sede.sede_id ? { ...s, clave_acceso: claveNueva } : s)));
      recargar();
    });

  return (
    <MarcoPaso paso="sedes">
      <h1 className="font-titulo text-2xl text-texto">Sedes</h1>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {!cargado && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      {avisos.length > 0 && (
        <details className="rounded-2xl border border-borde bg-superficie-alta p-3">
          <summary className="min-h-11 cursor-pointer text-base text-advertencia">{`Avisos (${avisos.length})`}</summary>
          <ul className="flex flex-col gap-1 pt-2 text-sm text-advertencia">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby={`${idBase}-fecha`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-fecha`} className={CLASE_TITULO}>
          Plazo de las sedes
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guardarFecha(fecha);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={idFecha} className="text-base text-texto">
              Fecha límite
            </label>
            <input id={idFecha} type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} required className={CLASE_INPUT} />
            <p className="text-sm text-texto-suave">Hora de Argentina. Pasada esta fecha, las sedes ya no pueden cambiar sus preferencias.</p>
          </div>
          <Boton type="submit" variante="secundario" disabled={ocupado}>
            Guardar
          </Boton>
          <Boton variante="fantasma" disabled={ocupado} onClick={() => void guardarFecha(null)}>
            Sin fecha límite
          </Boton>
        </form>
      </section>

      <section aria-labelledby={`${idBase}-sedes`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-sedes`} className={CLASE_TITULO}>
          Enlaces de las sedes
        </h2>
        <form onSubmit={agregarSede} className="flex flex-col gap-2">
          <label htmlFor={`${idBase}-sede`} className="text-base text-texto">
            Agregar sede
          </label>
          <input id={`${idBase}-sede`} type="text" value={nuevaSede} onChange={(e) => setNuevaSede(e.target.value)} autoComplete="off" aria-describedby={`${idBase}-ayuda`} className={CLASE_INPUT} />
          <p id={`${idBase}-ayuda`} className="text-sm text-texto-suave">
            Los nombres no distinguen mayúsculas ni acentos.
          </p>
          <Boton type="submit" variante="secundario" disabled={ocupado}>
            Agregar
          </Boton>
        </form>
        {cargado && sedes.length === 0 && <p className="text-base text-texto-suave">Todavía no hay sedes. Agregalas acá o se crean solas al importar reservas.</p>}
        <ul className="flex flex-col gap-4">
          {sedes.map((s) => (
            <li key={s.sede_id} className="flex flex-col gap-2">
              {s.clave_acceso ? (
                <>
                  <TarjetaEnlace titulo={s.nombre} url={armarEnlace(window.location.origin, s.clave_acceso, 'sede')} descripcion={`acceso de la sede ${s.nombre}`} />
                  <Boton variante="secundario" etiqueta={`Rotar enlace de ${s.nombre}`} disabled={ocupado} onClick={() => setARotar(s)}>
                    Rotar enlace
                  </Boton>
                </>
              ) : (
                <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-4">
                  <p className="font-titulo text-xl text-texto">{s.nombre}</p>
                  <Boton etiqueta={`Generar enlace de ${s.nombre}`} disabled={ocupado} onClick={() => void enlaceSede(s, false)}>
                    Generar enlace
                  </Boton>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Modal abierto={aRotar !== null} onCerrar={() => setARotar(null)} titulo="Rotar enlace">
        <div className="flex flex-col gap-4">
          <p className="text-base text-texto">{`El enlace actual de ${aRotar?.nombre ?? ''} deja de funcionar y tenés que mandarle el nuevo.`}</p>
          <div className="flex flex-col gap-2">
            <Boton variante="secundario" data-autofocus onClick={() => setARotar(null)} className="w-full">
              Cancelar
            </Boton>
            <Boton
              variante="peligro"
              className="w-full"
              onClick={() => {
                const sede = aRotar;
                setARotar(null);
                if (sede) void enlaceSede(sede, true);
              }}
            >
              Sí, rotar
            </Boton>
          </div>
        </div>
      </Modal>
    </MarcoPaso>
  );
}
