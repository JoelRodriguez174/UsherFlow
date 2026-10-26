/**
 * Pantalla completa cuando la clave no sirve (vencida, renovada o inexistente). No ofrece "reintentar": no serviría.
 * El pastor de sede no escanea QR: entra por un enlace que le manda el supervisor.
 */
export function PantallaClaveInvalida({ tipo = 'ujier' }: { tipo?: 'ujier' | 'sede' }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <h1 className="font-titulo text-3xl text-texto">Pedí un QR nuevo</h1>
      <p className="text-lg text-texto-suave">
        {tipo === 'sede'
          ? 'Tu acceso venció o se renovó. Abrí de nuevo el enlace que te mandó el supervisor; si no funciona, pedile uno nuevo.'
          : 'Tu acceso venció o se renovó. Pedile al supervisor que te muestre el QR actual y escanealo con la cámara del celular.'}
      </p>
    </main>
  );
}
