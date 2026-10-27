'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { SECCIONES, type Seccion } from '@/domain/types';
import { ClaveInvalidaError, llamarRpc, mensajeDeError } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { CLASE_INPUT } from '@/components/supervisor/estilos';

type SectorLista = { id: number; seccion: Seccion; nombre: string };
type Reserva = { seccion: Seccion; cantidad: number; sector?: string };
type Sesion = { id: string; nombre: string; reservas: Reserva[] };
type FilaEditable = { seccion: Seccion; sector: string; cantidad: string };
type Mensaje = { tipo: 'error' | 'info'; texto: string };

type Props = {
  clave: string;
  sectores: SectorLista[];
  abierto: boolean;
  onGuardado(): void;
  onClaveInvalida(): void;
};

const mayuscula = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Errores por fila del servidor -> texto. `fila` 0 es un error global. */
function textosErrores(res: Record<string, unknown>): string {
  const lista = Array.isArray(res.errores) ? (res.errores as Array<{ fila: number; motivo: string }>) : [];
  return lista.map((x) => (x.fila === 0 ? x.motivo : `Fila ${x.fila}: ${x.motivo}`)).join(' · ');
}

/** El pastor carga las reservas de SU sede por sesión; el supervisor las ve en su paso Reservas. */
export function ReservasSede({ clave, sectores, abierto, onGuardado, onClaveInvalida }: Props) {
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await llamarRpc('obtener_reservas_sede', { p_clave: clave });
      if (res.success && Array.isArray(res.sesiones)) setSesiones(res.sesiones as Sesion[]);
    } catch (e) {
      if (e instanceof ClaveInvalidaError) onClaveInvalida();
      // otro fallo: la tabla no aparece y no se muestra una vacía que se pueda guardar encima de lo real
    }
  }, [clave, onClaveInvalida]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void cargar();
  }, [cargar]);

  async function guardar(sesion: Sesion, filas: FilaEditable[]) {
    if (ocupado) return;
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await llamarRpc('guardar_reservas_sede', {
        p_clave: clave,
        p_filas: filas.map((f) => ({
          seccion: f.seccion,
          sesion: sesion.nombre,
          cantidad: Number(f.cantidad),
          ...(f.sector ? { sector: f.sector } : {}),
        })),
        p_sesiones: [sesion.nombre],
      });
      if (res.success) {
        await cargar();
        onGuardado();
        setMensaje({ tipo: 'info', texto: `Reservas de ${sesion.nombre} guardadas.` });
      } else {
        const detalle = res.error === 'RESERVAS_INVALIDAS' ? textosErrores(res) : '';
        setMensaje({ tipo: 'error', texto: [mensajeDeError(String(res.error)), detalle].filter(Boolean).join(' ') });
      }
    } catch (e) {
      if (e instanceof ClaveInvalidaError) onClaveInvalida();
      else setMensaje({ tipo: 'error', texto: mensajeDeError('ERROR_DE_RED') });
    } finally {
      setOcupado(false);
    }
  }

  if (sesiones === null) return null;

  return (
    <section aria-labelledby="titulo-reservas" className="flex flex-col gap-3">
      <h2 id="titulo-reservas" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
        Mis reservas
      </h2>
      <p className="text-base text-texto-suave">Cargá cuántas personas de tu sede van a cada sección en cada sesión.</p>
      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />
      {sesiones.length === 0 && <p className="text-base text-texto-suave">Todavía no hay sesiones cargadas.</p>}
      {sesiones.map((s) => (
        // key con lo guardado: tras guardar, la tabla se reinicia con lo del servidor.
        <TablaSesion
          key={`${s.id}${JSON.stringify(s.reservas)}`}
          sesion={s}
          sectores={sectores}
          deshabilitado={!abierto || ocupado}
          onGuardar={guardar}
        />
      ))}
    </section>
  );
}

type TablaProps = {
  sesion: Sesion;
  sectores: SectorLista[];
  deshabilitado: boolean;
  onGuardar(sesion: Sesion, filas: FilaEditable[]): void;
};

function TablaSesion({ sesion, sectores, deshabilitado, onGuardar }: TablaProps) {
  const id = useId();
  const [filas, setFilas] = useState<FilaEditable[]>(() =>
    sesion.reservas.map((r) => ({ seccion: r.seccion, sector: r.sector ?? '', cantidad: String(r.cantidad) })),
  );
  const cambiar = (i: number, cambio: Partial<FilaEditable>) =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));

  return (
    <div role="group" aria-label={`Reservas de ${sesion.nombre}`} className="flex flex-col gap-3 rounded-2xl border border-borde p-3">
      <h3 className="text-base font-semibold text-texto">{sesion.nombre}</h3>
      {filas.length === 0 && <p className="text-base text-texto-suave">Sin reservas en esta sesión.</p>}
      {filas.map((f, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-borde p-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-sec-${i}`} className="text-sm text-texto-suave">
              Sección
            </label>
            <select
              id={`${id}-sec-${i}`}
              value={f.seccion}
              disabled={deshabilitado}
              onChange={(e) => cambiar(i, { seccion: e.target.value as Seccion, sector: '' })}
              className={CLASE_INPUT}
            >
              {SECCIONES.map((s) => (
                <option key={s} value={s}>
                  {mayuscula(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-can-${i}`} className="text-sm text-texto-suave">
              Cantidad
            </label>
            <input
              id={`${id}-can-${i}`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={f.cantidad}
              disabled={deshabilitado}
              onChange={(e) => cambiar(i, { cantidad: e.target.value })}
              className={CLASE_INPUT}
            />
          </div>
          {sectores.length > 0 && (
            <div className="col-span-2 flex flex-col gap-1">
              <label htmlFor={`${id}-sector-${i}`} className="text-sm text-texto-suave">
                Sector
              </label>
              <select
                id={`${id}-sector-${i}`}
                value={f.sector}
                disabled={deshabilitado}
                onChange={(e) => cambiar(i, { sector: e.target.value })}
                className={CLASE_INPUT}
              >
                <option value="">Toda la sección</option>
                {sectores
                  .filter((x) => x.seccion === f.seccion)
                  .map((x) => (
                    <option key={x.id} value={x.nombre}>
                      {x.nombre}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <Boton
            variante="fantasma"
            etiqueta={`Quitar fila ${i + 1} de ${sesion.nombre}`}
            disabled={deshabilitado}
            className="col-span-2"
            onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
          >
            Quitar
          </Boton>
        </div>
      ))}
      <Boton
        variante="secundario"
        etiqueta={`Agregar fila a ${sesion.nombre}`}
        disabled={deshabilitado}
        onClick={() => setFilas((fs) => [...fs, { seccion: 'centro', sector: '', cantidad: '' }])}
      >
        Agregar fila
      </Boton>
      <Boton etiqueta={`Guardar reservas de ${sesion.nombre}`} disabled={deshabilitado} onClick={() => onGuardar(sesion, filas)}>
        Guardar reservas
      </Boton>
    </div>
  );
}
