import { PasosInicio } from '@/components/supervisor/PasosInicio';

export default function SupervisorRoute() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8 lg:max-w-3xl lg:py-10">
      <h1 className="font-titulo text-2xl text-texto">Preparar el evento</h1>
      <PasosInicio />
    </main>
  );
}
