import { NextResponse } from 'next/server';
import { esCodigoValido, esEmailValido, ipDeRequest, normalizarEmail, verificarLimite } from '@/lib/pastorAuth';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

type Modo = 'activacion' | 'login' | 'recuperacion';

function esModo(v: unknown): v is Modo {
  return v === 'activacion' || v === 'login' || v === 'recuperacion';
}

export async function POST(req: Request) {
  let cuerpo: { email?: unknown; codigo?: unknown; modo?: unknown };
  try {
    cuerpo = (await req.json()) as { email?: unknown; codigo?: unknown; modo?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: 'Ingresá el código de 6 dígitos.' }, { status: 400 });
  }

  const email = normalizarEmail(cuerpo.email);
  const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.trim() : '';
  const modo: Modo = esModo(cuerpo.modo) ? cuerpo.modo : 'login';

  if (!esEmailValido(email) || !esCodigoValido(codigo)) {
    return NextResponse.json({ ok: false, error: 'CODIGO_INVALIDO', mensaje: 'El código debe tener 6 dígitos.' }, { status: 400 });
  }

  if (!verificarLimite(`otp:${ipDeRequest(req)}:${email}`, 6, 10 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Pedí un código nuevo en unos minutos.' },
      { status: 429 },
    );
  }

  const supabase = await crearSupabaseServidor();
  const { error: otpError } = await supabase.auth.verifyOtp({
    email,
    token: codigo,
    type: 'email',
  });
  if (otpError) {
    return NextResponse.json(
      { ok: false, error: 'CODIGO_INVALIDO', mensaje: 'El código es incorrecto o venció. Pedí uno nuevo.' },
      { status: 401 },
    );
  }

  // Registra el 2FA en Postgres (valida JWT + amr:otp reciente + lista blanca sede_pastor).
  const { data: res2fa, error: err2fa } = await supabase.rpc('confirmar_2fa_pastor');
  const confirmado = !err2fa && Boolean((res2fa as { success?: boolean } | null)?.success);
  if (!confirmado) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { ok: false, error: 'NO_AUTORIZADO', mensaje: 'No pudimos verificar tu acceso. Pedile ayuda al supervisor.' },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, requiereContrasena: modo !== 'login' });
}
