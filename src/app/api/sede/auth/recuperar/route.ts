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

  if (!verificarLimite(`recuperar:${ipDeRequest(req)}:${email}`, 5, 15 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Esperá unos minutos.' },
      { status: 429 },
    );
  }

  const supabase = crearSupabaseSinCookies();
  const { data } = await supabase.rpc('estado_email_pastor', { p_email: email });
  const estado = (data ?? {}) as { autorizado?: boolean };

  // Si está autorizado envía OTP; siempre devuelve éxito genérico si el email es válido para no facilitar enumeración.
  if (estado.autorizado) {
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  }

  return NextResponse.json({ ok: true, paso: 'codigo_recuperacion' });
}
