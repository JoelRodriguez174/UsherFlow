'use client';

import { useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useAjusteBooleano } from '@/lib/ajustes';
import { setSonidoHabilitado } from '@/utils/audio';

export const CLAVE_SONIDO = 'usherflow.sonido';

/**
 * Interruptor de sonido del dispositivo (activado por defecto, se recuerda en este celular).
 * El nombre accesible es el texto visible "Sonido"; el estado lo comunica aria-pressed.
 */
export function ControlSonido() {
  const [sonido, setSonido] = useAjusteBooleano(CLAVE_SONIDO, true);

  // El módulo de audio es estado externo: se le informa cada cambio.
  useEffect(() => {
    setSonidoHabilitado(sonido);
  }, [sonido]);

  const Icono = sonido ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      aria-pressed={sonido}
      onClick={() => setSonido(!sonido)}
      className={[
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium',
        sonido ? 'border-acento text-acento' : 'border-borde text-texto-suave',
      ].join(' ')}
    >
      <Icono aria-hidden="true" className="size-5 shrink-0" />
      Sonido
    </button>
  );
}
