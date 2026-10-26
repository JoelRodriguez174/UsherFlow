import type { Metadata, Viewport } from 'next';
import { Fraunces, Figtree } from 'next/font/google';
import './globals.css';

// Serifa cálida y suave para títulos; sans humanista y legible para el cuerpo.
// Las variables (--fuente-*) las consume el @theme de globals.css.
const fuenteTitulo = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--fuente-titulo',
});

const fuenteCuerpo = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--fuente-cuerpo',
});

export const metadata: Metadata = {
  // /entrar?k=<clave> lleva el secreto compartido en la URL: nunca debe salir en el encabezado Referer.
  referrer: 'no-referrer',
  title: 'UsherFlow — Iglesia Casa del Alfarero',
  description: 'Sistema de ruteo y ocupación en tiempo real para el equipo de ujieres de ICC',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'UsherFlow ICC',
  },
};

// Se permite el zoom (accesibilidad): sin maximumScale ni userScalable.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  // Mismo valor que --color-fondo, en rgb() para no repetir hex fuera de globals.css.
  themeColor: 'rgb(20 16 13)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${fuenteTitulo.variable} ${fuenteCuerpo.variable}`}>
      <head>
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-dvh overflow-x-hidden bg-fondo font-cuerpo text-texto antialiased">
        {children}
      </body>
    </html>
  );
}
