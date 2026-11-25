import { NextResponse } from 'next/server';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await crearSupabaseServidor();
  const { data, error } = await supabase.rpc('obtener_eventos_pastor');
  if (error || !data) {
    return NextResponse.json({ autenticado: false }, { status: 401 });
  }
  const res = data as { success?: boolean; sede?: unknown; eventos?: unknown };
  if (!res.success) {
    return NextResponse.json({ autenticado: false }, { status: 401 });
  }
  return NextResponse.json({ autenticado: true, sede: res.sede, eventos: res.eventos });
}
