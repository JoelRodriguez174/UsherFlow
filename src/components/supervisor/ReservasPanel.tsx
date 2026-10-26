'use client';

import { useCallback, useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { SECCIONES, type Seccion } from '@/domain/types';
import { parsearReservasCsv, planillaATexto, type FilaReserva } from '@/lib/csv';
import { ClaveInvalidaError, llamarRpc, mensajeDeError, type ResultadoRpc } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';

type ReservaServidor = { sede: string; seccion: Seccion; cantidad: number; sector?: string | null };
type SectorServidor = { id: number; seccion: Seccion; nombre: string };
type Sesion = { id: string; nombre: string; inicio_at: string; reservas: ReservaServidor[] };
type Mensaje = { tipo: 'info' | 'error'; texto: string } | null;
/** Resultado de simular una importación: o bien errores por fila del servidor, o bien el resumen. */
type Vista = { filas: FilaReserva[]; sedesNuevas: string[]; reservas: number; errores: string[] };

const ZONA = 'America/Argentina/Buenos_Aires';
const CLASE_INPUT =
  'min-h-11 w-full rounded-xl border border-borde bg-superficie-alta px-3 text-base text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento';
const CLASE_TITULO = 'text-sm font-semibold uppercase tracking-wider text-texto-suave';

// Argentina es UTC-3 todo el año (sin horario de verano): se convierte explícito, sin depender del navegador.
const deLocalAr = (v: string) => `${v}:00-03:00`;
const mostrarHora = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(iso));

/** Errores por fila del servidor -> texto. `fila` 0 es un error global (sin fila). `linea` traduce a línea de archivo. */
function textosErrores(res: unknown, linea?: (fila: number) => string): string[] | null {
  const lista = (res as { errores?: unknown }).errores;
  if (!Array.isArray(lista)) return null;
  return (lista as Array<{ fila: number; motivo: string }>).map((x) =>
    x.fila === 0 ? x.motivo : `${linea ? linea(x.fila) : `Fila ${x.fila}`}: ${x.motivo}`,
  );
}

/**
 * `version`: al cambiar vuelve a pedir los datos al servidor (sin remontar, para no perder lo que se está editando).
 * `onCambio`: se llama tras cualquier acción que escribió bien (importar, guardar, borrar), para refrescar los paneles hermanos.
 */
export function ReservasPanel({ clave, version = 0, onCambio }: { clave: string; version?: number; onCambio?: () => void }) {
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [sectores, setSectores] = useState<SectorServidor[]>([]);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState('');
  const [liberacion, setLiberacion] = useState('');
  const [aBorrar, setABorrar] = useState<Sesion | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [erroresCsv, setErroresCsv] = useState<string[]>([]);
  const idNombre = useId();
  const idInicio = useId();
  const idLiberacion = useId();
  const idCsv = useId();

  const avisarFallo = (e: unknown) =>
    setMensaje({ tipo: 'error', texto: mensajeDeError(e instanceof ClaveInvalidaError ? 'CLAVE_INVALIDA' : 'ERROR_DE_RED') });

  /** Llama como supervisor. Devuelve la respuesta (también la de error de negocio) o null si falló la red. */
  const llamar = useCallback(
    async (rpc: string, params: Record<string, unknown> = {}): Promise<ResultadoRpc | null> => {
      try {
        return await llamarRpc(rpc, { p_clave: clave, ...params });
      } catch (e) {
        avisarFallo(e);
        return null;
      }
    },
    [clave],
  );

  /** Como `llamar`, pero un `success:false` deja el aviso de error y devuelve null. */
  const llamarOk = useCallback(
    async (rpc: string, params: Record<string, unknown> = {}) => {
      const res = await llamar(rpc, params);
      if (res && !res.success) {
        setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
        return null;
      }
      return res;
    },
    [llamar],
  );

  const recargar = useCallback(async () => {
    const res = await llamarOk('obtener_reservas');
    if (res?.success && Array.isArray(res.sesiones) && typeof res.liberacion_min === 'number') {
      setSesiones(res.sesiones as Sesion[]);
      setSectores(Array.isArray(res.sectores) ? (res.sectores as SectorServidor[]) : []);
      setLiberacion(String(res.liberacion_min));
    }
  }, [llamarOk]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void recargar();
  }, [recargar, version]);

  /** Bloquea los botones mientras corre; si salió bien, recarga y avisa. */
  async function accion(hacer: () => Promise<ResultadoRpc | null>, exito: string) {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    try {
      if (await hacer()) {
        await recargar();
        onCambio?.();
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

  const guardarTabla = (sesion: Sesion, filas: FilaReserva[]) => {
    // Con p_sesiones, una tabla vacía borra las reservas de la sesión.
    void accion(async () => {
      const res = await llamar('importar_reservas', { p_filas: filas, p_simular: false, p_sesiones: [sesion.nombre] });
      if (res && !res.success) {
        const detalle = res.error === 'RESERVAS_INVALIDAS' ? textosErrores(res) : null;
        setMensaje({ tipo: 'error', texto: detalle ? `${mensajeDeError('RESERVAS_INVALIDAS')} ${detalle.join(' · ')}` : mensajeDeError(String(res.error)) });
        return null;
      }
      return res;
    }, 'Reservas guardadas.');
  };

  // Excel en español guarda en windows-1252: si no es UTF-8 válido se decodifica así.
  function decodificar(bytes: ArrayBuffer): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  async function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    setVista(null);
    setErroresCsv([]);
    setMensaje(null);
    if (!archivo || ocupado) return;
    let texto: string;
    if (/\.xlsx$/i.test(archivo.name)) {
      try {
        const { readSheet } = await import('read-excel-file/universal');
        texto = planillaATexto(await readSheet(await archivo.arrayBuffer()));
      } catch {
        setErroresCsv(['No se pudo leer el Excel. Guardalo como .xlsx o exportalo como CSV.']);
        return;
      }
    } else texto = decodificar(await archivo.arrayBuffer());
    const { filas, lineas, errores } = parsearReservasCsv(texto);
    if (errores.length > 0) {
      setErroresCsv(errores.map((x) => `Línea ${x.linea}: ${x.motivo}`));
      return;
    }
    setOcupado(true);
    try {
      const res = await llamar('importar_reservas', { p_filas: filas, p_simular: true });
      if (!res) return;
      if (res.success) {
        const nuevas = Array.isArray(res.sedes_nuevas) ? (res.sedes_nuevas as string[]) : [];
        setVista({ filas, sedesNuevas: nuevas, reservas: Number(res.reservas ?? filas.length), errores: [] });
      } else if (res.error === 'RESERVAS_INVALIDAS' && textosErrores(res)) {
        const errs = textosErrores(res, (n) => `Línea ${lineas[n - 1] ?? n}`) ?? [];
        setVista({ filas, sedesNuevas: [], reservas: 0, errores: errs });
      } else {
        setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
      }
    } finally {
      setOcupado(false);
    }
  }

  function confirmarImportacion() {
    if (!vista) return;
    const { filas } = vista;
    void accion(async () => {
      const r = await llamarOk('importar_reservas', { p_filas: filas, p_simular: false });
      if (r) setVista(null);
      return r;
    }, 'Importación hecha.');
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-8">
      <h2 className="font-titulo text-xl text-texto">Sesiones y reservas</h2>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {sesiones === null && mensaje === null && (
        <p role="status" className="text-base text-texto-suave">
          Cargando…
        </p>
      )}

      <section aria-labelledby="res-sesiones" className="flex flex-col gap-3">
        <h3 id="res-sesiones" className={CLASE_TITULO}>
          Sesiones
        </h3>
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

      <section aria-labelledby="res-liberacion" className="flex flex-col gap-3">
        <h3 id="res-liberacion" className={CLASE_TITULO}>
          Liberación
        </h3>
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

      <section aria-labelledby="res-reservas" className="flex flex-col gap-4">
        <h3 id="res-reservas" className={CLASE_TITULO}>
          Reservas por sesión
        </h3>
        {sesiones?.map((s) => (
          // key con las reservas del servidor: tras guardar o importar, la tabla se reinicia con lo guardado.
          <TablaSesion key={`${s.id}${JSON.stringify(s.reservas)}`} sesion={s} sectores={sectores} ocupado={ocupado} onGuardar={guardarTabla} />
        ))}
      </section>

      <section aria-labelledby="res-csv" className="flex flex-col gap-3">
        <h3 id="res-csv" className={CLASE_TITULO}>
          Importar desde Excel o CSV
        </h3>
        <p className="text-base text-texto-suave">Columnas: sede, seccion, sesion, cantidad y, si querés, sector (vacío = toda la sección). Reemplaza las reservas de las sesiones que aparezcan. En Excel se lee la primera hoja.</p>
        <div className="flex flex-col gap-1">
          <label htmlFor={idCsv} className="text-base text-texto">
            Archivo Excel o CSV
          </label>
          <input id={idCsv} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={elegirArchivo} disabled={ocupado} className={CLASE_INPUT} />
        </div>
        {erroresCsv.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 rounded-2xl border border-peligro bg-superficie-alta p-3 text-base text-texto">
            {erroresCsv.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        {vista && (
          <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie-alta p-3 text-base text-texto">
            {vista.errores.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-1">
                {vista.errores.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <>
                <p>{`Reservas a guardar: ${vista.reservas}`}</p>
                <p>{`Sedes nuevas: ${vista.sedesNuevas.length > 0 ? vista.sedesNuevas.join(', ') : 'ninguna'}`}</p>
                <VistaPrevia filas={vista.filas} />
                <Boton onClick={confirmarImportacion} disabled={ocupado}>
                  Confirmar importación
                </Boton>
              </>
            )}
          </div>
        )}
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
    </div>
  );
}

/** Filas del archivo que se van a guardar; la columna Sector aparece solo si alguna fila la trae. */
function VistaPrevia({ filas }: { filas: FilaReserva[] }) {
  const conSector = filas.some((f) => f.sector);
  return (
    <div className="max-h-64 overflow-auto">
      <table aria-label="Vista previa de la importación" className="w-full text-left text-sm">
        <thead className="text-texto-suave">
          <tr>
            <th scope="col" className="font-normal">Sede</th>
            <th scope="col" className="font-normal">Sección</th>
            <th scope="col" className="font-normal">Sesión</th>
            {conSector && <th scope="col" className="font-normal">Sector</th>}
            <th scope="col" className="font-normal">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              <td className="pr-2">{f.sede}</td>
              <td className="pr-2">{f.seccion}</td>
              <td className="pr-2">{f.sesion}</td>
              {conSector && <td className="pr-2">{f.sector ?? ''}</td>}
              <td>{f.cantidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FilaEditable = { sede: string; seccion: Seccion; cantidad: string; sector: string };

type TablaSesionProps = { sesion: Sesion; sectores: SectorServidor[]; ocupado: boolean; onGuardar(sesion: Sesion, filas: FilaReserva[]): void };

function TablaSesion({ sesion, sectores, ocupado, onGuardar }: TablaSesionProps) {
  const [filas, setFilas] = useState<FilaEditable[]>(() =>
    sesion.reservas.map((r) => ({ sede: r.sede, seccion: r.seccion, cantidad: String(r.cantidad), sector: r.sector ?? '' })),
  );
  const cambiar = (i: number, cambio: Partial<FilaEditable>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const guardar = () =>
    onGuardar(
      sesion,
      filas.map((f) => ({
        sede: f.sede.trim(),
        seccion: f.seccion,
        sesion: sesion.nombre,
        cantidad: Number(f.cantidad),
        ...(f.sector ? { sector: f.sector } : {}),
      })),
    );

  const conSectores = sectores.length > 0;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-borde p-3">
      <h4 className="text-base font-semibold text-texto">{sesion.nombre}</h4>
      <table aria-label={`Reservas de ${sesion.nombre}`} className="w-full border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-sm text-texto-suave">
            <th scope="col" className="font-normal">
              Sede
            </th>
            <th scope="col" className="font-normal">
              Sección
            </th>
            {conSectores && (
              <th scope="col" className="font-normal">
                Sector
              </th>
            )}
            <th scope="col" className="font-normal">
              Cantidad
            </th>
            <th scope="col" className="sr-only">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              <td className="pr-1">
                <input aria-label={`Sede, fila ${i + 1}`} type="text" value={f.sede} onChange={(e) => cambiar(i, { sede: e.target.value })} autoComplete="off" className={CLASE_INPUT} />
              </td>
              <td className="pr-1">
                <select aria-label={`Sección, fila ${i + 1}`} value={f.seccion} onChange={(e) => cambiar(i, { seccion: e.target.value as Seccion, sector: '' })} className={CLASE_INPUT}>
                  {SECCIONES.map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </td>
              {conSectores && (
                <td className="pr-1">
                  <select aria-label={`Sector, fila ${i + 1}`} value={f.sector} onChange={(e) => cambiar(i, { sector: e.target.value })} className={CLASE_INPUT}>
                    <option value="">Toda la sección</option>
                    {sectores
                      .filter((x) => x.seccion === f.seccion)
                      .map((x) => (
                        <option key={x.id} value={x.nombre}>
                          {x.nombre}
                        </option>
                      ))}
                  </select>
                </td>
              )}
              <td className="pr-1">
                <input aria-label={`Cantidad, fila ${i + 1}`} type="number" inputMode="numeric" min={1} step={1} value={f.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className={CLASE_INPUT} />
              </td>
              <td>
                <Boton variante="fantasma" etiqueta={`Quitar fila ${i + 1}`} onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}>
                  Quitar
                </Boton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-2">
        <Boton variante="secundario" onClick={() => setFilas((fs) => [...fs, { sede: '', seccion: 'centro', cantidad: '', sector: '' }])}>
          Agregar fila
        </Boton>
        <Boton onClick={guardar} disabled={ocupado}>
          Guardar reservas
        </Boton>
      </div>
    </div>
  );
}
