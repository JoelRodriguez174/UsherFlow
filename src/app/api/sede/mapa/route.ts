import { NextResponse } from 'next/server';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const eventoId = new URL(req.url).searchParams.get('eventoId') ?? '';
  if (!RE_UUID.test(eventoId)) {
    return NextResponse.json({ success: false, error: 'EVENTO_INVALIDO' }, { status: 400 });
  }

  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc('obtener_mapa_sede_auth', { p_evento_id: eventoId });
  if (error) {
    const msg = error.message ?? '';
    const status = msg.includes('NO_AUTENTICADO') || msg.includes('NO_AUTORIZADO') || msg.includes('DOS_FACTORES_REQUERIDO') ? 401 : 500;
    return NextResponse.json({ success: false, error: status === 401 ? 'NO_AUTORIZADO' : 'ERROR_SERVIDOR' }, { status });
  }
  return NextResponse.json(data);
}
