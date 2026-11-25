import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

function configSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return { url, anonKey };
}

/**
 * Cliente Supabase de servidor ligado a cookies HttpOnly/SameSite=Lax para la sesión del pastor.
 * Sólo se usa cuando el pastor ya verificó el código de 6 dígitos (o para consultar/cerrar su sesión).
 */
export async function crearSupabaseServidor() {
  const { url, anonKey } = configSupabase();
  const cookieStore = await cookies();
  const esProd = process.env.NODE_ENV === 'production';

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(lista) {
        try {
          for (const { name, value, options } of lista) {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: esProd,
              path: '/',
            });
          }
        } catch {
          // En Server Components de sólo lectura `cookies().set` puede no estar disponible.
        }
      },
    },
  });
}

/**
 * Cliente stateless sin cookies para validar el paso 1 (email/contraseña) o mandar OTP
 * sin dejar ninguna cookie de sesión persistida antes de completar el 2FA.
 */
export function crearSupabaseSinCookies() {
  const { url, anonKey } = configSupabase();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
