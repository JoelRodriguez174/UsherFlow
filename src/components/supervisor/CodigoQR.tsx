'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type CodigoQRProps = {
  url: string;
  /** Texto alternativo: a qué lleva el QR. */
  descripcion: string;
};

type Generado = { url: string; src: string | null };

/**
 * QR de un enlace. La librería genera un SVG y se muestra como imagen `data:` dentro de un <img>:
 * un SVG cargado así no ejecuta scripts ni toca el DOM de la página, así que no hace falta
 * `dangerouslySetInnerHTML`. Los colores del QR (negro sobre blanco) son los de la librería,
 * necesarios para que los celulares lo lean aunque la interfaz sea oscura.
 */
export function CodigoQR({ url, descripcion }: CodigoQRProps) {
  const [generado, setGenerado] = useState<Generado | null>(null);

  useEffect(() => {
    let vivo = true;
    QRCode.toString(url, { type: 'svg', margin: 1 })
      .then((svg) => {
        if (vivo) setGenerado({ url, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      })
      .catch(() => {
        if (vivo) setGenerado({ url, src: null });
      });
    return () => {
      vivo = false;
    };
  }, [url]);

  // Mientras el QR de este `url` no esté listo (o cambió el enlace) se ve el recuadro vacío.
  const actual = generado !== null && generado.url === url ? generado : null;

  return (
    <div className="flex size-44 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-texto p-1">
      {actual?.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen data: generada en el cliente, no hay nada que optimizar
        <img src={actual.src} alt={`Código QR: ${descripcion}`} width={168} height={168} className="size-full" />
      ) : (
        <p className="px-2 text-center text-sm text-fondo">
          {actual === null ? 'Generando QR…' : 'No se pudo generar el QR. Usá el enlace.'}
        </p>
      )}
    </div>
  );
}
