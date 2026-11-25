'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Trash2 } from 'lucide-react';
import type { Seccion } from '@/domain/types';
import {
  estadoSectorReserva,
  filasParaGuardar,
  hayCambiosEnSesion,
  libresDelSector,
  resumenSesion,
} from '@/domain/reservasMapa';
import { mostrarHora } from '@/lib/fechas';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { MapaSalon, type EstadoSector, type SectorMapa } from '@/components/mapa/MapaSalon';
import { SelectorZona, type FiltroZona } from '@/components/mapa/SelectorZona';
import { PantallaClaveInvalida } from '@/components/paginas/PantallaClaveInvalida';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { GuiaUso } from '@/components/ui/GuiaUso';
import { Modal } from '@/components/ui/Modal';
import { EditorSector, type SectorEditable } from './EditorSector';

type SectorServidor = { id: number; seccion: Seccion; nombre: string; fila_desde: number; fila_hasta: number };
type SectorSesionServidor = {
  sector_id: number;
  agotado: boolean;
  asignado: number;
  capacidad?: number;
  disponibles?: number;
};
type SesionServidor = {
  id: string;
  nombre: string;
  inicio_at: string;
  sectores: SectorSesionServidor[];
};
type Mapa = {
  sede: { id: string; nombre: string };
  fecha_limite: string | null;
  abierto: boolean;
  sectores: SectorServidor[];
  preferencias: number[];
  sesiones: SesionServidor[];
};
type Mensaje = { tipo: 'error' | 'info'; texto: string };

// shortcut: polling, subir a realtime si hace falta
const POLLING_MS = 30_000;
const LEYENDA_RESERVA: EstadoSector[] = ['disponible', 'pocos', 'agotado', 'asignado'];
const TAG_ZONA: Record<Seccion, string> = { izquierda: 'Izq', centro: 'Centro', derecha: 'Der' };

function textosErrores(res: Record<string, unknown>): string {
  const lista = Array.isArray(res.errores) ? (res.errores as Array<{ fila: number; motivo: string }>) : [];
  return lista.map((x) => (x.fila === 0 ? x.motivo : `Fila ${x.fila}: ${x.motivo}`)).join(' · ');
}

function confirmadoDe(sesion: SesionServidor | undefined): Record<number, number> {
  const res: Record<number, number> = {};
  if (!sesion) return res;
  for (const s of sesion.sectores) {
    if (s.asignado > 0) res[s.sector_id] = s.asignado;
  }
  return res;
}

function suscribirEscritorio(alCambiar: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(min-width: 1024px)');
  mq.addEventListener('change', alCambiar);
  return () => mq.removeEventListener('change', alCambiar);
}

function esEscritorioActual(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(min-width: 1024px)').matches;
}

export function SedePanel({ clave }: { clave: string }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, Record<number, number>>>({});
  const [sectorActivoId, setSectorActivoId] = useState<number | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<{ sectorId: number; cantidad: number } | null>(null);
  const [zona, setZona] = useState<FiltroZona>('todas');
  const [soloDisponibles, setSoloDisponibles] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [cambioPendienteId, setCambioPendienteId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  const [claveInvalida, setClaveInvalida] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const esEscritorio = useSyncExternalStore(suscribirEscritorio, esEscritorioActual, () => false);

  const cargar = useCallback(async () => {
    try {
      const res = await llamarRpc('obtener_mapa_sede', { p_clave: clave });
      if (!res.success) throw new Error(String(res.error));
      if (guardandoRef.current) return;
      const m = res as unknown as Mapa;
      setMapa(m);
      setFalloCarga(false);
    } catch (e) {
      if (e instanceof ClaveInvalidaError) setClaveInvalida(true);
      else setFalloCarga(true);
    }
  }, [clave]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void cargar();
    const timer = setInterval(() => void cargar(), POLLING_MS);
    return () => clearInterval(timer);
  }, [cargar]);

  const sesion = useMemo(
    () => (mapa ? mapa.sesiones.find((s) => s.id === sesionId) ?? mapa.sesiones[0] : undefined),
    [mapa, sesionId],
  );

  const confirmado = useMemo(() => confirmadoDe(sesion), [sesion]);
  const borrador = useMemo(
    () => (sesion && borradores[sesion.id] ? borradores[sesion.id] : confirmado),
    [sesion, borradores, confirmado],
  );
  const hayCambios = useMemo(() => hayCambiosEnSesion(confirmado, borrador), [confirmado, borrador]);
  const resumen = useMemo(() => resumenSesion(borrador), [borrador]);

  if (claveInvalida) return <PantallaClaveInvalida tipo="sede" />;

  if (mapa === null) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
        {falloCarga ? (
          <>
            <p role="alert" className="rounded-2xl border border-peligro bg-superficie-alta p-4 text-base text-texto">
              {mensajeDeError('ERROR_DE_RED')}
            </p>
            <Boton variante="secundario" onClick={() => void cargar()}>
              Probar de nuevo
            </Boton>
          </>
        ) : (
          <p role="status" className="text-base text-texto-suave">
            Cargando el mapa…
          </p>
        )}
      </main>
    );
  }

  function datosDeSector(id: number): { disponibles: number; capacidad: number; agotado: boolean } {
    const dato = sesion?.sectores.find((x) => x.sector_id === id);
    if (!dato) return { disponibles: 0, capacidad: 0, agotado: true };
    const capacidad = dato.capacidad ?? (dato.agotado ? dato.asignado : Math.max(dato.asignado, 1));
    const disponibles = dato.disponibles ?? (dato.agotado ? dato.asignado : capacidad);
    return { disponibles, capacidad, agotado: dato.agotado && dato.asignado === 0 };
  }

  const sectoresMapa: SectorMapa[] = mapa.sectores.map((s) => {
    const { disponibles, capacidad } = datosDeSector(s.id);
    const elegido =
      vistaPrevia && vistaPrevia.sectorId === s.id ? vistaPrevia.cantidad : (borrador[s.id] ?? 0);
    const estado = estadoSectorReserva(disponibles, capacidad, elegido);
    const libres = libresDelSector(disponibles, elegido);
    const sinConfirmar = elegido !== (confirmado[s.id] ?? 0);
    let detalle: string | undefined;
    if (elegido > 0) {
      detalle = `${elegido} ${elegido === 1 ? 'lugar' : 'lugares'}`;
    } else if (estado === 'pocos') {
      detalle = libres === 1 ? 'Queda 1' : `Quedan ${libres}`;
    } else if (estado === 'disponible') {
      detalle = `${libres} libres`;
    }
    return {
      id: s.id,
      seccion: s.seccion,
      nombre: s.nombre,
      filaDesde: s.fila_desde,
      filaHasta: s.fila_hasta,
      estado,
      detalle,
      capacidad,
      libres,
      seleccionado: sectorActivoId === s.id,
      sinConfirmar,
    };
  });

  const sectorActivo: SectorEditable | null = (() => {
    if (sectorActivoId === null) return null;
    const s = mapa.sectores.find((x) => x.id === sectorActivoId);
    if (!s) return null;
    const { disponibles, capacidad } = datosDeSector(s.id);
    return {
      id: s.id,
      seccion: s.seccion,
      nombre: s.nombre,
      filaDesde: s.fila_desde,
      filaHasta: s.fila_hasta,
      disponibles,
      capacidad,
    };
  })();

  function actualizarSector(id: number, cantidad: number) {
    if (!sesion) return;
    setBorradores((prev) => {
      const actual = { ...(prev[sesion.id] ?? confirmado) };
      if (cantidad <= 0) delete actual[id];
      else actual[id] = cantidad;
      return { ...prev, [sesion.id]: actual };
    });
    setSectorActivoId(null);
    setVistaPrevia(null);
    setMensaje(null);
  }

  function cerrarEditor() {
    setSectorActivoId(null);
    setVistaPrevia(null);
  }

  function intentarCambiarSesion(nuevaId: string) {
    if (!sesion || nuevaId === sesion.id) return;
    if (hayCambios) {
      setCambioPendienteId(nuevaId);
      return;
    }
    setSesionId(nuevaId);
    setSectorActivoId(null);
    setCambioPendienteId(null);
    setMensaje(null);
  }

  async function confirmar(siguienteSesionId?: string) {
    if (!sesion || !mapa?.abierto || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setMensaje(null);
    const filas = filasParaGuardar(mapa.sectores, sesion.nombre, borrador);
    try {
      const res = await llamarRpc('guardar_reservas_sede', {
        p_clave: clave,
        p_filas: filas,
        p_sesiones: [sesion.nombre],
      });
      if (res.success) {
        setBorradores((prev) => {
          const copia = { ...prev };
          delete copia[sesion.id];
          return copia;
        });
        setDetalleAbierto(false);
        setCambioPendienteId(null);
        setSectorActivoId(null);
        if (siguienteSesionId) setSesionId(siguienteSesionId);
        setMensaje({ tipo: 'info', texto: `Reservas de ${sesion.nombre} guardadas.` });
      } else {
        if (res.error === 'FECHA_LIMITE_VENCIDA') setMapa((m) => m && { ...m, abierto: false });
        const detalle = res.error === 'RESERVAS_INVALIDAS' ? textosErrores(res) : '';
        setMensaje({
          tipo: 'error',
          texto: [mensajeDeError(String(res.error)), detalle].filter(Boolean).join(' '),
        });
      }
    } catch (e) {
      if (e instanceof ClaveInvalidaError) {
        setClaveInvalida(true);
        return;
      }
      setMensaje({ tipo: 'error', texto: mensajeDeError('ERROR_DE_RED') });
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
    void cargar();
  }

  const itemsCarrito = mapa.sectores
    .filter((s) => (borrador[s.id] ?? 0) > 0)
    .map((s) => ({ ...s, cantidad: borrador[s.id] }));

  const contenidoCarrito = (
    <div className="flex flex-col gap-3">
      {itemsCarrito.length === 0 ? (
        <p className="text-base text-texto-suave">
          {mapa.abierto
            ? 'Tocá un sector disponible en el mapa para elegir cuántos lugares reservar.'
            : 'No tenés lugares reservados en esta sesión.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itemsCarrito.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-borde bg-fondo px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-texto">{item.nombre}</p>
                  <span className="rounded-full border border-borde bg-superficie-alta px-2 py-0.5 text-[11px] font-semibold text-texto-suave">
                    {TAG_ZONA[item.seccion]}
                  </span>
                </div>
                <p className="text-sm text-texto-suave tabular-nums">
                  {`${item.cantidad} ${item.cantidad === 1 ? 'lugar' : 'lugares'} · filas ${item.fila_desde}–${item.fila_hasta}`}
                </p>
              </div>
              {mapa.abierto && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDetalleAbierto(false);
                      setSectorActivoId(item.id);
                    }}
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold text-acento hover:bg-superficie-alta"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${item.nombre}`}
                    onClick={() => actualizarSector(item.id, 0)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-texto-suave hover:bg-superficie-alta hover:text-peligro"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {mapa.abierto && sesion && (
        <Boton
          tamano="grande"
          disabled={!hayCambios || guardando}
          onClick={() => void confirmar()}
          className="w-full"
        >
          {guardando ? 'Guardando…' : `Confirmar reservas de ${sesion.nombre}`}
        </Boton>
      )}
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6 pb-28 lg:grid lg:max-w-7xl lg:grid-cols-[minmax(0,1.45fr)_minmax(22rem,1fr)] lg:items-start lg:gap-x-8 lg:pb-8">
      <header className="flex flex-col gap-1 lg:col-span-2">
        <h1 className="font-titulo text-3xl text-texto">{mapa.sede.nombre}</h1>
        {!mapa.abierto ? (
          <p className="text-base font-semibold text-peligro">Cerrado</p>
        ) : (
          mapa.fecha_limite && (
            <p className="text-base text-texto-suave">
              Podés reservar o cambiar tus lugares hasta el {mostrarHora(mapa.fecha_limite)}
            </p>
          )
        )}
      </header>

      <div className="flex flex-col gap-2 lg:col-span-2">
        {falloCarga && (
          <Aviso
            mensaje="No pudimos actualizar la disponibilidad. Mostrando los últimos datos."
            tipo="info"
            onCerrar={() => setFalloCarga(false)}
          />
        )}
        <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
        {cambioPendienteId && sesion && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-advertencia bg-superficie-alta p-4"
          >
            <p className="text-base font-semibold text-texto">
              {`Tenés cambios sin confirmar en ${sesion.nombre}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Boton disabled={guardando} onClick={() => void confirmar(cambioPendienteId)}>
                Confirmar y cambiar
              </Boton>
              <Boton
                variante="secundario"
                onClick={() => {
                  setBorradores((prev) => {
                    const copia = { ...prev };
                    delete copia[sesion.id];
                    return copia;
                  });
                  setSesionId(cambioPendienteId);
                  setCambioPendienteId(null);
                  setSectorActivoId(null);
                }}
              >
                Descartar y cambiar
              </Boton>
              <Boton variante="fantasma" onClick={() => setCambioPendienteId(null)}>
                Seguir acá
              </Boton>
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="titulo-mapa" className="flex flex-col gap-3">
        <h2 id="titulo-mapa" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Mapa del salón
        </h2>
        {mapa.sesiones.length > 0 && (
          <div role="group" aria-label="Sesión" className="flex flex-wrap gap-2">
            {mapa.sesiones.map((s) => {
              const totalSesion = resumenSesion(borradores[s.id] ?? confirmadoDe(s)).totalLugares;
              const activa = s.id === sesion?.id;
              return (
                <Boton
                  key={s.id}
                  variante={activa ? 'primario' : 'secundario'}
                  aria-pressed={activa}
                  onClick={() => intentarCambiarSesion(s.id)}
                >
                  {totalSesion > 0 ? `${s.nombre} · ${totalSesion}` : s.nombre}
                </Boton>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SelectorZona valor={zona} onCambiar={setZona} />
          <button
            type="button"
            aria-pressed={soloDisponibles}
            onClick={() => setSoloDisponibles((v) => !v)}
            className={`inline-flex min-h-11 items-center rounded-2xl border px-3.5 text-sm font-semibold transition-colors ${
              soloDisponibles
                ? 'border-acento bg-acento/15 text-acento'
                : 'border-borde bg-superficie-alta text-texto-suave hover:text-texto'
            }`}
          >
            Solo disponibles
          </button>
        </div>
        <MapaSalon
          sectores={sectoresMapa}
          onAlternar={
            mapa.abierto && sesion
              ? (id) => {
                  setSectorActivoId(id);
                  setVistaPrevia(null);
                }
              : undefined
          }
          deshabilitado={!mapa.abierto}
          etiquetaAsignado="Tu reserva"
          leyenda={LEYENDA_RESERVA}
          permitirAsignado
          zona={zona}
          soloDisponibles={soloDisponibles}
        />
        <GuiaUso rol="sede" />
      </section>

      {esEscritorio && (
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6" aria-label="Resumen de reservas">
          {sectorActivo && mapa.abierto && (
            <section
              aria-labelledby="titulo-editor-sector"
              className="flex flex-col gap-3 rounded-2xl border border-acento bg-superficie p-5"
            >
              <h2 id="titulo-editor-sector" className="font-titulo text-xl text-texto">
                {sectorActivo.nombre}
              </h2>
              <EditorSector
                key={sectorActivo.id}
                sector={sectorActivo}
                cantidadActual={borrador[sectorActivo.id] ?? 0}
                onCambiar={(cant) => setVistaPrevia({ sectorId: sectorActivo.id, cantidad: cant })}
                onAplicar={(cant) => actualizarSector(sectorActivo.id, cant)}
                onCancelar={cerrarEditor}
              />
            </section>
          )}

          <section
            aria-labelledby="titulo-resumen-desktop"
            className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="titulo-resumen-desktop" className="font-titulo text-xl text-texto">
                {sesion ? `Tu reserva · ${sesion.nombre}` : 'Tu reserva'}
              </h2>
              <span className="text-sm font-semibold text-acento">
                {`${resumen.totalLugares} ${resumen.totalLugares === 1 ? 'lugar' : 'lugares'}`}
              </span>
            </div>
            {contenidoCarrito}
          </section>
        </aside>
      )}

      {!esEscritorio && sesion && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-borde bg-superficie/95 px-4 pt-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setDetalleAbierto(true)}
              className="flex min-h-11 flex-col items-start justify-center text-left"
            >
              <span className="text-base font-bold text-texto">
                {resumen.totalLugares === 0
                  ? 'Sin lugares elegidos'
                  : `${resumen.totalLugares} ${resumen.totalLugares === 1 ? 'lugar' : 'lugares'} · ${resumen.cantidadSectores} ${resumen.cantidadSectores === 1 ? 'sector' : 'sectores'}`}
              </span>
              <span className="text-xs font-semibold text-acento">
                {hayCambios ? 'Cambios sin confirmar · Ver detalle' : 'Ver detalle'}
              </span>
            </button>
            {mapa.abierto && (
              <Boton disabled={!hayCambios || guardando} onClick={() => void confirmar()}>
                {guardando ? 'Guardando…' : 'Confirmar'}
              </Boton>
            )}
          </div>
        </div>
      )}

      {!esEscritorio && (
        <Modal
          abierto={sectorActivo !== null && mapa.abierto}
          onCerrar={cerrarEditor}
          titulo={sectorActivo?.nombre ?? ''}
        >
          {sectorActivo && (
            <EditorSector
              key={sectorActivo.id}
              sector={sectorActivo}
              cantidadActual={borrador[sectorActivo.id] ?? 0}
              onCambiar={(cant) => setVistaPrevia({ sectorId: sectorActivo.id, cantidad: cant })}
              onAplicar={(cant) => actualizarSector(sectorActivo.id, cant)}
              onCancelar={cerrarEditor}
            />
          )}
        </Modal>
      )}

      {!esEscritorio && (
        <Modal
          abierto={detalleAbierto}
          onCerrar={() => setDetalleAbierto(false)}
          titulo={sesion ? `Tu reserva · ${sesion.nombre}` : 'Tu reserva'}
        >
          {contenidoCarrito}
        </Modal>
      )}
    </main>
  );
}
