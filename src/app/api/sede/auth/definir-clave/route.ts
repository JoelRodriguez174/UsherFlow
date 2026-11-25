import { NextResponse } from 'next/server';
import { esContrasenaValida, LARGO_MIN_CLAVE } from '@/lib/pastorAuth';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  let cuerpo: { password?: unknown };
  try {
    cuerpo = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: 'Ingresá una contraseña válida.' }, { status: 400 });
  }

  if (!esContrasenaValida(cuerpo.password)) {
    return NextResponse.json(
      { ok: false, error: 'CLAVE_DEBIL', mensaje: `La contraseña debe tener al menos ${LARGO_MIN_CLAVE} caracteres.` },
      { status: 400 },
    );
  }

  const supabase = await crearSupabaseServidor();
  // Exige que la sesión actual ya haya pasado el 2FA y siga en la lista blanca.
  const { error: errCheck } = await supabase.rpc('obtener_eventos_pastor');
  if (errCheck) {
    return NextResponse.json(
      { ok: false, error: 'NO_AUTORIZADO', mensaje: 'Tu sesión no está verificada. Volvé a ingresar.' },
      { status: 401 },
    );
  }

  const { error: updError } = await supabase.auth.updateUser({ password: cuerpo.password });
  if (updError) {
    return NextResponse.json(
      { ok: false, error: 'ERROR_CLAVE', mensaje: 'No pudimos guardar la contraseña. Probá con otra.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
