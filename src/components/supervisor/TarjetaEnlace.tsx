'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Boton } from '@/components/ui/Boton';
import { CodigoQR } from './CodigoQR';

type TarjetaEnlaceProps = {
  titulo: string;
  url: string;
  /** Qué abre el enlace, para el texto alternativo del QR. */
  descripcion: string;
};

type EstadoCopia = 'nada' | 'copiado' | 'manual';

/** QR + enlace como texto seleccionable + botón para copiarlo. */
export function TarjetaEnlace({ titulo, url, descripcion }: TarjetaEnlaceProps) {
  const [copia, setCopia] = useState<EstadoCopia>('nada');
  const textoRef = useRef<HTMLElement>(null);

  // El mensaje de "copiado" se apaga solo.
  useEffect(() => {
    if (copia === 'nada') return;
    const id = setTimeout(() => setCopia('nada'), 3000);
    return () => clearTimeout(id);
  }, [copia]);

  function seleccionarTexto() {
    const nodo = textoRef.current;
    if (!nodo) return;
    const seleccion = window.getSelection();
    if (!seleccion) return;
    const rango = document.createRange();
    rango.selectNodeContents(nodo);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  }

  async function copiar() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopia('copiado');
        return;
      }
    } catch {
      // permiso denegado o contexto no seguro: se cae a la selección manual
    }
    seleccionarTexto();
    setCopia('manual');
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-borde bg-superficie p-4">
      <h3 className="self-start font-titulo text-xl text-texto">{titulo}</h3>
      <CodigoQR url={url} descripcion={descripcion} />
      <code
        ref={textoRef}
        className="w-full select-all break-all rounded-xl bg-superficie-alta p-3 text-sm text-texto-suave"
      >
        {url}
      </code>
      <Boton variante="secundario" onClick={copiar} className="w-full">
        {copia === 'copiado' ? (
          <Check aria-hidden="true" className="size-5 shrink-0" />
        ) : (
          <Copy aria-hidden="true" className="size-5 shrink-0" />
        )}
        Copiar enlace
        <span className="sr-only">{` de ${titulo}`}</span>
      </Boton>
      <p aria-live="polite" className="min-h-5 self-start text-sm text-texto-suave">
        {copia === 'copiado' && 'Copiado.'}
        {copia === 'manual' && 'Enlace seleccionado: copialo con el menú de tu teclado.'}
      </p>
    </div>
  );
}
