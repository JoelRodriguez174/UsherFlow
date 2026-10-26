'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SECCIONES, type Seccion } from '@/domain/types';
import { armarEnlace } from '@/lib/acceso';
import { ClaveInvalidaError, llamarRpc, mensajeDeError, type ResultadoRpc } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { leerMapa, type SedeServidor } from './MapaSupervisor';
import { TarjetaEnlace } from './TarjetaEnlace';

type Mensaje = { tipo: 'info' | 'error'; texto: string } | null;
type FilaSector = { uid: number; seccion: Seccion; nombre: string; desde: string; hasta: string };

const CLASE_INPUT =
  'min-h-11 w-full rounded-xl border border-borde bg-superficie-alta px-3 text-base text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento';
const CLASE_TITULO = 'text-sm font-semibold uppercase tracking-wider text-texto-suave';
const TITULOS: Record<Seccion, string> = { izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' };
const PARTES = ['adelante', 'medio', 'atrás'];

// Argentina es UTC-3 todo el año (sin horario de verano): se convierte explícito, sin depender del navegador.
const deLocalAr = (v: string) => `${v}:00-03:00`;
const aLocalAr = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 16);

/** Rango de filas de una sección, o null si no se conoce o no alcanza para 3 partes. */
function partirEnTres(desde: number, hasta: number): Array<[number, number]> | null {
  const n = hasta - desde + 1;
  if (!(n >= 3)) return null;
  const a = Math.floor(n / 3);
  const b = Math.floor((n - a) / 2);
  return [
    [desde, desde + a - 1],
    [desde + a, desde + a + b - 1],
    [desde + a + b, hasta],
  ];
}

type SectoresPanelProps = {
  clave: string;
  filas?: ReadonlyArray<{ seccion: Seccion; numero: number }>;
  /** Se avisa tras guardar los sectores, para que los paneles hermanos se recarguen. */
  onGuardado?(): void;
  /** Al cambiar vuelve a pedir el mapa (p. ej. tras importar reservas, que crea sedes); no pisa lo que se está editando. */
  version?: number;
};

export function SectoresPanel({ clave, filas: filasSalon, onGuardado, version = 0 }: SectoresPanelProps) {
  const [filas, setFilas] = useState<FilaSector[]>([]);
  const [rangosServidor, setRangosServidor] = useState<Partial<Record<Seccion, [number, number]>>>({});
  const [fecha, setFecha] = useState('');
  const [sedes, setSedes] = useState<SedeServidor[]>([]);
  const [cargado, setCargado] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [erroresSectores, setErroresSectores] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [aRotar, setARotar] = useState<SedeServidor | null>(null);
  const [nuevaSede, setNuevaSede] = useState('');
  const inicializado = useRef(false);
  const uid = useRef(0);
  const idFecha = useId();
  const idBase = useId();

  const nueva = useCallback((seccion: Seccion, nombre = '', desde = '', hasta = ''): FilaSector => ({ uid: uid.current++, seccion, nombre, desde, hasta }), []);

  /** Llama como supervisor. Devuelve la respuesta (también la de error de negocio) o null si falló la red. */
  const llamar = useCallback(
    async (rpc: string, params: Record<string, unknown> = {}): Promise<ResultadoRpc | null> => {
      try {
        return await llamarRpc(rpc, { p_clave: clave, ...params });
      } catch (e) {
        setMensaje({ tipo: 'error', texto: mensajeDeError(e instanceof ClaveInvalidaError ? 'CLAVE_INVALIDA' : 'ERROR_DE_RED') });
        return null;
      }
    },
    [clave],
  );

  /** Aplica el mapa del servidor. La carga inicial llena también el formulario; las siguientes solo refrescan sedes y rangos. */
  const aplicarMapa = useCallback(
    (res: Record<string, unknown>, inicial: boolean) => {
      const mapa = leerMapa(res);
      const rangos: Partial<Record<Seccion, [number, number]>> = {};
      for (const s of mapa.sectores) {
        const r = rangos[s.seccion];
        rangos[s.seccion] = [Math.min(r?.[0] ?? s.fila_desde, s.fila_desde), Math.max(r?.[1] ?? s.fila_hasta, s.fila_hasta)];
      }
      setRangosServidor(rangos);
      setSedes(mapa.sedes);
      if (!inicial) return;
      setFilas(mapa.sectores.map((s) => nueva(s.seccion, s.nombre, String(s.fila_desde), String(s.fila_hasta))));
      setFecha(mapa.fechaLimite ? aLocalAr(mapa.fechaLimite) : '');
      setCargado(true);
    },
    [nueva],
  );

  useEffect(() => {
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga desde el servidor
    void llamar('obtener_mapa_supervisor').then((res) => {
      if (!vivo || !res) return;
      if (!res.success) return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      aplicarMapa(res, !inicializado.current);
      inicializado.current = true;
    });
    return () => {
      vivo = false;
    };
  }, [llamar, aplicarMapa, version]);

  /** Primer y último número de fila de la sección: del salón si se lo pasan, si no de los sectores ya guardados. */
  function rango(seccion: Seccion): [number, number] | null {
    const nums = filasSalon?.filter((f) => f.seccion === seccion).map((f) => f.numero) ?? [];
    return nums.length > 0 ? [Math.min(...nums), Math.max(...nums)] : (rangosServidor[seccion] ?? null);
  }

  function dividir(seccion: Seccion, [desde, hasta]: [number, number]) {
    const partes = partirEnTres(desde, hasta);
    if (!partes) return;
    setFilas((fs) => [
      ...fs.filter((f) => f.seccion !== seccion),
      ...partes.map(([d, h], i) => nueva(seccion, PARTES[i], String(d), String(h))),
    ]);
  }

  const cambiar = (u: number, cambio: Partial<FilaSector>) => setFilas((fs) => fs.map((f) => (f.uid === u ? { ...f, ...cambio } : f)));

  /** Bloquea los botones mientras corre. */
  async function accion(hacer: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    setErroresSectores([]);
    try {
      await hacer();
    } finally {
      setOcupado(false);
    }
  }

  const guardarSectores = (e: FormEvent) => {
    e.preventDefault();
    void accion(async () => {
      const orden = (s: Seccion) => SECCIONES.indexOf(s);
      const p_sectores = [...filas]
        .sort((a, b) => orden(a.seccion) - orden(b.seccion))
        .map((f) => ({ seccion: f.seccion, nombre: f.nombre.trim(), fila_desde: Number(f.desde), fila_hasta: Number(f.hasta) }));
      const res = await llamar('guardar_sectores', { p_sectores });
      if (!res) return;
      if (res.success) {
        onGuardado?.();
        return setMensaje({ tipo: 'info', texto: 'Sectores guardados.' });
      }
      if (res.error === 'SECTORES_CON_ASIGNACIONES') return setMensaje({ tipo: 'error', texto: 'Borrá primero las asignaciones por sector.' });
      const lista = (res as { errores?: unknown }).errores;
      const detalle = Array.isArray(lista) ? lista.map((x: { motivo?: unknown }) => String(x.motivo ?? '')).filter(Boolean) : [];
      if (res.error === 'SECTORES_INVALIDOS' && detalle.length > 0) setErroresSectores(detalle);
      else setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
    });
  }

  const guardarFecha = (valor: string | null) =>
    accion(async () => {
      const res = await llamar('guardar_fecha_limite', { p_fecha: valor === null ? null : deLocalAr(valor) });
      if (!res) return;
      if (!res.success) return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      if (valor === null) setFecha('');
      setMensaje({ tipo: 'info', texto: valor === null ? 'Quitaste la fecha límite.' : 'Fecha límite guardada.' });
    });

  const agregarSede = (e: FormEvent) => {
    e.preventDefault();
    void accion(async () => {
      const res = await llamar('guardar_sede', { p_nombre: nuevaSede });
      if (!res) return;
      if (!res.success) return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      setNuevaSede('');
      const mapa = await llamar('obtener_mapa_supervisor');
      if (mapa?.success) aplicarMapa(mapa, false);
      onGuardado?.();
    });
  };

  const hayPreferencias = sedes.some((s) => s.preferencias.length > 0);

  const enlaceSede = (sede: SedeServidor, rotar: boolean) =>
    accion(async () => {
      const res = await llamar('generar_acceso_sede', { p_sede_id: sede.sede_id, p_rotar: rotar });
      if (!res) return;
      if (!res.success || typeof res.clave !== 'string') return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.success ? 'RESPUESTA_INVALIDA' : res.error)) });
      const claveNueva = res.clave;
      setSedes((ss) => ss.map((s) => (s.sede_id === sede.sede_id ? { ...s, clave_acceso: claveNueva } : s)));
    });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-8">
      <h2 className="font-titulo text-xl text-texto">Sectores y accesos de sede</h2>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {!cargado && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      <section aria-labelledby={`${idBase}-sectores`} className="flex flex-col gap-3">
        <h3 id={`${idBase}-sectores`} className={CLASE_TITULO}>
          Sectores
        </h3>
        <p className="text-sm text-texto-suave">Cada sección se reparte en sectores por rango de filas, sin huecos ni solapes.</p>
        <form onSubmit={guardarSectores} className="flex flex-col gap-4">
          {SECCIONES.map((seccion) => {
            const delaSeccion = filas.filter((f) => f.seccion === seccion);
            const r = rango(seccion);
            const puedeDividir = r !== null && partirEnTres(r[0], r[1]) !== null;
            return (
              <fieldset key={seccion} className="flex flex-col gap-3 rounded-2xl border border-borde p-3">
                <legend className="px-1 text-base font-semibold text-texto">{TITULOS[seccion]}</legend>
                {r && <p className="text-sm text-texto-suave">{`Filas ${r[0]} a ${r[1]}`}</p>}
                {delaSeccion.map((f, i) => (
                  <fieldset key={f.uid} className="flex flex-col gap-2 rounded-xl bg-superficie p-3">
                    <legend className="px-1 text-sm text-texto-suave">{`Sector ${i + 1}`}</legend>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${idBase}-n${f.uid}`} className="text-base text-texto">
                        Nombre
                      </label>
                      <input id={`${idBase}-n${f.uid}`} type="text" value={f.nombre} onChange={(e) => cambiar(f.uid, { nombre: e.target.value })} autoComplete="off" className={CLASE_INPUT} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${idBase}-d${f.uid}`} className="text-base text-texto">
                          Fila desde
                        </label>
                        <input id={`${idBase}-d${f.uid}`} type="number" inputMode="numeric" min={1} step={1} value={f.desde} onChange={(e) => cambiar(f.uid, { desde: e.target.value })} className={CLASE_INPUT} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${idBase}-h${f.uid}`} className="text-base text-texto">
                          Fila hasta
                        </label>
                        <input id={`${idBase}-h${f.uid}`} type="number" inputMode="numeric" min={1} step={1} value={f.hasta} onChange={(e) => cambiar(f.uid, { hasta: e.target.value })} className={CLASE_INPUT} />
                      </div>
                    </div>
                    <Boton variante="fantasma" etiqueta={`Quitar sector ${i + 1} de ${TITULOS[seccion]}`} onClick={() => setFilas((fs) => fs.filter((x) => x.uid !== f.uid))}>
                      Quitar
                    </Boton>
                  </fieldset>
                ))}
                <div className="flex flex-col gap-2">
                  {puedeDividir && (
                    <Boton variante="secundario" onClick={() => r && dividir(seccion, r)}>
                      Dividir en 3 partes
                    </Boton>
                  )}
                  <Boton variante="secundario" onClick={() => setFilas((fs) => [...fs, nueva(seccion)])}>
                    Agregar sector
                  </Boton>
                </div>
              </fieldset>
            );
          })}
          {erroresSectores.length > 0 && (
            <ul role="alert" className="flex flex-col gap-1 rounded-2xl border border-peligro bg-superficie-alta p-3 text-base text-texto">
              {erroresSectores.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {hayPreferencias && (
            <p className="text-sm text-texto-suave">Las preferencias de las sedes se conservan solo en los sectores cuyo rango de filas no cambie.</p>
          )}
          <Boton type="submit" disabled={ocupado}>
            Guardar sectores
          </Boton>
        </form>
      </section>

      <section aria-labelledby={`${idBase}-fecha`} className="flex flex-col gap-3">
        <h3 id={`${idBase}-fecha`} className={CLASE_TITULO}>
          Plazo de las sedes
        </h3>
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
        <h3 id={`${idBase}-sedes`} className={CLASE_TITULO}>
          Enlaces de las sedes
        </h3>
        <form onSubmit={agregarSede} className="flex flex-col gap-2">
          <label htmlFor={`${idBase}-sede`} className="text-base text-texto">
            Agregar sede
          </label>
          <input id={`${idBase}-sede`} type="text" value={nuevaSede} onChange={(e) => setNuevaSede(e.target.value)} autoComplete="off" className={CLASE_INPUT} />
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
    </div>
  );
}
