import { NextResponse } from 'next/server';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let cuerpo: { eventoId?: unknown; filas?: unknown; sesiones?: unknown };
  try {
    cuerpo = (await req.json()) as { eventoId?: unknown; filas?: unknown; sesiones?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: 'DATOS_INVALIDOS' }, { status: 400 });
  }

  if (typeof cuerpo.eventoId !== 'string' || !RE_UUID.test(cuerpo.eventoId) || !Array.isArray(cuerpo.filas)) {
    return NextResponse.json({ success: false, error: 'DATOS_INVALIDOS' }, { status: 400 });
  }

  const sesiones = Array.isArray(cuerpo.sesiones)
    ? cuerpo.sesiones.filter((x): x is string => typeof x === 'string')
    : null;

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc('guardar_reservas_sede_auth', {
    p_evento_id: cuerpo.eventoId,
    p_filas: cuerpo.filas,
    p_sesiones: sesiones,
  });

  if (error) {
    const msg = error.message ?? '';
    const status = msg.includes('NO_AUTENTICADO') || msg.includes('NO_AUTORIZADO') || msg.includes('DOS_FACTORES_REQUERIDO') ? 401 : 500;
    return NextResponse.json({ success: false, error: status === 401 ? 'NO_AUTORIZADO' : 'ERROR_SERVIDOR' }, { status });
  }

  return NextResponse.json(data);
}
