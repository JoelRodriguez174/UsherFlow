import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limpiarLimites } from '@/lib/pastorAuth';

const mockServidor = {
  rpc: vi.fn(),
  auth: {
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
};

const mockSinCookies = {
  rpc: vi.fn(),
  auth: {
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
  },
};

vi.mock('@/lib/supabaseServer', () => ({
  crearSupabaseServidor: vi.fn(async () => mockServidor),
  crearSupabaseSinCookies: vi.fn(() => mockSinCookies),
}));

import { POST as iniciar } from './iniciar/route';
import { POST as login } from './login/route';
import { POST as verificarCodigo } from './verificar-codigo/route';
import { POST as definirClave } from './definir-clave/route';
import { POST as salir } from './salir/route';

function reqJson(body: unknown) {
  return new Request('http://localhost/api/sede/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  limpiarLimites();
  vi.clearAllMocks();
});

afterEach(() => limpiarLimites());

describe('API Auth Pastor + 2FA', () => {
  it('iniciar: rechaza email fuera de la lista blanca (403)', async () => {
    mockSinCookies.rpc.mockResolvedValue({ data: { autorizado: false, cuenta_activa: false }, error: null });
    const res = await iniciar(reqJson({ email: 'intruso@gmail.com' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('NO_AUTORIZADO');
    expect(mockSinCookies.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('iniciar: primera vez manda código OTP y pide activación', async () => {
    mockSinCookies.rpc.mockResolvedValue({ data: { autorizado: true, cuenta_activa: false }, error: null });
    mockSinCookies.auth.signInWithOtp.mockResolvedValue({ error: null });
    const res = await iniciar(reqJson({ email: 'pastor@iglesia.org' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paso: 'codigo_activacion' });
    expect(mockSinCookies.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'pastor@iglesia.org',
      options: { shouldCreateUser: true },
    });
  });

  it('iniciar: cuenta activa pasa directo a pedir contraseña sin mandar OTP aún', async () => {
    mockSinCookies.rpc.mockResolvedValue({ data: { autorizado: true, cuenta_activa: true }, error: null });
    const res = await iniciar(reqJson({ email: 'pastor@iglesia.org' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paso: 'contrasena' });
    expect(mockSinCookies.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('login: valida contraseña sin cookies y recién entonces dispara OTP 2FA', async () => {
    mockSinCookies.rpc.mockResolvedValue({ data: { autorizado: true }, error: null });
    mockSinCookies.auth.signInWithPassword.mockResolvedValue({ error: null });
    mockSinCookies.auth.signInWithOtp.mockResolvedValue({ error: null });

    const res = await login(reqJson({ email: 'pastor@iglesia.org', password: 'mi-password-123' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paso: 'codigo_2fa' });
    expect(mockServidor.rpc).not.toHaveBeenCalled();
  });

  it('login: si la contraseña falla devuelve 401 y no manda OTP', async () => {
    mockSinCookies.rpc.mockResolvedValue({ data: { autorizado: true }, error: null });
    mockSinCookies.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid' } });

    const res = await login(reqJson({ email: 'pastor@iglesia.org', password: 'mal' }));
    expect(res.status).toBe(401);
    expect(mockSinCookies.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('verificar-codigo: valida 6 dígitos, confirma 2FA en Postgres y si falla hace signOut', async () => {
    const malo = await verificarCodigo(reqJson({ email: 'pastor@iglesia.org', codigo: '123', modo: 'login' }));
    expect(malo.status).toBe(400);

    mockServidor.auth.verifyOtp.mockResolvedValue({ error: null });
    mockServidor.rpc.mockResolvedValue({ data: { success: false, error: 'OTP_REQUERIDO' }, error: null });
    const rechazado = await verificarCodigo(reqJson({ email: 'pastor@iglesia.org', codigo: '123456', modo: 'login' }));
    expect(rechazado.status).toBe(403);
    expect(mockServidor.auth.signOut).toHaveBeenCalledTimes(1);

    mockServidor.rpc.mockResolvedValue({ data: { success: true }, error: null });
    const ok = await verificarCodigo(reqJson({ email: 'pastor@iglesia.org', codigo: '123456', modo: 'activacion' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, requiereContrasena: true });
  });

  it('definir-clave: exige mínimo 8 caracteres y sesión 2FA verificada', async () => {
    const corta = await definirClave(reqJson({ password: '1234567' }));
    expect(corta.status).toBe(400);

    mockServidor.rpc.mockResolvedValue({ data: null, error: { message: 'DOS_FACTORES_REQUERIDO' } });
    const sin2fa = await definirClave(reqJson({ password: 'password-segura' }));
    expect(sin2fa.status).toBe(401);
    expect(mockServidor.auth.updateUser).not.toHaveBeenCalled();

    mockServidor.rpc.mockResolvedValue({ data: { success: true }, error: null });
    mockServidor.auth.updateUser.mockResolvedValue({ error: null });
    const ok = await definirClave(reqJson({ password: 'password-segura' }));
    expect(ok.status).toBe(200);
  });

  it('salir: revoca 2FA en Postgres y cierra sesión', async () => {
    mockServidor.rpc.mockResolvedValue({ data: { success: true }, error: null });
    mockServidor.auth.signOut.mockResolvedValue({ error: null });
    const res = await salir();
    expect(res.status).toBe(200);
    expect(mockServidor.rpc).toHaveBeenCalledWith('revocar_2fa_pastor');
    expect(mockServidor.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
