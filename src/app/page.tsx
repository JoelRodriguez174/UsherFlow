// Inicio público: no expone nada del salón ni pide ninguna clave. El acceso es solo por QR (/entrar).
export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-acento">UsherFlow</p>
      <h1 className="font-titulo text-3xl text-texto">Escaneá el QR que te dio el supervisor</h1>
      <p className="text-lg text-texto-suave">
        Cada ujier entra con el QR de su lugar: Puerta, Izquierda, Centro o Derecha. Usá la cámara del celular; no
        hace falta instalar nada ni crear una cuenta.
      </p>
      <p className="text-base text-texto-suave">
        ¿El QR no funciona o dice que venció? Pedile al supervisor que te muestre uno nuevo.
      </p>
    </main>
  );
}
