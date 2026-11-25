import { NextResponse } from 'next/server';
import { esEmailValido, ipDeRequest, normalizarEmail, verificarLimite } from '@/lib/pastorAuth';
import { crearSupabaseSinCookies } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  let cuerpo: { email?: unknown; password?: unknown };
  try {
    cuerpo = (await req.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: 'Completá email y contraseña.' }, { status: 400 });
  }

  const email = normalizarEmail(cuerpo.email);
  const password = typeof cuerpo.password === 'string' ? cuerpo.password : '';
  if (!esEmailValido(email) || password.length === 0) {
    return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: 'Completá email y contraseña.' }, { status: 400 });
  }

  if (!verificarLimite(`login:${ipDeRequest(req)}:${email}`, 8, 10 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' },
      { status: 429 },
    );
  }

  const supabase = crearSupabaseSinCookies();
  const { data: estadoData } = await supabase.rpc('estado_email_pastor', { p_email: email });
  const estado = (estadoData ?? {}) as { autorizado?: boolean };
  if (!estado.autorizado) {
    return NextResponse.json(
      { ok: false, error: 'CREDENCIALES_INVALIDAS', mensaje: 'Email o contraseña incorrectos.' },
      { status: 401 },
    );
  }

  // Valida contraseña en un cliente stateless: NO persiste ninguna cookie antes del código de 6 dígitos.
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
  if (loginError) {
    return NextResponse.json(
      { ok: false, error: 'CREDENCIALES_INVALIDAS', mensaje: 'Email o contraseña incorrectos.' },
      { status: 401 },
    );
  }

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (otpError) {
    return NextResponse.json(
      { ok: false, error: 'ENVIO_FALLIDO', mensaje: 'No pudimos enviar el código de verificación. Probá en un minuto.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, paso: 'codigo_2fa' });
}
