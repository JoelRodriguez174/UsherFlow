import { Suspense } from 'react';
import { EntrarContenido } from './EntrarContenido';

// useSearchParams exige un límite de Suspense para que la página se pueda prerenderizar en el build.
export default function EntrarPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
          <p role="status" className="text-base text-texto-suave">
            Cargando…
          </p>
        </main>
      }
    >
      <EntrarContenido />
    </Suspense>
  );
}
