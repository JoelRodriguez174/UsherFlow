'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Grid3X3, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PLANTILLA_EJEMPLO } from '@/config/plantilla';
import { capacidadPublicaFila } from '@/domain/disponibilidad';
import {
  calcularNuevoSectorSinSolape,
  construirPlantillaUniforme,
  indicesConSolape,
  partirRango,
  type DimensionSeccion,
  type Plantilla,
} from '@/domain/plantilla';
import { SECCIONES, type Fila, type Seccion } from '@/domain/types';
import { mensajeDeError } from '@/lib/rpc';
import { useSalon } from '@/state/SalonProvider';
import { MapaSalon, type SectorMapa } from '@/components/mapa/MapaSalon';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Desplegable } from '@/components/ui/Desplegable';
import { Modal } from '@/components/ui/Modal';
import { BotonConfirmar } from '../BotonConfirmar';
import { CLASE_INPUT, CLASE_TITULO } from '../estilos';
import { leerMapa } from '../MapaSupervisor';
import { MarcoPaso } from '../MarcoPaso';
import { useSupervisor } from '../SupervisorShell';
import { usePreparacion } from '../usePreparacion';
import { useRpcSupervisor } from '../useRpcSupervisor';
import { ResumenSectores } from './ResumenSectores';

type FilaSector = { uid: number; seccion: Seccion; nombre: string; desde: string; hasta: string };
type Confirmacion =
  | { tipo: 'vaciar'; paso: 1 | 2 }
  | { tipo: 'plantilla' }
  | { tipo: 'filas_custom'; plantilla: Plantilla; resumen: string }
  | null;

const TITULOS: Record<Seccion, string> = { izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' };
const NOMBRES_POR_PARTES: Record<number, string[]> = {
  2: ['adelante', 'atrás'],
  3: ['adelante', 'medio', 'atrás'],
  4: ['adelante', 'medio-adelante', 'medio-atrás', 'atrás'],
};
const DIMENSIONES_DEFECTO: Record<Seccion, DimensionSeccion> = {
  izquierda: { filas: 20, sillas: 10 },
  centro: { filas: 20, sillas: 18 },
  derecha: { filas: 20, sillas: 10 },
};

function dimensionesDesdeSalon(filasDelSalon: ReadonlyArray<Fila>): Record<Seccion, DimensionSeccion> {
  if (filasDelSalon.length === 0) return { ...DIMENSIONES_DEFECTO };
  const res = {} as Record<Seccion, DimensionSeccion>;
  for (const seccion of SECCIONES) {
    const deSeccion = filasDelSalon.filter((f) => f.seccion === seccion);
    if (deSeccion.length === 0) {
      res[seccion] = { filas: 0, sillas: DIMENSIONES_DEFECTO[seccion].sillas };
    } else {
      const capTotal = deSeccion.reduce(
        (acc, f) => acc + f.tramos.reduce((s, t) => s + t.capacidad, 0),
        0,
      );
      res[seccion] = {
        filas: deSeccion.length,
        sillas: Math.max(1, Math.round(capTotal / deSeccion.length)),
      };
    }
  }
  return res;
}

export function SalonPaso() {
  const { claves } = useSupervisor();
  const { recargar } = usePreparacion();
  const { filas: filasSalon } = useSalon();
  const { llamar, llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [filas, setFilas] = useState<FilaSector[]>([]);
  const [rangosServidor, setRangosServidor] = useState<Partial<Record<Seccion, [number, number]>>>({});
  const [hayPreferencias, setHayPreferencias] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [erroresSectores, setErroresSectores] = useState<string[]>([]);
  const [conAsignaciones, setConAsignaciones] = useState(false);
  const [confirmacion, setConfirmacion] = useState<Confirmacion>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dimensionesEditadas, setDimensionesEditadas] = useState<Record<Seccion, DimensionSeccion> | null>(null);
  const uid = useRef(0);
  const idBase = useId();

  const nueva = useCallback(
    (seccion: Seccion, nombre = '', desde = '', hasta = ''): FilaSector => ({
      uid: uid.current++,
      seccion,
      nombre,
      desde,
      hasta,
    }),
    [],
  );

  useEffect(() => {
    let vivo = true;
    void llamar('obtener_mapa_supervisor').then((res) => {
      if (!vivo || !res) return;
      if (!res.success) return setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      const mapa = leerMapa(res);
      const rangos: Partial<Record<Seccion, [number, number]>> = {};
      for (const s of mapa.sectores) {
        const r = rangos[s.seccion];
        rangos[s.seccion] = [
          Math.min(r?.[0] ?? s.fila_desde, s.fila_desde),
          Math.max(r?.[1] ?? s.fila_hasta, s.fila_hasta),
        ];
      }
      setRangosServidor(rangos);
      setHayPreferencias(mapa.sedes.some((s) => s.preferencias.length > 0));
      setFilas(mapa.sectores.map((s) => nueva(s.seccion, s.nombre, String(s.fila_desde), String(s.fila_hasta))));
      setCargado(true);
    });
    return () => {
      vivo = false;
    };
  }, [llamar, nueva, setMensaje]);

  const filasDelSalon = useMemo(() => Object.values(filasSalon), [filasSalon]);
  const dimensionesBase = useMemo(() => dimensionesDesdeSalon(filasDelSalon), [filasDelSalon]);
  const dimensiones = dimensionesEditadas ?? dimensionesBase;

  // Vista previa del formulario tal como está (sin guardar); se ignoran las filas incompletas.
  const vistaPrevia = filas.flatMap((f) => {
    const [desde, hasta] = [f.desde.trim(), f.hasta.trim()];
    if (!/^\d+$/.test(desde) || !/^\d+$/.test(hasta) || Number(desde) > Number(hasta)) return [];
    return [{ seccion: f.seccion, nombre: f.nombre.trim() || 'Sin nombre', desde: Number(desde), hasta: Number(hasta) }];
  });

  const sectoresMapaPreview: SectorMapa[] = vistaPrevia.map((s, idx) => {
    const lugares = filasDelSalon
      .filter((f) => f.seccion === s.seccion && f.numero >= s.desde && f.numero <= s.hasta)
      .reduce((n, f) => n + capacidadPublicaFila(f), 0);
    return {
      id: idx + 1,
      seccion: s.seccion,
      nombre: s.nombre,
      filaDesde: s.desde,
      filaHasta: s.hasta,
      estado: lugares > 0 || filasDelSalon.length === 0 ? 'disponible' : 'agotado',
      detalle: filasDelSalon.length > 0 ? `${lugares} ${lugares === 1 ? 'lugar' : 'lugares'}` : undefined,
    };
  });

  /** Primer y último número de fila de la sección: del salón si hay filas, si no de los sectores ya guardados. */
  function rango(seccion: Seccion): [number, number] | null {
    const nums = filasDelSalon.filter((f) => f.seccion === seccion).map((f) => f.numero);
    return nums.length > 0 ? [Math.min(...nums), Math.max(...nums)] : (rangosServidor[seccion] ?? null);
  }

  function dividirEn(seccion: Seccion, [desde, hasta]: [number, number], partes: 2 | 3 | 4) {
    const subrangos = partirRango(desde, hasta, partes);
    if (!subrangos) return;
    const nombres = NOMBRES_POR_PARTES[partes];
    setFilas((fs) => [
      ...fs.filter((f) => f.seccion !== seccion),
      ...subrangos.map(([d, h], i) => nueva(seccion, nombres[i] ?? `Sector ${i + 1}`, String(d), String(h))),
    ]);
  }

  function dividirTodoEnTres() {
    setFilas((fs) => {
      let resultado = [...fs];
      for (const seccion of SECCIONES) {
        const r = rango(seccion);
        const subrangos = r ? partirRango(r[0], r[1], 3) : null;
        if (!subrangos) continue;
        resultado = [
          ...resultado.filter((f) => f.seccion !== seccion),
          ...subrangos.map(([d, h], i) => nueva(seccion, NOMBRES_POR_PARTES[3][i], String(d), String(h))),
        ];
      }
      return resultado;
    });
  }

  function agregarSectorInteligente(seccion: Seccion) {
    const existentes = filas.filter((f) => f.seccion === seccion);
    const r = rango(seccion);
    if (!r) {
      setFilas((fs) => [...fs, nueva(seccion)]);
      return;
    }
    const validos = existentes
      .map((f, idx) => {
        const d = /^\d+$/.test(f.desde.trim()) ? Number(f.desde) : null;
        const h = /^\d+$/.test(f.hasta.trim()) ? Number(f.hasta) : null;
        return d !== null && h !== null && d <= h ? { uid: f.uid, idx, desde: d, hasta: h } : null;
      })
      .filter((x): x is { uid: number; idx: number; desde: number; hasta: number } => x !== null);

    const plan = calcularNuevoSectorSinSolape(validos, r[0], r[1]);
    if (!plan) return;

    const uidRecortar = plan.indiceRecortar !== null ? validos[plan.indiceRecortar].uid : null;
    const creado = nueva(seccion, `Sector ${existentes.length + 1}`, String(plan.nuevo.desde), String(plan.nuevo.hasta));

    setFilas((fs) => {
      const actualizadas = fs.map((f) =>
        uidRecortar !== null && f.uid === uidRecortar && plan.nuevoHastaRecortado !== null
          ? { ...f, hasta: String(plan.nuevoHastaRecortado) }
          : f,
      );
      if (uidRecortar !== null) {
        const pos = actualizadas.findIndex((f) => f.uid === uidRecortar);
        if (pos >= 0) {
          return [...actualizadas.slice(0, pos + 1), creado, ...actualizadas.slice(pos + 1)];
        }
      }
      return [...actualizadas, creado];
    });
  }

  const cambiar = (u: number, cambio: Partial<FilaSector>) =>
    setFilas((fs) => fs.map((f) => (f.uid === u ? { ...f, ...cambio } : f)));

  function cambiarDimension(seccion: Seccion, campo: 'filas' | 'sillas', valor: string) {
    const num = Math.max(0, Math.min(campo === 'filas' ? 80 : 60, Number.parseInt(valor || '0', 10) || 0));
    setDimensionesEditadas((prev) => ({
      ...(prev ?? dimensionesBase),
      [seccion]: { ...(prev ?? dimensionesBase)[seccion], [campo]: num },
    }));
  }

  function pedirAplicarDimensiones(e: FormEvent) {
    e.preventDefault();
    const totalFilas = SECCIONES.reduce((acc, s) => acc + dimensiones[s].filas, 0);
    if (totalFilas === 0) {
      setMensaje({ tipo: 'error', texto: 'Definí al menos una fila en alguna sección.' });
      return;
    }
    const plantilla = construirPlantillaUniforme(dimensiones);
    const totalLugares = SECCIONES.reduce((acc, s) => acc + dimensiones[s].filas * dimensiones[s].sillas, 0);
    const resumen = `${SECCIONES.map((s) => `${TITULOS[s]} ${dimensiones[s].filas}×${dimensiones[s].sillas}`).join(' · ')} (${totalLugares} lugares)`;
    setConfirmacion({ tipo: 'filas_custom', plantilla, resumen });
  }

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
        .map((f) => ({
          seccion: f.seccion,
          nombre: f.nombre.trim(),
          fila_desde: Number(f.desde),
          fila_hasta: Number(f.hasta),
        }));
      const res = await llamar('guardar_sectores', { p_sectores });
      if (!res) return;
      if (res.success) {
        recargar();
        return setMensaje({ tipo: 'info', texto: 'Sectores guardados.' });
      }
      if (res.error === 'SECTORES_CON_ASIGNACIONES') return setConAsignaciones(true);
      const lista = (res as { errores?: unknown }).errores;
      const detalle = Array.isArray(lista)
        ? lista.map((x: { motivo?: unknown }) => String(x.motivo ?? '')).filter(Boolean)
        : [];
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
    const actual = confirmacion;
    setOcupado(true);
    setMensaje(null);
    setErroresSectores([]);
    setConAsignaciones(false);
    try {
      const res =
        actual.tipo === 'vaciar'
          ? await llamarOk('reiniciar_salon')
          : actual.tipo === 'filas_custom'
            ? await llamarOk('aplicar_plantilla', { p_plantilla: actual.plantilla })
            : await llamarOk('aplicar_plantilla', { p_plantilla: PLANTILLA_EJEMPLO });
      if (res) {
        if (actual.tipo === 'filas_custom') setDimensionesEditadas(null);
        setMensaje({
          tipo: 'info',
          texto:
            actual.tipo === 'vaciar'
              ? 'Auditorio vaciado.'
              : actual.tipo === 'filas_custom'
                ? 'Filas y sillas actualizadas. Revisá los sectores si cambiaron los rangos.'
                : 'Plantilla aplicada.',
        });
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

  const seccionesDivisiblesEn3 = SECCIONES.filter((s) => {
    const r = rango(s);
    return r !== null && partirRango(r[0], r[1], 3) !== null;
  }).length;

  const totalActualLugares = filasDelSalon.reduce((acc, f) => acc + capacidadPublicaFila(f), 0);
  const subtituloFilas =
    filasDelSalon.length > 0
      ? `${SECCIONES.map((s) => `${TITULOS[s].slice(0, 3)}: ${dimensionesBase[s].filas}×${dimensionesBase[s].sillas}`).join(' · ')} · ${totalActualLugares} lugares públicos`
      : 'Configurá cuántas filas y sillas tiene cada sección';

  const { titulo, cuerpo, botonConfirmar, peligro } = textosDe(confirmacion);

  return (
    <MarcoPaso paso="salon" ancho="amplio">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-titulo text-2xl text-texto">Salón</h1>
        {filasDelSalon.length > 0 && (
          <span className="text-sm font-semibold text-texto-suave tabular-nums">
            {`${filasDelSalon.length} filas · ${totalActualLugares} lugares públicos`}
          </span>
        )}
      </div>

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

      <Desplegable
        titulo="Filas y sillas del salón"
        subtitulo={subtituloFilas}
        icono={<Grid3X3 className="size-5" />}
      >
        <form onSubmit={pedirAplicarDimensiones} className="flex flex-col gap-4">
          <p className="text-sm text-texto-suave">
            Definí cuántas filas y sillas por fila tiene cada sección (poné 0 filas si no usás una sección).
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SECCIONES.map((seccion) => {
              const dim = dimensiones[seccion];
              const subtotal = dim.filas * dim.sillas;
              return (
                <div key={seccion} className="flex flex-col gap-2 rounded-xl border border-borde bg-fondo/60 p-3">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold text-texto">{TITULOS[seccion]}</span>
                    <span className="text-xs font-semibold text-acento tabular-nums">{`${subtotal} lugares`}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${idBase}-dim-f-${seccion}`} className="text-xs text-texto-suave">
                        Filas
                      </label>
                      <input
                        id={`${idBase}-dim-f-${seccion}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={80}
                        value={dim.filas}
                        onChange={(e) => cambiarDimension(seccion, 'filas', e.target.value)}
                        className={CLASE_INPUT}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${idBase}-dim-s-${seccion}`} className="text-xs text-texto-suave">
                        Sillas / fila
                      </label>
                      <input
                        id={`${idBase}-dim-s-${seccion}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={60}
                        value={dim.sillas}
                        onChange={(e) => cambiarDimension(seccion, 'sillas', e.target.value)}
                        className={CLASE_INPUT}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-texto tabular-nums">
              {`Total nuevo: ${SECCIONES.reduce((acc, s) => acc + dimensiones[s].filas * dimensiones[s].sillas, 0)} lugares`}
            </span>
            <Boton type="submit" variante="secundario" disabled={ocupado}>
              Aplicar filas y sillas
            </Boton>
          </div>
        </form>
      </Desplegable>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(21rem,1fr)] xl:items-start">
        <section aria-labelledby={`${idBase}-sectores`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id={`${idBase}-sectores`} className={CLASE_TITULO}>
                Sectores
              </h2>
              <p className="text-sm text-texto-suave">Repartí cada sección por rango de filas, sin huecos ni solapes.</p>
            </div>
            {seccionesDivisiblesEn3 >= 2 && (
              <Boton variante="fantasma" onClick={dividirTodoEnTres} disabled={ocupado}>
                <Sparkles aria-hidden="true" className="size-4 shrink-0" />
                Dividir todo en 3
              </Boton>
            )}
          </div>

          <form onSubmit={guardarSectores} className="flex flex-col gap-4">
            {SECCIONES.map((seccion) => {
              const delaSeccion = filas.filter((f) => f.seccion === seccion);
              const r = rango(seccion);
              const puede2 = r !== null && partirRango(r[0], r[1], 2) !== null;
              const puede3 = r !== null && partirRango(r[0], r[1], 3) !== null;
              const puede4 = r !== null && partirRango(r[0], r[1], 4) !== null;
              const rangosSeccion = delaSeccion.map((f) => {
                const d = /^\d+$/.test(f.desde.trim()) ? Number(f.desde) : null;
                const h = /^\d+$/.test(f.hasta.trim()) ? Number(f.hasta) : null;
                return d !== null && h !== null && d <= h ? { desde: d, hasta: h } : null;
              });
              const solapados = indicesConSolape(rangosSeccion);
              const puedeAgregar =
                r === null ||
                calcularNuevoSectorSinSolape(
                  rangosSeccion.filter((x): x is { desde: number; hasta: number } => x !== null),
                  r[0],
                  r[1],
                ) !== null;
              return (
                <fieldset
                  key={seccion}
                  className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4"
                >
                  <legend className="px-1 text-base font-semibold text-texto">{TITULOS[seccion]}</legend>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-texto-suave tabular-nums">
                      {r ? `Filas ${r[0]} a ${r[1]}` : 'Sin filas cargadas'}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {puede2 && (
                        <button
                          type="button"
                          onClick={() => r && dividirEn(seccion, r, 2)}
                          className="min-h-9 rounded-lg border border-borde bg-superficie-alta px-2.5 text-xs font-semibold text-texto-suave transition-colors hover:border-acento hover:text-texto"
                        >
                          ÷ 2
                        </button>
                      )}
                      {puede3 && (
                        <button
                          type="button"
                          onClick={() => r && dividirEn(seccion, r, 3)}
                          className="min-h-9 rounded-lg border border-borde bg-superficie-alta px-2.5 text-xs font-semibold text-texto-suave transition-colors hover:border-acento hover:text-texto"
                        >
                          Dividir en 3 partes
                        </button>
                      )}
                      {puede4 && (
                        <button
                          type="button"
                          onClick={() => r && dividirEn(seccion, r, 4)}
                          className="min-h-9 rounded-lg border border-borde bg-superficie-alta px-2.5 text-xs font-semibold text-texto-suave transition-colors hover:border-acento hover:text-texto"
                        >
                          ÷ 4
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!puedeAgregar}
                        onClick={() => agregarSectorInteligente(seccion)}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-acento/50 bg-acento/10 px-2.5 text-xs font-semibold text-acento transition-colors hover:bg-acento/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus aria-hidden="true" className="size-3.5" />
                        Agregar sector
                      </button>
                    </div>
                  </div>

                  {delaSeccion.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-borde px-3 py-2.5 text-sm text-texto-suave">
                      Todavía no hay divisiones en {TITULOS[seccion]}. Usá los botones de arriba para dividir o agregar una.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {delaSeccion.map((f, i) => {
                        const d = /^\d+$/.test(f.desde.trim()) ? Number(f.desde) : null;
                        const h = /^\d+$/.test(f.hasta.trim()) ? Number(f.hasta) : null;
                        const lugaresFila =
                          d !== null && h !== null && d <= h && filasDelSalon.length > 0
                            ? filasDelSalon
                                .filter((fila) => fila.seccion === seccion && fila.numero >= d && fila.numero <= h)
                                .reduce((acc, fila) => acc + capacidadPublicaFila(fila), 0)
                            : null;
                        const enSolape = solapados.has(i);
                        return (
                          <div
                            key={f.uid}
                            className={`grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_auto] items-end gap-2 rounded-xl border bg-fondo/60 p-2.5 ${
                              enSolape ? 'border-peligro' : 'border-borde/70'
                            }`}
                          >
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="flex items-baseline justify-between gap-1">
                                <label htmlFor={`${idBase}-n${f.uid}`} className="text-xs font-medium text-texto-suave">
                                  Nombre
                                </label>
                                {enSolape ? (
                                  <span className="text-[11px] font-semibold text-peligro">Se superpone</span>
                                ) : (
                                  lugaresFila !== null && (
                                    <span className="text-[11px] font-semibold text-acento tabular-nums">
                                      {`${lugaresFila} lug.`}
                                    </span>
                                  )
                                )}
                              </div>
                              <input
                                id={`${idBase}-n${f.uid}`}
                                type="text"
                                value={f.nombre}
                                placeholder={`Sector ${i + 1}`}
                                onChange={(e) => cambiar(f.uid, { nombre: e.target.value })}
                                autoComplete="off"
                                className={CLASE_INPUT}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`${idBase}-d${f.uid}`} className="text-xs font-medium text-texto-suave">
                                Fila desde
                              </label>
                              <input
                                id={`${idBase}-d${f.uid}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                value={f.desde}
                                onChange={(e) => cambiar(f.uid, { desde: e.target.value })}
                                className={`${CLASE_INPUT} px-2 text-center tabular-nums`}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`${idBase}-h${f.uid}`} className="text-xs font-medium text-texto-suave">
                                Fila hasta
                              </label>
                              <input
                                id={`${idBase}-h${f.uid}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                value={f.hasta}
                                onChange={(e) => cambiar(f.uid, { hasta: e.target.value })}
                                className={`${CLASE_INPUT} px-2 text-center tabular-nums`}
                              />
                            </div>
                            <button
                              type="button"
                              aria-label={`Quitar sector ${i + 1} de ${TITULOS[seccion]}`}
                              onClick={() => setFilas((fs) => fs.filter((x) => x.uid !== f.uid))}
                              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-texto-suave transition-colors hover:border-peligro/40 hover:bg-superficie-alta hover:text-peligro"
                            >
                              <Trash2 aria-hidden="true" className="size-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
              <p className="text-sm text-texto-suave">
                Las preferencias de las sedes se conservan solo en los sectores cuyo rango de filas no cambie.
              </p>
            )}
            <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
              Guardar sectores
            </Boton>
          </form>
        </section>

        <aside
          aria-labelledby={`${idBase}-resumen`}
          className="flex flex-col gap-4 xl:sticky xl:top-6"
        >
          <h2 id={`${idBase}-resumen`} className={CLASE_TITULO}>
            Vista previa de sectores
          </h2>

          {sectoresMapaPreview.length > 0 && (
            <div aria-hidden="true">
              <MapaSalon
                sectores={sectoresMapaPreview}
                deshabilitado
                leyenda={['disponible', 'agotado']}
              />
            </div>
          )}

          <div className="rounded-2xl border border-borde bg-superficie p-4">
            <ResumenSectores sectores={vistaPrevia} filas={filasDelSalon} />
            {vistaPrevia.length === 0 && filasDelSalon.length === 0 && (
              <p className="text-sm text-texto-suave">Agregá sectores para ver el plano en vivo.</p>
            )}
          </div>
        </aside>
      </div>

      <section
        aria-labelledby={`${idBase}-acciones`}
        className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4"
      >
        <h2 id={`${idBase}-acciones`} className={CLASE_TITULO}>
          Acciones del salón
        </h2>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={() => setConfirmacion({ tipo: 'plantilla' })}>
            Aplicar plantilla
          </Boton>
          <Boton variante="peligro" onClick={() => setConfirmacion({ tipo: 'vaciar', paso: 1 })}>
            Vaciar auditorio
          </Boton>
        </div>
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
          cuerpo:
            'No se puede deshacer y todos los ujieres lo ven al instante. Hacelo solo al terminar o antes de empezar.',
          botonConfirmar: 'Sí, vaciar',
          peligro: true,
        };
  }
  if (c.tipo === 'filas_custom') {
    return {
      titulo: 'Aplicar filas y sillas',
      cuerpo: `Se van a reemplazar las filas del salón por: ${c.resumen}. Se pierde el conteo actual y los sectores no se tocan (revisá sus rangos después).`,
      botonConfirmar: 'Sí, aplicar',
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
