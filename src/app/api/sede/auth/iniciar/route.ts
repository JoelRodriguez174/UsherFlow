import { NextResponse } from 'next/server';
import { esEmailValido, ipDeRequest, normalizarEmail, verificarLimite } from '@/lib/pastorAuth';
import { crearSupabaseSinCookies } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  let cuerpo: { email?: unknown };
  try {
    cuerpo = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: 'Ingresá un email válido.' }, { status: 400 });
  }

  const email = normalizarEmail(cuerpo.email);
  if (!esEmailValido(email)) {
    return NextResponse.json({ ok: false, error: 'EMAIL_INVALIDO', mensaje: 'Ingresá un email válido.' }, { status: 400 });
  }

  if (!verificarLimite(`iniciar:${ipDeRequest(req)}:${email}`, 10, 10 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' },
      { status: 429 },
    );
  }

  const supabase = crearSupabaseSinCookies();
  const { data, error } = await supabase.rpc('estado_email_pastor', { p_email: email });
  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'ERROR_SERVIDOR', mensaje: 'No pudimos verificar el email. Probá de nuevo.' }, { status: 500 });
  }

  const estado = data as { autorizado?: boolean; cuenta_activa?: boolean };
  if (!estado.autorizado) {
    return NextResponse.json(
      {
        ok: false,
        error: 'NO_AUTORIZADO',
        mensaje: 'Este email no está autorizado para ninguna sede. Pedile al supervisor que lo cargue.',
      },
      { status: 403 },
    );
  }

  if (estado.cuenta_activa) {
    return NextResponse.json({ ok: true, paso: 'contrasena' });
  }

  // Primera activación: crea el usuario en Auth (el trigger en DB re-valida la lista blanca) y manda código de 6 dígitos.
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (otpError) {
    return NextResponse.json(
      { ok: false, error: 'ENVIO_FALLIDO', mensaje: 'No pudimos enviar el código al correo. Probá en un minuto.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, paso: 'codigo_activacion' });
}
