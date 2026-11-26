'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { MarcaICC } from '@/components/ui/MarcaICC';
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

  const pasoNumero = paso === 'email' ? 1 : paso === 'contrasena' ? 2 : 3;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <MarcaICC subtitulo="Iglesia Casa del Alfarero" tamano="grande" />
        <div className="flex flex-col gap-1">
          <h1 className="font-titulo text-3xl text-texto sm:text-4xl">Portal de reservas por sede</h1>
          <p className="text-base text-texto-suave">
            Ingresá con tu correo autorizado por el supervisor para reservar lugares en el mapa del salón.
          </p>
        </div>
      </div>

      <ol aria-label="Pasos de ingreso" className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
        {[
          { n: 1, texto: 'Correo' },
          { n: 2, texto: 'Contraseña' },
          { n: 3, texto: 'Código 2FA' },
        ].map((item) => {
          const activo = pasoNumero === item.n;
          const listo = pasoNumero > item.n;
          return (
            <li
              key={item.n}
              className={`rounded-xl border px-2 py-2 transition-colors ${
                activo
                  ? 'border-acento bg-acento/15 text-acento'
                  : listo
                    ? 'border-libre/50 bg-libre/10 text-libre'
                    : 'border-borde bg-superficie text-texto-suave'
              }`}
            >
              {`${item.n}. ${item.texto}`}
            </li>
          );
        })}
      </ol>

      <Aviso mensaje={error} tipo="error" onCerrar={() => setError(null)} />
      <Aviso mensaje={info} tipo="info" onCerrar={() => setInfo(null)} />

      <section className="rounded-3xl border border-borde bg-superficie p-6 shadow-xl sm:p-7">
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
