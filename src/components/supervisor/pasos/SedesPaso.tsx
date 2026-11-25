'use client';

import { useCallback, useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { parsearEmailsSedesCsv, planillaATexto, type FilaEmailSede } from '@/lib/csv';
import { aLocalAr, deLocalAr } from '@/lib/fechas';
import { mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { CLASE_INPUT, CLASE_TITULO } from '../estilos';
import { leerMapa, type SedeServidor } from '../MapaSupervisor';
import { MarcoPaso } from '../MarcoPaso';
import { useRpcSupervisor } from '../useRpcSupervisor';
import { useSupervisor } from '../SupervisorShell';
import { usePreparacion } from '../usePreparacion';

const MAX_BYTES_PLANILLA = 2 * 1024 * 1024;

type VistaImportacion = {
  filas: FilaEmailSede[];
  total: number;
  sedesNuevas: string[];
  cambios: number;
  errores: string[];
};

function decodificar(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function textosErrores(res: unknown, linea?: (fila: number) => string): string[] | null {
  const lista = (res as { errores?: unknown }).errores;
  if (!Array.isArray(lista)) return null;
  return (lista as Array<{ fila: number; motivo: string }>).map((x) =>
    x.fila === 0 ? x.motivo : `${linea ? linea(x.fila) : `Fila ${x.fila}`}: ${x.motivo}`,
  );
}

function badgeEstadoSede(sede: SedeServidor): { texto: string; clases: string } {
  if (!sede.email_autorizado) {
    return { texto: 'Sin email', clases: 'border-borde bg-superficie-alta text-texto-suave' };
  }
  if (sede.cuenta_activa) {
    return { texto: 'Cuenta activa', clases: 'border-libre/50 bg-libre/15 text-libre' };
  }
  return { texto: 'Pendiente de activar', clases: 'border-acento/60 bg-acento/15 text-acento' };
}

export function SedesPaso() {
  const { claves } = useSupervisor();
  const { recargar } = usePreparacion();
  const { llamar, llamarOk, mensaje, setMensaje } = useRpcSupervisor(claves.claveSupervisor);
  const [fecha, setFecha] = useState('');
  const [sedes, setSedes] = useState<SedeServidor[]>([]);
  const [emailsEditados, setEmailsEditados] = useState<Record<string, string>>({});
  const [cargado, setCargado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [nuevaSede, setNuevaSede] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todas' | 'sin_email' | 'pendiente' | 'activa'>('todas');
  const [vista, setVista] = useState<VistaImportacion | null>(null);
  const [erroresCsv, setErroresCsv] = useState<string[]>([]);
  const idFecha = useId();
  const idBase = useId();
  const idArchivo = useId();

  /** Trae el mapa; la carga inicial llena también la fecha, las siguientes solo refrescan sedes sin pisar la fecha. */
  const cargar = useCallback(
    async (inicial: boolean) => {
      const res = await llamarOk('obtener_mapa_supervisor');
      if (!res) return;
      const mapa = leerMapa(res);
      setSedes(mapa.sedes);
      setEmailsEditados((prev) => {
        const next: Record<string, string> = {};
        for (const s of mapa.sedes) {
          next[s.sede_id] = inicial ? (s.email_autorizado ?? '') : (prev[s.sede_id] ?? s.email_autorizado ?? '');
        }
        return next;
      });
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

  const guardarEmail = (sede: SedeServidor, emailNuevo: string) =>
    accion(async () => {
      const res = await llamarOk('guardar_email_sede', { p_sede_id: sede.sede_id, p_email: emailNuevo });
      if (!res || !res.success) return;
      const guardado = typeof res.email === 'string' ? res.email : null;
      setSedes((ss) =>
        ss.map((s) =>
          s.sede_id === sede.sede_id
            ? { ...s, email_autorizado: guardado, cuenta_activa: guardado === s.email_autorizado ? s.cuenta_activa : false }
            : s,
        ),
      );
      setEmailsEditados((prev) => ({ ...prev, [sede.sede_id]: guardado ?? '' }));
      setMensaje({
        tipo: 'info',
        texto: guardado ? `Email de ${sede.nombre} guardado.` : `Se quitó el email autorizado de ${sede.nombre}.`,
      });
      recargar();
    });

  async function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    setVista(null);
    setErroresCsv([]);
    setMensaje(null);
    if (!archivo || ocupado) return;
    if (archivo.size > MAX_BYTES_PLANILLA) {
      setErroresCsv(['El archivo es demasiado grande (máximo 2 MB).']);
      return;
    }

    let texto: string;
    if (/\.xlsx$/i.test(archivo.name)) {
      try {
        const { readSheet } = await import('read-excel-file/universal');
        texto = planillaATexto(await readSheet(await archivo.arrayBuffer()));
      } catch {
        setErroresCsv(['No se pudo leer el Excel. Guardalo como .xlsx o exportalo como CSV.']);
        return;
      }
    } else {
      texto = decodificar(await archivo.arrayBuffer());
    }

    const { filas, lineas, errores } = parsearEmailsSedesCsv(texto);
    if (errores.length > 0) {
      setErroresCsv(errores.map((x) => `Línea ${x.linea}: ${x.motivo}`));
      return;
    }
    if (filas.length === 0) {
      setErroresCsv(['La planilla no tiene filas con sedes y emails.']);
      return;
    }

    setOcupado(true);
    try {
      const res = await llamar('importar_emails_sedes', { p_filas: filas, p_simular: true });
      if (!res) return;
      if (res.success) {
        const nuevas = Array.isArray(res.sedes_nuevas) ? (res.sedes_nuevas as string[]) : [];
        setVista({
          filas,
          total: Number(res.total ?? filas.length),
          sedesNuevas: nuevas,
          cambios: Number(res.cambios ?? 0),
          errores: [],
        });
      } else if (res.error === 'FILAS_INVALIDAS' && textosErrores(res)) {
        const errs = textosErrores(res, (n) => `Línea ${lineas[n - 1] ?? n}`) ?? [];
        setVista({ filas, total: 0, sedesNuevas: [], cambios: 0, errores: errs });
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
      const r = await llamarOk('importar_emails_sedes', { p_filas: filas, p_simular: false });
      if (!r) return;
      setVista(null);
      const resMapa = await llamarOk('obtener_mapa_supervisor');
      if (resMapa) {
        const mapa = leerMapa(resMapa);
        setSedes(mapa.sedes);
        const mapaEmails: Record<string, string> = {};
        for (const s of mapa.sedes) mapaEmails[s.sede_id] = s.email_autorizado ?? '';
        setEmailsEditados(mapaEmails);
      }
      setMensaje({ tipo: 'info', texto: 'Emails de sedes importados.' });
      recargar();
    });
  }

  const conEmail = sedes.filter((s) => Boolean(s.email_autorizado)).length;
  const activas = sedes.filter((s) => Boolean(s.email_autorizado && s.cuenta_activa)).length;
  const pctEmail = sedes.length === 0 ? 0 : Math.round((conEmail / sedes.length) * 100);
  const pctActivas = sedes.length === 0 ? 0 : Math.round((activas / sedes.length) * 100);

  const termino = busqueda.trim().toLowerCase();
  const sedesFiltradas = sedes.filter((s) => {
    if (termino && !s.nombre.toLowerCase().includes(termino) && !(s.email_autorizado ?? '').toLowerCase().includes(termino)) {
      return false;
    }
    if (filtroEstado === 'sin_email') return !s.email_autorizado;
    if (filtroEstado === 'pendiente') return Boolean(s.email_autorizado && !s.cuenta_activa);
    if (filtroEstado === 'activa') return Boolean(s.email_autorizado && s.cuenta_activa);
    return true;
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

      {cargado && sedes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-2xl border border-borde bg-superficie p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Total sedes</span>
            <span className="font-titulo text-2xl text-texto tabular-nums">{sedes.length}</span>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Con email</span>
            <span className="font-titulo text-2xl text-acento tabular-nums">{`${conEmail} / ${sedes.length}`}</span>
            <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-superficie-alta">
              <div className="h-full rounded-full bg-acento transition-[width] duration-300 ease-out" style={{ width: `${pctEmail}%` }} />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Cuentas activas</span>
            <span className="font-titulo text-2xl text-libre tabular-nums">{`${activas} / ${sedes.length}`}</span>
            <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-superficie-alta">
              <div className="h-full rounded-full bg-libre transition-[width] duration-300 ease-out" style={{ width: `${pctActivas}%` }} />
            </div>
          </div>
        </div>
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
            <p className="text-sm text-texto-suave">Hora de Argentina. Pasada esta fecha, las sedes ya no pueden cambiar sus reservas.</p>
          </div>
          <Boton type="submit" variante="secundario" disabled={ocupado}>
            Guardar
          </Boton>
          <Boton variante="fantasma" disabled={ocupado} onClick={() => void guardarFecha(null)}>
            Sin fecha límite
          </Boton>
        </form>
      </section>

      <section aria-labelledby={`${idBase}-importar`} className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
        <h2 id={`${idBase}-importar`} className={CLASE_TITULO}>
          Importar emails desde Excel o CSV
        </h2>
        <p className="text-sm text-texto-suave">
          Subí una planilla (.xlsx o .csv) con las columnas <strong className="text-texto">sede</strong> y <strong className="text-texto">email</strong>. Vas a ver una vista previa antes de aplicar.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={idArchivo} className="text-base text-texto">
            Planilla de sedes y emails
          </label>
          <input
            id={idArchivo}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={ocupado}
            onChange={(e) => void elegirArchivo(e)}
            className="min-h-11 w-full rounded-xl border border-borde bg-superficie-alta px-3 py-2 text-base text-texto file:mr-3 file:rounded-lg file:border-0 file:bg-acento file:px-3 file:py-1 file:text-sm file:font-semibold file:text-fondo"
          />
        </div>

        {erroresCsv.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 rounded-xl border border-peligro bg-superficie-alta p-3 text-sm text-texto">
            {erroresCsv.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        {vista && (
          <div className="flex flex-col gap-3 rounded-xl border border-acento/60 bg-fondo/70 p-4">
            {vista.errores.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-1 text-sm text-peligro">
                {vista.errores.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-base font-semibold text-texto">
                  {`Se van a guardar ${vista.total} ${vista.total === 1 ? 'email autorizado' : 'emails autorizados'}.`}
                </p>
                {vista.sedesNuevas.length > 0 && (
                  <p className="text-sm text-texto-suave">
                    {`Sedes nuevas a crear: ${vista.sedesNuevas.join(', ')}`}
                  </p>
                )}
                {vista.cambios > 0 && (
                  <p className="text-sm text-advertencia">
                    {`${vista.cambios} ${vista.cambios === 1 ? 'sede cambia' : 'sedes cambian'} de email (el correo anterior perderá acceso al instante).`}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Boton disabled={ocupado} onClick={confirmarImportacion}>
                    Confirmar importación
                  </Boton>
                  <Boton variante="fantasma" onClick={() => setVista(null)}>
                    Cancelar
                  </Boton>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby={`${idBase}-sedes`} className="flex flex-col gap-3">
        <h2 id={`${idBase}-sedes`} className={CLASE_TITULO}>
          Emails autorizados de las sedes
        </h2>
        <p className="text-sm text-texto-suave">
          Cada pastor entra en <code className="text-texto">/sede/ingresar</code> con su email autorizado, su contraseña y un código de 6 dígitos al correo.
        </p>

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

        {cargado && sedes.length === 0 && <p className="text-base text-texto-suave">Todavía no hay sedes. Agregalas acá o importalas desde Excel/CSV.</p>}

        {cargado && sedes.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="search"
              aria-label="Buscar sede o email"
              placeholder="Buscar sede o email…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className={`${CLASE_INPUT} sm:max-w-xs`}
            />
            <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
              {(
                [
                  ['todas', 'Todas'],
                  ['sin_email', 'Sin email'],
                  ['pendiente', 'Pendientes'],
                  ['activa', 'Activas'],
                ] as const
              ).map(([valorFiltro, textoFiltro]) => (
                <button
                  key={valorFiltro}
                  type="button"
                  aria-pressed={filtroEstado === valorFiltro}
                  onClick={() => setFiltroEstado(valorFiltro)}
                  className={`min-h-10 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                    filtroEstado === valorFiltro
                      ? 'border-acento bg-acento/15 text-acento'
                      : 'border-borde bg-superficie-alta text-texto-suave hover:text-texto'
                  }`}
                >
                  {textoFiltro}
                </button>
              ))}
            </div>
          </div>
        )}

        {cargado && sedes.length > 0 && sedesFiltradas.length === 0 && (
          <p className="text-sm text-texto-suave">Ninguna sede coincide con ese filtro.</p>
        )}

        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sedesFiltradas.map((s) => {
            const badge = badgeEstadoSede(s);
            const valor = emailsEditados[s.sede_id] ?? '';
            const sinCambios = valor.trim().toLowerCase() === (s.email_autorizado ?? '');
            return (
              <li key={s.sede_id} className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-titulo text-xl text-texto">{s.nombre}</p>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.clases}`}>
                    {badge.texto}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void guardarEmail(s, valor);
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor={`${idBase}-email-${s.sede_id}`} className="text-sm text-texto-suave">
                    {`Email autorizado de ${s.nombre}`}
                  </label>
                  <input
                    id={`${idBase}-email-${s.sede_id}`}
                    type="email"
                    autoComplete="off"
                    placeholder="pastor@ejemplo.com"
                    value={valor}
                    onChange={(e) => setEmailsEditados((prev) => ({ ...prev, [s.sede_id]: e.target.value }))}
                    className={CLASE_INPUT}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Boton type="submit" disabled={ocupado || sinCambios || valor.trim() === ''}>
                      Guardar email
                    </Boton>
                    {s.email_autorizado && (
                      <Boton
                        variante="fantasma"
                        disabled={ocupado}
                        onClick={() => void guardarEmail(s, '')}
                      >
                        Quitar acceso
                      </Boton>
                    )}
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </MarcoPaso>
  );
}
