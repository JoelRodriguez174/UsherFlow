'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { CLASE_INPUT } from '@/components/supervisor/estilos';

type Paso = 'email' | 'contrasena' | 'codigo' | 'definir_clave';
type ModoCodigo = 'activacion' | 'login' | 'recuperacion';

export function IngresarSede() {
  const router = useRouter();
  const idBase = useId();
  const [paso, setPaso] = useState<Paso>('email');
  const [modoCodigo, setModoCodigo] = useState<ModoCodigo>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [claveRep, setClaveRep] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function postJson(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      paso?: string;
      requiereContrasena?: boolean;
      mensaje?: string;
    };
    return { status: res.status, data };
  }

  async function enviarEmail(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setInfo(null);
    try {
      const { data } = await postJson('/api/sede/auth/iniciar', { email });
      if (!data.ok) {
        setError(data.mensaje ?? 'No pudimos verificar tu email.');
        return;
      }
      if (data.paso === 'codigo_activacion') {
        setModoCodigo('activacion');
        setPaso('codigo');
        setInfo('Te enviamos un código de 6 dígitos a tu correo para activar tu cuenta.');
      } else {
        setPaso('contrasena');
      }
    } catch {
      setError('Sin conexión. Revisá tu internet y probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function enviarContrasena(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setInfo(null);
    try {
      const { data } = await postJson('/api/sede/auth/login', { email, password });
      if (!data.ok) {
        setError(data.mensaje ?? 'Email o contraseña incorrectos.');
        return;
      }
      setPassword('');
      setModoCodigo('login');
      setPaso('codigo');
      setInfo('Te enviamos un código de 6 dígitos a tu correo para confirmar el ingreso.');
    } catch {
      setError('Sin conexión. Revisá tu internet y probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function pedirRecuperacion() {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    setInfo(null);
    try {
      await postJson('/api/sede/auth/recuperar', { email });
      setModoCodigo('recuperacion');
      setPaso('codigo');
      setInfo('Si tu correo está autorizado, te enviamos un código de 6 dígitos para crear una contraseña nueva.');
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCodigo(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const { data } = await postJson('/api/sede/auth/verificar-codigo', {
        email,
        codigo: codigo.trim(),
        modo: modoCodigo,
      });
      if (!data.ok) {
        setError(data.mensaje ?? 'El código es incorrecto o venció.');
        return;
      }
      setCodigo('');
      if (data.requiereContrasena) {
        setPaso('definir_clave');
        setInfo('Código verificado. Ahora definí tu contraseña (mínimo 8 caracteres).');
      } else {
        router.replace('/sede');
      }
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function enviarClaveNueva(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    if (claveNueva.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (claveNueva !== claveRep) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setOcupado(true);
    try {
      const { data } = await postJson('/api/sede/auth/definir-clave', { password: claveNueva });
      if (!data.ok) {
        setError(data.mensaje ?? 'No pudimos guardar la contraseña.');
        return;
      }
      setClaveNueva('');
      setClaveRep('');
      router.replace('/sede');
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  function volverAlInicio() {
    setPaso('email');
    setPassword('');
    setCodigo('');
    setError(null);
    setInfo(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wider text-acento">UsherFlow · Pastores de sede</p>
        <h1 className="font-titulo text-3xl text-texto">Ingresá a tu sede</h1>
        <p className="text-base text-texto-suave">
          Acceso exclusivo para emails autorizados por el supervisor, con verificación en dos pasos.
        </p>
      </div>

      <Aviso mensaje={error} tipo="error" onCerrar={() => setError(null)} />
      <Aviso mensaje={info} tipo="info" onCerrar={() => setInfo(null)} />

      <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-lg">
        {paso === 'email' && (
          <form onSubmit={(e) => void enviarEmail(e)} className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-acento">
              <Mail aria-hidden="true" className="size-4" />
              <span>Paso 1 · Tu correo autorizado</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-email`} className="text-base text-texto">
                Email
              </label>
              <input
                id={`${idBase}-email`}
                type="email"
                autoComplete="email"
                required
                placeholder="pastor@iglesia.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={CLASE_INPUT}
              />
            </div>
            <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
              {ocupado ? 'Verificando…' : 'Continuar'}
            </Boton>
          </form>
        )}

        {paso === 'contrasena' && (
          <form onSubmit={(e) => void enviarContrasena(e)} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-acento">
                <KeyRound aria-hidden="true" className="size-4" />
                <span>Paso 2 · Contraseña</span>
              </span>
              <button
                type="button"
                onClick={volverAlInicio}
                className="text-sm font-semibold text-texto-suave hover:text-acento"
              >
                Cambiar email
              </button>
            </div>
            <p className="text-sm text-texto-suave">{email}</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-pass`} className="text-base text-texto">
                Contraseña
              </label>
              <input
                id={`${idBase}-pass`}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={CLASE_INPUT}
              />
            </div>
            <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
              {ocupado ? 'Enviando código…' : 'Ingresar y enviar código'}
            </Boton>
            <Boton variante="fantasma" disabled={ocupado} onClick={() => void pedirRecuperacion()} className="w-full">
              ¿Olvidaste tu contraseña?
            </Boton>
          </form>
        )}

        {paso === 'codigo' && (
          <form onSubmit={(e) => void enviarCodigo(e)} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-acento">
                <ShieldCheck aria-hidden="true" className="size-4" />
                <span>Verificación en dos pasos</span>
              </span>
              <button
                type="button"
                onClick={volverAlInicio}
                className="text-sm font-semibold text-texto-suave hover:text-acento"
              >
                Cambiar email
              </button>
            </div>
            <p className="text-sm text-texto-suave">
              Ingresá el código de 6 dígitos que llegó a <strong className="text-texto">{email}</strong>. Vence en 10 minutos.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-codigo`} className="text-base text-texto">
                Código de 6 dígitos
              </label>
              <input
                id={`${idBase}-codigo`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                placeholder="000000"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`${CLASE_INPUT} text-center text-2xl font-bold tracking-[0.35em] tabular-nums`}
              />
            </div>
            <Boton type="submit" tamano="grande" disabled={ocupado || codigo.length !== 6} className="w-full">
              {ocupado ? 'Verificando…' : 'Verificar código'}
            </Boton>
          </form>
        )}

        {paso === 'definir_clave' && (
          <form onSubmit={(e) => void enviarClaveNueva(e)} className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-acento">
              <KeyRound aria-hidden="true" className="size-4" />
              <span>Definí tu contraseña</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-nueva`} className="text-base text-texto">
                Nueva contraseña
              </label>
              <input
                id={`${idBase}-nueva`}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={claveNueva}
                onChange={(e) => setClaveNueva(e.target.value)}
                className={CLASE_INPUT}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-rep`} className="text-base text-texto">
                Repetí la contraseña
              </label>
              <input
                id={`${idBase}-rep`}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={claveRep}
                onChange={(e) => setClaveRep(e.target.value)}
                className={CLASE_INPUT}
              />
            </div>
            <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
              {ocupado ? 'Guardando…' : 'Guardar y entrar al mapa'}
            </Boton>
          </form>
        )}
      </section>
    </main>
  );
}
