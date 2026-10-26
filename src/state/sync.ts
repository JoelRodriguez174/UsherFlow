import { calcularOffset } from '@/domain/pendientes';
import type { Fila, Tramo } from '@/domain/types';
import {
  ClaveInvalidaError,
  filaDesdeServidor,
  llamarRpc,
  mensajeDeError,
  obtenerEstadoSalon,
  pendienteDesdeServidor,
  tramoDesdeServidor,
  type FilaCruda,
  type PendienteCrudo,
  type TramoCrudo,
} from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import {
  aplicarMutacion,
  revertir,
  type Mutacion,
  type Reversion,
  type SalonAction,
  type SalonState,
} from './salonReducer';

export { mensajeDeError } from '@/lib/rpc';

export type EstadoConexion = 'connected' | 'reconnecting' | 'offline';

/** `fueraDeSector`: nombres de los sectores asignados a la sede cuando se sentó fuera de ellos (aviso, no bloqueo). */
export interface ResultadoMutacion {
  ok: boolean;
  error?: string;
  fueraDeSector?: string[];
}

export interface SalonSync {
  iniciar(): Promise<void>;
  detener(): void;
  resync(): Promise<void>;
  ejecutar(m: Mutacion): Promise<ResultadoMutacion>;
}

export interface SalonSyncDeps {
  clave: string;
  getState(): SalonState;
  dispatch(a: SalonAction): void;
  onError(msg: string): void;
  onClaveInvalida(): void;
  onConexion(s: EstadoConexion): void;
}

/** Un cambio remoto sobre una fila con una mutación local en vuelo no se aplica: se difiere hasta el resync final (bug 4). */
export function decidirRemoto(filaId: number, enVuelo: ReadonlySet<number>): 'aplicar' | 'diferir' {
  return enVuelo.has(filaId) ? 'diferir' : 'aplicar';
}

/** Espera antes de resincronizar por eventos de realtime que no se pueden plegar localmente (ráfagas = un solo fetch). */
const DEBOUNCE_RESYNC_MS = 150;
const REINTENTO_BASE_MS = 2_000;
const REINTENTO_MAX_MS = 15_000;

interface CambioRealtime {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

function rpcDeMutacion(clave: string, m: Mutacion): { nombre: string; params: Record<string, unknown> } {
  switch (m.tipo) {
    case 'mandar':
      return {
        nombre: 'mandar_grupo',
        params: { p_clave: clave, p_seccion: m.seccion, p_cantidad: m.cantidad, p_sede: m.sedeId },
      };
    case 'sentar':
      return {
        nombre: 'sentar_pendiente',
        params: { p_clave: clave, p_pendiente_id: m.pendienteId, p_tramo_id: m.tramoId },
      };
    case 'noLlegaron':
      return { nombre: 'cancelar_pendiente', params: { p_clave: clave, p_pendiente_id: m.pendienteId } };
    case 'seLevanto':
      return { nombre: 'se_levanto', params: { p_clave: clave, p_tramo_id: m.tramoId } };
    case 'corregir':
      return {
        nombre: 'corregir_conteo',
        params: { p_clave: clave, p_tramo_id: m.tramoId, p_libres_vistos: m.libresVistos },
      };
    case 'juntar':
      return { nombre: 'juntar_fila', params: { p_clave: clave, p_fila_id: m.filaId } };
  }
}

function incrementar<K>(mapa: Map<K, number>, k: K): void {
  mapa.set(k, (mapa.get(k) ?? 0) + 1);
}
function decrementar<K>(mapa: Map<K, number>, k: K): void {
  const n = (mapa.get(k) ?? 0) - 1;
  if (n <= 0) mapa.delete(k);
  else mapa.set(k, n);
}

/**
 * Capa de sincronización: carga el estado, mantiene el realtime, ejecuta mutaciones optimistas
 * y repara divergencias con `resync`.
 *
 * Realtime sobre `tramo`: cada cambio de tramo se pliega en su fila local (se reemplaza/inserta/quita
 * ese tramo y se despacha `filaRemota`), sin ir a la red; solo si la fila es desconocida se hace un
 * resync completo con debounce. Evita que cada acción de cualquier ujier dispare un fetch en todos los clientes.
 */
export function crearSalonSync(deps: SalonSyncDeps): SalonSync {
  const { clave, getState, dispatch, onError, onClaveInvalida, onConexion } = deps;

  const filasEnVuelo = new Map<number, number>();
  const pendientesEnVuelo = new Map<string, number>();
  let mandarEnVuelo = 0;
  let totalEnVuelo = 0;
  let mutacionesIniciadas = 0;

  let resyncPendiente = false; // hay que resincronizar apenas no haya mutaciones en vuelo
  let enCurso: Promise<void> | null = null;
  let repetir = false;
  let reintentos = 0;

  let cargado = false;
  let eventoPrevioACarga = false;
  let eventoId: string | null = null;
  let detenido = false;
  let claveInvalida = false;
  let iniciado = false;
  let huboCaida = false;
  let ultimaConexion: EstadoConexion | null = null;

  let canal: ReturnType<typeof supabase.channel> | null = null;
  let timerDebounce: ReturnType<typeof setTimeout> | null = null;
  let timerReintento: ReturnType<typeof setTimeout> | null = null;
  let quitarListeners: (() => void) | null = null;

  const inactivo = () => detenido || claveInvalida;

  function emitirConexion(s: EstadoConexion): void {
    ultimaConexion = s;
    onConexion(s);
  }
  const filasEnVueloSet = (): ReadonlySet<number> => new Set(filasEnVuelo.keys());

  // ------------------------------------------------------------------ resync

  type Ronda = 'ok' | 'descartada' | 'error' | 'abortada';

  async function traerUna(): Promise<Ronda> {
    const generacion = mutacionesIniciadas;
    const t0 = Date.now();
    let resultado;
    try {
      resultado = await obtenerEstadoSalon(clave);
    } catch (e) {
      if (e instanceof ClaveInvalidaError) {
        alertarClaveInvalida();
        return 'abortada';
      }
      return 'error';
    }
    if (inactivo()) return 'abortada';
    const t1 = Date.now();
    // Si arrancó una mutación mientras viajaba la respuesta, el snapshot puede ser anterior a ella: se descarta.
    if (generacion !== mutacionesIniciadas || totalEnVuelo > 0) return 'descartada';
    eventoId = resultado.eventoId;
    dispatch({
      type: 'cargar',
      estado: resultado.estado,
      offsetMs: calcularOffset(resultado.estado.serverNow, t0, t1),
    });
    cargado = true;
    if (eventoPrevioACarga) {
      // llegaron eventos de realtime antes de tener estado: pudieron quedar fuera del snapshot
      eventoPrevioACarga = false;
      repetir = true;
    }
    return 'ok';
  }

  function programarReintento(): void {
    if (inactivo() || timerReintento) return;
    const espera = Math.min(REINTENTO_BASE_MS * 2 ** reintentos, REINTENTO_MAX_MS);
    reintentos += 1;
    timerReintento = setTimeout(() => {
      timerReintento = null;
      void resync();
    }, espera);
  }

  function resync(): Promise<void> {
    if (inactivo()) return Promise.resolve();
    // Nunca se pisa el estado optimista: con mutaciones en vuelo se difiere hasta que terminen.
    if (totalEnVuelo > 0) {
      resyncPendiente = true;
      return Promise.resolve();
    }
    if (enCurso) {
      repetir = true;
      return enCurso;
    }
    enCurso = (async () => {
      try {
        do {
          repetir = false;
          if (totalEnVuelo > 0) {
            resyncPendiente = true;
            break;
          }
          const ronda = await traerUna();
          if (ronda === 'descartada') repetir = true;
          else if (ronda === 'error') {
            emitirConexion('reconnecting');
            programarReintento();
          } else if (ronda === 'ok') {
            reintentos = 0;
            // Un resync exitoso prueba que hay red: se restaura 'connected' (p. ej. tras offline/online del navegador).
            if (ultimaConexion !== null && ultimaConexion !== 'connected') emitirConexion('connected');
          }
        } while (repetir && !inactivo());
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  }

  function resyncConDebounce(): void {
    if (inactivo()) return;
    if (timerDebounce) clearTimeout(timerDebounce);
    timerDebounce = setTimeout(() => {
      timerDebounce = null;
      void resync();
    }, DEBOUNCE_RESYNC_MS);
  }

  async function drenar(): Promise<void> {
    if (totalEnVuelo === 0 && resyncPendiente && !claveInvalida) {
      resyncPendiente = false;
      await resync();
    }
  }

  // --------------------------------------------------------------- clave / cierre

  function limpiar(): void {
    if (timerDebounce) clearTimeout(timerDebounce);
    if (timerReintento) clearTimeout(timerReintento);
    timerDebounce = null;
    timerReintento = null;
    quitarListeners?.();
    quitarListeners = null;
    if (canal) {
      const c = canal;
      canal = null;
      void supabase.removeChannel(c);
    }
  }

  /** Review Focus 5: una sola notificación, se corta el realtime y no se reintenta nada más. */
  function alertarClaveInvalida(): void {
    if (claveInvalida) return;
    claveInvalida = true;
    resyncPendiente = false;
    limpiar();
    onClaveInvalida();
  }

  // -------------------------------------------------------------------- realtime

  const ajeno = (row: Record<string, unknown>) =>
    eventoId !== null && typeof row.evento_id === 'string' && row.evento_id !== eventoId;

  /** Antes de la primera carga no hay estado sobre el cual plegar: se recuerda para re-sincronizar al cargar. */
  function sinCargar(): boolean {
    if (cargado) return false;
    eventoPrevioACarga = true;
    return true;
  }

  function buscarFilaDeTramo(tramoId: number): Fila | null {
    for (const f of Object.values(getState().filas)) {
      if (f.tramos.some((t) => t.id === tramoId)) return f;
    }
    return null;
  }

  function onFila(p: CambioRealtime): void {
    if (inactivo() || sinCargar()) return;
    if (p.eventType === 'DELETE') {
      const id = p.old.id as number;
      if (decidirRemoto(id, filasEnVueloSet()) === 'diferir') {
        resyncPendiente = true;
        return;
      }
      dispatch({ type: 'filaEliminada', filaId: id });
      return;
    }
    const row = p.new as unknown as FilaCruda & Record<string, unknown>;
    if (ajeno(row)) return;
    if (decidirRemoto(row.id, filasEnVueloSet()) === 'diferir') {
      resyncPendiente = true;
      return;
    }
    const existente = getState().filas[row.id];
    if (!existente) {
      resyncConDebounce(); // fila nueva: sus tramos llegan por separado, se trae todo junto
      return;
    }
    const nueva = filaDesdeServidor({ ...row, tramos: undefined });
    dispatch({ type: 'filaRemota', fila: { ...nueva, tramos: existente.tramos } });
  }

  function onTramo(p: CambioRealtime): void {
    if (inactivo() || sinCargar()) return;
    const tramoId = (p.eventType === 'DELETE' ? p.old.id : p.new.id) as number;
    const filaId = (p.eventType === 'DELETE' ? undefined : (p.new.fila_id as number | undefined)) ?? buscarFilaDeTramo(tramoId)?.id;
    if (p.eventType !== 'DELETE' && ajeno(p.new)) return;
    if (filaId === undefined) {
      // tramo borrado que no tenemos, o insertado sin fila conocida
      if (p.eventType !== 'DELETE') resyncConDebounce();
      return;
    }
    if (decidirRemoto(filaId, filasEnVueloSet()) === 'diferir') {
      resyncPendiente = true;
      return;
    }
    const fila = getState().filas[filaId];
    if (!fila) {
      resyncConDebounce();
      return;
    }
    let tramos: Tramo[];
    if (p.eventType === 'DELETE') {
      tramos = fila.tramos.filter((t) => t.id !== tramoId);
    } else {
      const nuevo = tramoDesdeServidor(p.new as unknown as TramoCrudo);
      const resto = fila.tramos.filter((t) => t.id !== nuevo.id);
      tramos = [...resto, nuevo].sort((a, b) => a.orden - b.orden);
    }
    dispatch({ type: 'filaRemota', fila: { ...fila, tramos } });
  }

  function onPendiente(p: CambioRealtime): void {
    if (inactivo() || sinCargar()) return;
    if (p.eventType === 'DELETE') {
      dispatch({ type: 'pendienteQuitado', pendienteId: p.old.id as string });
      return;
    }
    const row = p.new as unknown as PendienteCrudo & Record<string, unknown>;
    if (ajeno(row)) return;
    if (row.estado === 'sentado' && row.sede_id) resyncConDebounce(); // cambia `sentados` de la reserva
    if (row.estado !== undefined && row.estado !== 'pendiente') {
      // El servidor resuelve por UPDATE ('sentado' / 'cancelado'), nunca por DELETE: es una baja, no un alta.
      if (pendientesEnVuelo.has(row.id)) resyncPendiente = true; // lo estamos resolviendo nosotros: que lo asiente el resync
      else dispatch({ type: 'pendienteQuitado', pendienteId: row.id });
      return;
    }
    // Un pendiente que estamos resolviendo, o el insert real de un `mandar` que vuela, se reconcilian con el resync final.
    if (pendientesEnVuelo.has(row.id) || mandarEnVuelo > 0) {
      resyncPendiente = true;
      return;
    }
    dispatch({ type: 'pendienteRemoto', pendiente: pendienteDesdeServidor(row) });
  }

  function onReservaOSesion(): void {
    if (inactivo() || sinCargar()) return;
    resyncConDebounce();
  }

  function conectar(): void {
    const nombre = `salon-${Math.random().toString(36).slice(2, 10)}`;
    const cambio = (fn: (p: CambioRealtime) => void) => (p: unknown) => fn(p as CambioRealtime);
    canal = supabase
      .channel(nombre)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fila' }, cambio(onFila))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tramo' }, cambio(onTramo))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pendiente' }, cambio(onPendiente))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sesion' }, cambio(onReservaOSesion))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sector' }, cambio(onReservaOSesion))
      .subscribe((status: string) => {
        if (inactivo()) return;
        if (status === 'SUBSCRIBED') {
          emitirConexion('connected');
          if (huboCaida) {
            huboCaida = false;
            void resync(); // pudimos perder eventos mientras el canal estaba caído
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          huboCaida = true;
          emitirConexion('reconnecting');
        } else if (status === 'CLOSED') {
          huboCaida = true;
          emitirConexion('offline');
        }
      });
  }

  function escucharNavegador(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const alVolver = () => {
      if (document.visibilityState !== 'hidden') void resync();
    };
    const alOnline = () => void resync();
    const alOffline = () => {
      if (!inactivo()) emitirConexion('offline');
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', alOnline);
    window.addEventListener('offline', alOffline);
    quitarListeners = () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', alOnline);
      window.removeEventListener('offline', alOffline);
    };
  }

  // ------------------------------------------------------------------- mutaciones

  function marcar(r: Reversion, m: Mutacion): { filas: number[]; pendientes: string[]; esMandar: boolean } {
    const filas = r.filas.map((f) => f.id);
    const pendientes = m.tipo === 'mandar' ? [] : r.pendientes.map((p) => p.id);
    for (const id of filas) incrementar(filasEnVuelo, id);
    for (const id of pendientes) incrementar(pendientesEnVuelo, id);
    const esMandar = m.tipo === 'mandar';
    if (esMandar) mandarEnVuelo += 1;
    totalEnVuelo += 1;
    mutacionesIniciadas += 1;
    return { filas, pendientes, esMandar };
  }

  function soltar(t: { filas: number[]; pendientes: string[]; esMandar: boolean }): void {
    for (const id of t.filas) decrementar(filasEnVuelo, id);
    for (const id of t.pendientes) decrementar(pendientesEnVuelo, id);
    if (t.esMandar) mandarEnVuelo -= 1;
    totalEnVuelo -= 1;
  }

  async function ejecutar(m: Mutacion): Promise<ResultadoMutacion> {
    if (inactivo()) return { ok: false, error: claveInvalida ? 'CLAVE_INVALIDA' : 'DETENIDO' };

    const sentandoConSede = m.tipo === 'sentar' && !!getState().pendientes[m.pendienteId]?.sedeId;
    const aplicada = aplicarMutacion(getState(), m);
    if (!aplicada.ok) {
      // El estado local pudo quedar viejo (p. ej. un evento perdido): se avisa y se repara.
      onError(mensajeDeError(aplicada.error));
      resyncPendiente = true;
      await drenar();
      return { ok: false, error: aplicada.error };
    }

    dispatch({ type: 'reemplazar', state: aplicada.state });
    const marca = marcar(aplicada.reversion, m);
    const deshacer = () => dispatch({ type: 'reemplazar', state: revertir(getState(), aplicada.reversion) });

    let resultado: ResultadoMutacion;
    let pedirResync = false;
    try {
      const { nombre, params } = rpcDeMutacion(clave, m);
      const res = await llamarRpc(nombre, params);
      if (res.success) {
        resultado = { ok: true };
        // La marca la calcula el servidor (sentar_pendiente); el cliente solo la transmite.
        if (res.fuera_de_sector === true) {
          resultado.fueraDeSector = Array.isArray(res.sectores) ? res.sectores.filter((x): x is string => typeof x === 'string') : [];
        }
        // `mandar`: el pendiente temporal se reemplaza por el real que trae el resync (ruling 1)
        pedirResync = m.tipo === 'mandar' || sentandoConSede; // sentar con sede: cambia `sentados` de la reserva
      } else {
        const codigo = String(res.error);
        deshacer();
        onError(mensajeDeError(codigo));
        resultado = { ok: false, error: codigo };
        pedirResync = true; // la reversión restaura la fila entera: el resync repara cambios remotos que pudo pisar (ruling 2)
      }
    } catch (e) {
      deshacer();
      if (e instanceof ClaveInvalidaError) {
        alertarClaveInvalida();
        resultado = { ok: false, error: 'CLAVE_INVALIDA' };
      } else {
        onError(mensajeDeError('ERROR_DE_RED'));
        resultado = { ok: false, error: 'ERROR_DE_RED' };
        pedirResync = true;
      }
    } finally {
      soltar(marca);
    }

    if (pedirResync && !claveInvalida) resyncPendiente = true;
    await drenar();
    return resultado;
  }

  // ------------------------------------------------------------------------ API

  return {
    async iniciar() {
      if (iniciado || detenido) return;
      iniciado = true;
      conectar();
      escucharNavegador();
      await resync();
    },
    detener() {
      detenido = true;
      limpiar();
    },
    resync,
    ejecutar,
  };
}
