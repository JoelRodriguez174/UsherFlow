import { notFound } from 'next/navigation';
import { SECCIONES, type Seccion } from '@/domain/types';
import { SeccionPagina } from '@/components/paginas/SeccionPagina';

function esSeccion(v: string): v is Seccion {
  return (SECCIONES as readonly string[]).includes(v);
}

// En Next 16 `params` es una Promise. Solo se aceptan las tres secciones; cualquier otra da 404.
export default async function SeccionRoute({ params }: { params: Promise<{ seccion: string }> }) {
  const { seccion } = await params;
  if (!esSeccion(seccion)) notFound();
  return <SeccionPagina seccion={seccion} />;
}
