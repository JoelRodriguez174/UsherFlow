'use client';

import { useId, useState, type ReactNode } from 'react';
import { PLANTILLA_EJEMPLO } from '@/config/plantilla';
import type { Rol } from '@/domain/types';
import { armarEnlace, guardarAcceso } from '@/lib/acceso';
import { ClaveInvalidaError, llamarRpc, mensajeDeError, type ResultadoRpc } from '@/lib/rpc';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { Modal } from '@/components/ui/Modal';
import { TarjetaEnlace } from './TarjetaEnlace';
import { useArmado } from './useArmado';

type RespuestaExitosa = Extract<ResultadoRpc, { success: true }>;

export type ClavesSalon = { claveUjier: string; claveSupervisor: string };

export type SupervisorPanelProps = ClavesSalon & {
  origen: string;
  ocupacion: { ocupados: number; capacidad: number };
  /** Se avisa cuando "Renovar claves" tuvo éxito (el acceso guardado ya apunta a la clave nueva). */
  onClavesRenovadas?(claves: ClavesSalon): void;
};

const DESTINOS_UJIER: ReadonlyArray<{ rol: Rol; titulo: string; descripcion: string }> = [
  { rol: 'puerta', titulo: 'Puerta', descripcion: 'acceso de la Puerta' },
  { rol: 'izquierda', titulo: 'Izquierda', descripcion: 'acceso de la sección Izquierda' },
  { rol: 'centro', titulo: 'Centro', descripcion: 'acceso de la sección Centro' },
  { rol: 'derecha', titulo: 'Derecha', descripcion: 'acceso de la sección Derecha' },
];

type Confirmacion =
  | { tipo: 'vaciar'; paso: 1 | 2 }
  | { tipo: 'plantilla' }
  | { tipo: 'claves' }
  | null;

type MensajeAccion = { tipo: 'info' | 'error'; texto: string } | null;

function esTexto(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

export function SupervisorPanel({
  claveUjier,
  claveSupervisor,
  origen,
  ocupacion,
  onClavesRenovadas,
}: SupervisorPanelProps) {
  // Tras renovar, mandan las claves nuevas que devolvió el servidor (las props siguen siendo las viejas
  // hasta que la página las vuelva a pedir).
  const [renovadas, setRenovadas] = useState<ClavesSalon | null>(null);
  const claves: ClavesSalon = renovadas ?? { claveUjier, claveSupervisor };

  const [confirmacion, setConfirmacion] = useState<Confirmacion>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeAccion>(null);

  /** Llama a la RPC como supervisor. Devuelve la respuesta si salió bien; si no, deja el aviso de error. */
  async function llamar(nombre: string, params: Record<string, unknown> = {}): Promise<RespuestaExitosa | null> {
    try {
      const res = await llamarRpc(nombre, { p_clave: claves.claveSupervisor, ...params });
      if (!res.success) {
        setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
        return null;
      }
      return res;
    } catch (e) {
      setMensaje({ tipo: 'error', texto: mensajeDeError(e instanceof ClaveInvalidaError ? 'CLAVE_INVALIDA' : 'ERROR_DE_RED') });
      return null;
    }
  }

  async function confirmar() {
    if (confirmacion === null || ocupado) return;
    if (confirmacion.tipo === 'vaciar' && confirmacion.paso === 1) {
      setConfirmacion({ tipo: 'vaciar', paso: 2 });
      return;
    }
    const accion = confirmacion.tipo;
    setOcupado(true);
    setMensaje(null);
    try {
      if (accion === 'vaciar') {
        if (await llamar('reiniciar_salon')) setMensaje({ tipo: 'info', texto: 'Auditorio vaciado.' });
      } else if (accion === 'plantilla') {
        if (await llamar('aplicar_plantilla', { p_plantilla: PLANTILLA_EJEMPLO })) {
          setMensaje({ tipo: 'info', texto: 'Plantilla aplicada.' });
        }
      } else {
        const res = await llamar('regenerar_claves');
        if (res) {
          const nuevaUjier = res.clave_ujier;
          const nuevaSupervisor = res.clave_supervisor;
          if (esTexto(nuevaUjier) && esTexto(nuevaSupervisor)) {
            // La sesión del propio supervisor sigue funcionando con la clave nueva.
            guardarAcceso(nuevaSupervisor, 'supervisor');
            const nuevas = { claveUjier: nuevaUjier, claveSupervisor: nuevaSupervisor };
            setRenovadas(nuevas);
            setMensaje({ tipo: 'info', texto: 'Claves renovadas. Los QR anteriores ya no sirven: repartí los nuevos.' });
            onClavesRenovadas?.(nuevas);
          } else {
            setMensaje({ tipo: 'error', texto: mensajeDeError('RESPUESTA_INVALIDA') });
          }
        }
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
  const porcentaje = ocupacion.capacidad === 0 ? 0 : Math.round((ocupacion.ocupados / ocupacion.capacidad) * 100);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-titulo text-2xl text-texto">Supervisor</h1>
        <p className="text-base text-texto-suave">
          {`Ocupación: ${ocupacion.ocupados} de ${ocupacion.capacidad} lugares (${porcentaje}%)`}
        </p>
      </div>

      <Aviso mensaje={mensaje?.texto ?? null} tipo={mensaje?.tipo} onCerrar={() => setMensaje(null)} />

      <section aria-labelledby="sup-ujieres" className="flex flex-col gap-3">
        <h2 id="sup-ujieres" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Enlaces para ujieres
        </h2>
        <p className="text-base text-texto-suave">Cada ujier escanea el QR de su lugar con la cámara del celular.</p>
        <ul aria-labelledby="sup-ujieres" className="flex flex-col gap-4">
          {DESTINOS_UJIER.map(({ rol, titulo: nombre, descripcion }) => (
            <li key={rol}>
              <TarjetaEnlace
                titulo={nombre}
                descripcion={descripcion}
                url={armarEnlace(origen, claves.claveUjier, rol)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sup-propio" className="flex flex-col gap-3">
        <h2 id="sup-propio" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Tu acceso de supervisor
        </h2>
        <TarjetaEnlace
          titulo="Supervisor"
          descripcion="acceso del supervisor"
          url={armarEnlace(origen, claves.claveSupervisor, 'supervisor')}
        />
      </section>

      <section aria-labelledby="sup-acciones" className="flex flex-col gap-3">
        <h2 id="sup-acciones" className="text-sm font-semibold uppercase tracking-wider text-texto-suave">
          Acciones del salón
        </h2>
        <Boton variante="peligro" tamano="grande" onClick={() => setConfirmacion({ tipo: 'vaciar', paso: 1 })}>
          Vaciar auditorio
        </Boton>
        <Boton variante="secundario" tamano="grande" onClick={() => setConfirmacion({ tipo: 'plantilla' })}>
          Aplicar plantilla
        </Boton>
        <Boton variante="secundario" tamano="grande" onClick={() => setConfirmacion({ tipo: 'claves' })}>
          Renovar claves
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
    </div>
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
  if (c.tipo === 'plantilla') {
    return {
      titulo: 'Aplicar plantilla',
      cuerpo:
        'Se reemplazan todas las filas y tramos por los de la plantilla y se cancelan los grupos en camino. Se pierde el conteo actual.',
      botonConfirmar: 'Sí, aplicar',
      peligro: true,
    };
  }
  return {
    titulo: 'Renovar claves',
    cuerpo:
      'Los QR y enlaces actuales dejan de funcionar: cada ujier tendrá que escanear el QR nuevo. Tu sesión sigue activa.',
    botonConfirmar: 'Sí, renovar',
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
