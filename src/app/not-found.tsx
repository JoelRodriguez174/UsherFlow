export default function NoEncontrada() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <h1 className="font-titulo text-3xl text-texto">Esta pantalla no existe</h1>
      <p className="text-lg text-texto-suave">
        Revisá el enlace o escaneá de nuevo el QR que te dio el supervisor.
      </p>
    </main>
  );
}
