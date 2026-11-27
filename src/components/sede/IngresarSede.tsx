'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound, Mail, MapPin, RotateCw, ShieldCheck } from 'lucide-react';
import { Aviso } from '@/components/ui/Aviso';
import { Boton } from '@/components/ui/Boton';
import { MarcaICC } from '@/components/ui/MarcaICC';
import { CLASE_INPUT } from '@/components/supervisor/estilos';

type Paso = 'email' | 'contrasena' | 'codigo' | 'definir_clave';
type ModoCodigo = 'activacion' | 'login' | 'recuperacion';

const SEGUNDOS_REENVIO = 45;

function CampoContrasena({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base text-texto">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${CLASE_INPUT} pr-12`}
        />
        <button
          type="button"
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-texto-suave transition-colors hover:text-texto"
        >
          {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        </button>
      </div>
    </div>
  );
}

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
  const [esperaReenvio, setEsperaReenvio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const ultimoAutoEnvioRef = useRef<string | null>(null);

  useEffect(() => {
    if (paso !== 'codigo' || esperaReenvio <= 0) return;
    const id = window.setInterval(() => {
      setEsperaReenvio((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [paso, esperaReenvio]);

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
        setCodigo('');
        ultimoAutoEnvioRef.current = null;
        setEsperaReenvio(SEGUNDOS_REENVIO);
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
      setModoCodigo('login');
      setPaso('codigo');
      setCodigo('');
      ultimoAutoEnvioRef.current = null;
      setEsperaReenvio(SEGUNDOS_REENVIO);
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
      setPassword('');
      setModoCodigo('recuperacion');
      setPaso('codigo');
      setCodigo('');
      ultimoAutoEnvioRef.current = null;
      setEsperaReenvio(SEGUNDOS_REENVIO);
      setInfo('Si tu correo está autorizado, te enviamos un código de 6 dígitos para crear una contraseña nueva.');
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function reenviarCodigo() {
    if (ocupado || esperaReenvio > 0) return;
    if (modoCodigo === 'login' && !password) {
      setPaso('contrasena');
      setError('Volvé a ingresar tu contraseña para recibir un nuevo código.');
      return;
    }
    setOcupado(true);
    setError(null);
    setInfo(null);
    try {
      const res =
        modoCodigo === 'activacion'
          ? await postJson('/api/sede/auth/iniciar', { email })
          : modoCodigo === 'login'
            ? await postJson('/api/sede/auth/login', { email, password })
            : await postJson('/api/sede/auth/recuperar', { email });
      if (modoCodigo !== 'recuperacion' && !res.data.ok) {
        setError(res.data.mensaje ?? 'No pudimos reenviar el código. Probá en unos segundos.');
        return;
      }
      ultimoAutoEnvioRef.current = null;
      setEsperaReenvio(SEGUNDOS_REENVIO);
      setInfo('Te enviamos un código nuevo a tu correo.');
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function verificarCodigoValor(valor: string) {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const { data } = await postJson('/api/sede/auth/verificar-codigo', {
        email,
        codigo: valor.trim(),
        modo: modoCodigo,
      });
      if (!data.ok) {
        setError(data.mensaje ?? 'El código es incorrecto o venció.');
        return;
      }
      setCodigo('');
      setPassword('');
      ultimoAutoEnvioRef.current = null;
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

  async function enviarCodigo(e: FormEvent) {
    e.preventDefault();
    await verificarCodigoValor(codigo);
  }

  function cambiarCodigo(bruto: string) {
    const limpio = bruto.replace(/\D/g, '').slice(0, 6);
    setCodigo(limpio);
    if (limpio.length < 6) {
      ultimoAutoEnvioRef.current = null;
      return;
    }
    if (!ocupado && ultimoAutoEnvioRef.current !== limpio) {
      ultimoAutoEnvioRef.current = limpio;
      void verificarCodigoValor(limpio);
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
    setEsperaReenvio(0);
    ultimoAutoEnvioRef.current = null;
    setError(null);
    setInfo(null);
  }

  const pasoNumero = paso === 'email' ? 1 : paso === 'contrasena' ? 2 : 3;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,1fr)] lg:items-center lg:gap-12 lg:px-8">
      <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
        <MarcaICC subtitulo="Iglesia Casa del Alfarero" tamano="grande" />
        <div className="flex flex-col gap-2">
          <h1 className="font-titulo text-3xl text-texto sm:text-4xl lg:text-5xl">Portal de reservas por sede</h1>
          <p className="text-base text-texto-suave lg:max-w-md lg:text-lg">
            Ingresá con tu correo autorizado por el supervisor para reservar lugares en el mapa del salón.
          </p>
        </div>

        <ul className="hidden w-full max-w-md flex-col gap-3 pt-2 lg:flex" aria-label="Cómo funciona">
          {[
            {
              icono: Mail,
              titulo: '1. Ingresá tu correo autorizado',
              texto: 'Usá el email que el supervisor habilitó para tu sede.',
            },
            {
              icono: ShieldCheck,
              titulo: '2. Confirmá el código de 6 dígitos',
              texto: 'Te llega al instante al correo para cuidar las reservas de tu sede.',
            },
            {
              icono: MapPin,
              titulo: '3. Elegí tus sectores en el mapa',
              texto: 'Reservá por sesión y copiá tu distribución entre sesiones en un toque.',
            },
          ].map(({ icono: Icono, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3 rounded-2xl border border-borde/80 bg-superficie/60 p-3.5">
              <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-acento/15 text-acento">
                <Icono aria-hidden="true" className="size-4" />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-texto">{titulo}</span>
                <span className="text-xs text-texto-suave">{texto}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex w-full flex-col gap-5">
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
            <form onSubmit={(e) => void enviarEmail(e)} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idBase}-email`} className="text-base font-medium text-texto">
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
            <form onSubmit={(e) => void enviarContrasena(e)} className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-borde/70 bg-fondo/50 px-3.5 py-2.5 text-sm">
                <span className="truncate text-texto-suave">{email}</span>
                <button
                  type="button"
                  onClick={volverAlInicio}
                  className="shrink-0 font-semibold text-acento hover:underline"
                >
                  Cambiar email
                </button>
              </div>
              <CampoContrasena
                id={`${idBase}-pass`}
                label="Contraseña"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <div className="flex flex-col gap-2">
                <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
                  {ocupado ? 'Enviando código…' : 'Ingresar y enviar código'}
                </Boton>
                <Boton variante="fantasma" disabled={ocupado} onClick={() => void pedirRecuperacion()} className="w-full">
                  ¿Olvidaste tu contraseña?
                </Boton>
              </div>
            </form>
          )}

          {paso === 'codigo' && (
            <form onSubmit={(e) => void enviarCodigo(e)} className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-borde/70 bg-fondo/50 px-3.5 py-2.5 text-sm">
                <span className="truncate text-texto-suave">{email}</span>
                <button
                  type="button"
                  onClick={volverAlInicio}
                  className="shrink-0 font-semibold text-acento hover:underline"
                >
                  Cambiar email
                </button>
              </div>
              <p className="text-sm text-texto-suave">
                Ingresá o pegá el código de 6 dígitos que llegó a tu correo. Vence en 10 minutos.
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idBase}-codigo`} className="text-base font-medium text-texto">
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
                  onChange={(e) => cambiarCodigo(e.target.value)}
                  className={`${CLASE_INPUT} text-center text-2xl font-bold tracking-[0.35em] tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Boton type="submit" tamano="grande" disabled={ocupado || codigo.length !== 6} className="w-full">
                  {ocupado ? 'Verificando…' : 'Verificar código'}
                </Boton>
                <Boton
                  variante="fantasma"
                  disabled={ocupado || esperaReenvio > 0}
                  onClick={() => void reenviarCodigo()}
                  className="w-full"
                >
                  <RotateCw aria-hidden="true" className="size-4 shrink-0" />
                  {esperaReenvio > 0 ? `Reenviar código en ${esperaReenvio}s` : 'Reenviar código'}
                </Boton>
              </div>
            </form>
          )}

          {paso === 'definir_clave' && (
            <form onSubmit={(e) => void enviarClaveNueva(e)} className="flex flex-col gap-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-acento">
                <KeyRound aria-hidden="true" className="size-4" />
                <span>Definí tu contraseña</span>
              </div>
              <CampoContrasena
                id={`${idBase}-nueva`}
                label="Nueva contraseña"
                value={claveNueva}
                onChange={setClaveNueva}
                autoComplete="new-password"
                minLength={8}
              />
              <CampoContrasena
                id={`${idBase}-rep`}
                label="Repetí la contraseña"
                value={claveRep}
                onChange={setClaveRep}
                autoComplete="new-password"
                minLength={8}
              />
              <Boton type="submit" tamano="grande" disabled={ocupado} className="w-full">
                {ocupado ? 'Guardando…' : 'Guardar y entrar al mapa'}
              </Boton>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
