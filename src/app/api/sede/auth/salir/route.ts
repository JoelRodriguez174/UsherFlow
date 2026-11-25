import { NextResponse } from 'next/server';
import { crearSupabaseServidor } from '@/lib/supabaseServer';

export async function POST() {
  const supabase = await crearSupabaseServidor();
  await supabase.rpc('revocar_2fa_pastor');
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
