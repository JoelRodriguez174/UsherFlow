import Link from 'next/link';

// Inicio público: no expone nada del salón ni pide ninguna clave. Los ujieres entran por QR (/entrar) y los pastores por /sede/ingresar.
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
      <div className="border-t border-borde pt-4">
        <p className="text-sm text-texto-suave">¿Sos pastor de una sede?</p>
        <Link
          href="/sede/ingresar"
          className="mt-1 inline-flex min-h-11 items-center text-base font-semibold text-acento hover:underline"
        >
          Ingresar para reservar lugares →
        </Link>
      </div>
    </main>
  );
}
