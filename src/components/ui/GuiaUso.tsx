'use client';

import { useState } from 'react';
import { BookOpen, CircleHelp } from 'lucide-react';
import { Desplegable } from './Desplegable';
import { Modal } from './Modal';

export type RolGuia = 'supervisor' | 'sede' | 'puerta' | 'seccion';

type PasoGuia = { titulo: string; detalle: string };

const GUIAS: Record<RolGuia, { titulo: string; subtitulo: string; pasos: PasoGuia[]; consejo: string }> = {
  supervisor: {
    titulo: 'Cómo preparar y operar el evento',
    subtitulo: 'Guía rápida paso a paso para el supervisor',
    pasos: [
      { titulo: '1. Armá el Salón', detalle: 'Cargá las filas y dividí cada sección en sectores (por ejemplo: Adelante, Medio y Atrás).' },
      { titulo: '2. Cargá las Sesiones', detalle: 'Definí cada reunión con su horario y cuántos minutos antes se liberan las reservas no usadas.' },
      { titulo: '3. Autorizá las Sedes', detalle: 'Cargá el email del pastor de cada sede (uno por uno o desde Excel/CSV) y fijá la fecha límite.' },
      { titulo: '4. Revisá las Reservas', detalle: 'Mirá en el mapa qué reservó cada sede o importá una planilla Excel/CSV si necesitás ajustar.' },
      { titulo: '5. Mostrá los QR a los ujieres', detalle: 'Cada ujier escanea el QR de su puesto (Puerta, Izquierda, Centro o Derecha) sin crear cuenta.' },
      { titulo: '6. Hacé la Revisión final', detalle: 'Verificá que todos los pasos estén en verde antes de abrir las puertas del salón.' },
    ],
    consejo: 'Durante el servicio podés entrar acá en cualquier momento para ver la ocupación total en tiempo real.',
  },
  sede: {
    titulo: 'Cómo reservar lugares para tu sede',
    subtitulo: 'Guía paso a paso en el mapa del salón',
    pasos: [
      { titulo: '1. Elegí la sesión', detalle: 'Tocá arriba la reunión que querés reservar (por ejemplo, Sábado Mañana o Sábado Noche).' },
      { titulo: '2. Tocá un sector en el mapa', detalle: 'Los sectores en verde tienen lugares libres y los en ámbar tienen pocos. Los grises están agotados.' },
      { titulo: '3. Elegí cuántos lugares necesitás', detalle: 'Usá los botones − / + o escribí el número. Vas a ver la barra del sector llenarse en vivo.' },
      { titulo: '4. Confirmá tu reserva', detalle: 'Tocá "Aplicar" en cada sector y al final apretá "Confirmar" en tu resumen para guardar todo.' },
    ],
    consejo: 'Podés volver a tocar cualquier sector reservado para cambiar la cantidad o quitarlo antes de la fecha límite.',
  },
  puerta: {
    titulo: 'Guía rápida — Ujier de Puerta',
    subtitulo: 'Cómo derivar grupos en la hora pico',
    pasos: [
      { titulo: '1. Preguntá si vienen de una sede (si aplica)', detalle: 'Si aparecen chips de sedes arriba y el grupo pertenece a una, tocá su sede para cuidar su cupo.' },
      { titulo: '2. Marcá cuántos son', detalle: 'Tocá 1, 2, 3, 4 o 5+ según el tamaño del grupo que entra junto.' },
      { titulo: '3. Derivá a una sección', detalle: 'Tocá el botón de Izquierda, Centro o Derecha que tenga lugar disponible. No hace falta elegir fila.' },
    ],
    consejo: 'En la hora pico activá "Hora pico" arriba para dejar la pantalla mínima y operar con una sola mano.',
  },
  seccion: {
    titulo: 'Guía rápida — Ujier de Sección',
    subtitulo: 'Cómo confirmar grupos y mantener el dato real',
    pasos: [
      { titulo: '1. Mirá el aviso "Vienen N"', detalle: 'Cuando Puerta manda un grupo aparece arriba con una fila sugerida automáticamente.' },
      { titulo: '2. Confirmá con un toque', detalle: 'Tocá "Sentar en Fila X" cuando los ubicás. Si preferís otra fila usá "Otra fila…"; si no llegaron, "No llegaron".' },
      { titulo: '3. Mantené tus filas al día', detalle: 'Si alguien se va usá "Se levantó alguien". Si ves una diferencia real, usá "Corregir conteo" y tocá "Ya revisé".' },
    ],
    consejo: 'Si una fila queda fragmentada (en ámbar), revisala y tocá "Juntos" cuando vuelvan a entrar grupos juntos.',
  },
};

function ListaGuia({ rol }: { rol: RolGuia }) {
  const guia = GUIAS[rol];
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2.5">
        {guia.pasos.map((p) => (
          <li key={p.titulo} className="rounded-xl border border-borde/70 bg-fondo/60 px-3 py-2.5">
            <p className="text-sm font-semibold text-texto">{p.titulo}</p>
            <p className="mt-0.5 text-sm text-texto-suave">{p.detalle}</p>
          </li>
        ))}
      </ol>
      <p className="rounded-xl border border-acento/40 bg-superficie-alta px-3 py-2 text-sm text-texto-suave">
        <span className="font-semibold text-acento">Tip: </span>
        {guia.consejo}
      </p>
    </div>
  );
}

/** Acordeón desplegable animado para Supervisor y Pastor de sede. */
export function GuiaUso({ rol }: { rol: Extract<RolGuia, 'supervisor' | 'sede'> }) {
  const guia = GUIAS[rol];
  return (
    <Desplegable
      titulo={guia.titulo}
      subtitulo={guia.subtitulo}
      icono={<BookOpen className="size-5" />}
    >
      <ListaGuia rol={rol} />
    </Desplegable>
  );
}

/** Botón compacto de encabezado que abre la guía en un Modal (ideal para Puerta y Sección en hora pico). */
export function BotonGuiaUso({ rol }: { rol: Extract<RolGuia, 'puerta' | 'seccion'> }) {
  const [abierto, setAbierto] = useState(false);
  const guia = GUIAS[rol];
  return (
    <>
      <button
        type="button"
        aria-label="Guía de uso"
        onClick={() => setAbierto(true)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-borde px-3 text-sm font-medium text-texto-suave transition-colors hover:border-texto-suave hover:text-texto"
      >
        <CircleHelp aria-hidden="true" className="size-5 shrink-0" />
        <span className="hidden sm:inline">Guía</span>
      </button>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={guia.titulo}>
        <ListaGuia rol={rol} />
      </Modal>
    </>
  );
}
