'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PLANTILLA_EJEMPLO } from '@/config/plantilla';
import { SECCIONES, type Seccion } from '@/domain/types';
import { mensajeDeError } from '@/lib/rpc';
import { useSalon } from '@/state/SalonProvider';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { leerMapa } from '../MapaSupervisor';
import { MarcoPaso } from '../MarcoPaso';
import { useSupervisor } from '../SupervisorShell';
import { useArmado } from '../useArmado';
import { usePreparacion } from '../usePreparacion';
import { useRpcSupervisor } from '../useRpcSupervisor';
import { ResumenSectores } from './ResumenSectores';

type FilaSector = { uid: number; seccion: Seccion; nombre: string; desde: string; hasta: string };
type SectorGuardado = { seccion: Seccion; nombre: string; desde: number; hasta: number };
type Confirmacion = { tipo: 'vaciar'; paso: 1 | 2 } | { tipo: 'plantilla' } | null;

const CLASE_INPUT =
  'min-h-11 w-full rounded-xl border border-borde bg-superficie-alta px-3 text-base text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento';
const CLASE_TITULO = 'text-sm font-semibold uppercase tracking-wider text-texto-suave';
const TITULOS: Record<Seccion, string> = { izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' };
const PARTES = ['adelante', 'medio', 'atrás'];

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

export function SalonPaso() {
  const { claves } = useSupervisor();
  const { recargar } = usePreparacion();
  const { filas: filasSalon } = useSalon();
  const { llamar, llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [filas, setFilas] = useState<FilaSector[]>([]);
  const [guardados, setGuardados] = useState<SectorGuardado[]>([]);
  const [rangosServidor, setRangosServidor] = useState<Partial<Record<Seccion, [number, number]>>>({});
  const [hayPreferencias, setHayPreferencias] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [erroresSectores, setErroresSectores] = useState<string[]>([]);
  const [conAsignaciones, setConAsignaciones] = useState(false);
  const [confirmacion, setConfirmacion] = useState<Confirmacion>(null);
  const [ocupado, setOcupado] = useState(false);
  const uid = useRef(0);
  const idBase = useId();

  const nueva = useCallback((seccion: Seccion, nombre = '', desde = '', hasta = ''): FilaSector => ({ uid: uid.current++, seccion, nombre, desde, hasta }), []);

  useEffect(() => {
    let vivo = true;
    void llamar('obtener_mapa_supervisor').then((res) => {
      if (!vivo || !res) return;
      if (!res.success) return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      const mapa = leerMapa(res);
      const rangos: Partial<Record<Seccion, [number, number]>> = {};
      for (const s of mapa.sectores) {
        const r = rangos[s.seccion];
        rangos[s.seccion] = [Math.min(r?.[0] ?? s.fila_desde, s.fila_desde), Math.max(r?.[1] ?? s.fila_hasta, s.fila_hasta)];
      }
      setRangosServidor(rangos);
      setHayPreferencias(mapa.sedes.some((s) => s.preferencias.length > 0));
      setFilas(mapa.sectores.map((s) => nueva(s.seccion, s.nombre, String(s.fila_desde), String(s.fila_hasta))));
      setGuardados(mapa.sectores.map((s) => ({ seccion: s.seccion, nombre: s.nombre, desde: s.fila_desde, hasta: s.fila_hasta })));
      setCargado(true);
    });
    return () => {
      vivo = false;
    };
  }, [llamar, nueva, setMensaje]);

  const filasDelSalon = Object.values(filasSalon);

  /** Primer y último número de fila de la sección: del salón si hay filas, si no de los sectores ya guardados. */
  function rango(seccion: Seccion): [number, number] | null {
    const nums = filasDelSalon.filter((f) => f.seccion === seccion).map((f) => f.numero);
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
    setConAsignaciones(false);
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
        setGuardados(p_sectores.map((s) => ({ seccion: s.seccion, nombre: s.nombre, desde: s.fila_desde, hasta: s.fila_hasta })));
        recargar();
        return setMensaje({ tipo: 'info', texto: 'Sectores guardados.' });
      }
      if (res.error === 'SECTORES_CON_ASIGNACIONES') return setConAsignaciones(true);
      const lista = (res as { errores?: unknown }).errores;
      const detalle = Array.isArray(lista) ? lista.map((x: { motivo?: unknown }) => String(x.motivo ?? '')).filter(Boolean) : [];
      if (res.error === 'SECTORES_INVALIDOS' && detalle.length > 0) setErroresSectores(detalle);
      else setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
    });
  };

  async function confirmar() {
    if (confirmacion === null || ocupado) return;
    if (confirmacion.tipo === 'vaciar' && confirmacion.paso === 1) {
      setConfirmacion({ tipo: 'vaciar', paso: 2 });
      return;
    }
    const { tipo } = confirmacion;
    setOcupado(true);
    setMensaje(null);
    try {
      const res =
        tipo === 'vaciar' ? await llamarOk('reiniciar_salon') : await llamarOk('aplicar_plantilla', { p_plantilla: PLANTILLA_EJEMPLO });
      if (res) {
        setMensaje({ tipo: 'info', texto: tipo === 'vaciar' ? 'Auditorio vaciado.' : 'Plantilla aplicada.' });
        recargar();
      }
    } finally {
      setOcupado(false);
      setConfirmacion(null);
    }
  }

  function cerrarConfirmacion() {
    if (!ocupado) setConfirmacion(null);
  }

  const { titulo, cuerpo, botonConfirmar, peligro } = textosDe(confirmacion);

  return (
    <MarcoPaso paso="salon">
      <h1 className="font-titulo text-2xl text-texto">Salón</h1>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {conAsignaciones && (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-peligro bg-superficie-alta p-3 text-base text-texto">
          <p>{mensajeDeError('SECTORES_CON_ASIGNACIONES')}</p>
          <Link href="/supervisor/reservas" className="font-semibold text-acento underline">
            Ir a Reservas
          </Link>
        </div>
      )}
      {!cargado && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      <section aria-labelledby={`${idBase}-sectores`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-sectores`} className={CLASE_TITULO}>
          Sectores
        </h2>
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

      <section aria-labelledby={`${idBase}-resumen`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-resumen`} className={CLASE_TITULO}>
          Sectores guardados
        </h2>
        <ResumenSectores sectores={guardados} filas={filasDelSalon} />
      </section>

      <section aria-labelledby={`${idBase}-acciones`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-acciones`} className={CLASE_TITULO}>
          Acciones del salón
        </h2>
        <Boton variante="peligro" tamano="grande" onClick={() => setConfirmacion({ tipo: 'vaciar', paso: 1 })}>
          Vaciar auditorio
        </Boton>
        <Boton variante="secundario" tamano="grande" onClick={() => setConfirmacion({ tipo: 'plantilla' })}>
          Aplicar plantilla
        </Boton>
      </section>

      {/* key: cada paso es un diálogo nuevo, así el foco vuelve a entrar al diálogo en el paso 2. */}
      <Modal
        key={confirmacion === null ? 'cerrado' : `${confirmacion.tipo}-${'paso' in confirmacion ? confirmacion.paso : 0}`}
        abierto={confirmacion !== null}
        onCerrar={cerrarConfirmacion}
        titulo={titulo}
      >
        <div className="flex flex-col gap-4">
          <p className="text-base text-texto">{cuerpo}</p>
          <div className="flex flex-col gap-2">
            <Boton variante="secundario" data-autofocus onClick={cerrarConfirmacion} disabled={ocupado} className="w-full">
              Cancelar
            </Boton>
            <BotonConfirmar peligro={peligro} ocupado={ocupado} onConfirmar={confirmar}>
              {botonConfirmar}
            </BotonConfirmar>
          </div>
        </div>
      </Modal>
    </MarcoPaso>
  );
}

function textosDe(c: Confirmacion): { titulo: string; cuerpo: string; botonConfirmar: string; peligro: boolean } {
  if (c === null) return { titulo: '', cuerpo: '', botonConfirmar: '', peligro: false };
  if (c.tipo === 'vaciar') {
    return c.paso === 1
      ? {
          titulo: 'Vaciar auditorio',
          cuerpo:
            'Vas a dejar todos los lugares como libres y cancelar los grupos que están en camino. Las filas y las reservas se mantienen.',
          botonConfirmar: 'Continuar',
          peligro: false,
        }
      : {
          titulo: '¿Seguro que querés vaciarlo?',
          cuerpo: 'No se puede deshacer y todos los ujieres lo ven al instante. Hacelo solo al terminar o antes de empezar.',
          botonConfirmar: 'Sí, vaciar',
          peligro: true,
        };
  }
  return {
    titulo: 'Aplicar plantilla',
    cuerpo:
      'Se reemplazan todas las filas y tramos por los de la plantilla y se cancelan los grupos en camino. Se pierde el conteo actual. Los sectores no se tocan: revisá los sectores después, porque sus rangos de filas pueden dejar de coincidir con las filas nuevas.',
    botonConfirmar: 'Sí, aplicar',
    peligro: true,
  };
}

/**
 * Botón de confirmación del diálogo. Los destructivos arrancan deshabilitados y se arman tras ARMADO_MS
 * (el diálogo se monta de nuevo en cada paso, así que cada paso vuelve a armarse). Mientras tanto un
 * texto visible, enlazado con aria-describedby, explica por qué no responde.
 */
function BotonConfirmar({
  peligro,
  ocupado,
  onConfirmar,
  children,
}: {
  peligro: boolean;
  ocupado: boolean;
  onConfirmar(): void;
  children: ReactNode;
}) {
  const armado = useArmado();
  const esperando = peligro && !armado;
  const idAyuda = useId();
  return (
    <>
      <Boton
        variante={peligro ? 'peligro' : 'primario'}
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
