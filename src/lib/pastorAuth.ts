const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RE_CODIGO = /^\d{6}$/;

export const LARGO_MIN_CLAVE = 8;
export const LARGO_MAX_CLAVE = 128;

export function normalizarEmail(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : '';
}

export function esEmailValido(email: string): boolean {
  return email.length > 0 && email.length <= 254 && RE_EMAIL.test(email);
}

export function esCodigoValido(valor: unknown): valor is string {
  return typeof valor === 'string' && RE_CODIGO.test(valor.trim());
}

export function esContrasenaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length >= LARGO_MIN_CLAVE && valor.length <= LARGO_MAX_CLAVE;
}

/**
 * Rate limiter en memoria por clave (IP/email) como defensa adicional al límite de Supabase Auth.
 * shortcut: en memoria por instancia, subir a Upstash/Redis si se escala a múltiples réplicas.
 */
type Cubeta = { intentos: number; venceEn: number };
const cubetas = new Map<string, Cubeta>();

export function verificarLimite(clave: string, maxIntentos = 10, ventanaMs = 10 * 60_000, ahora = Date.now()): boolean {
  const actual = cubetas.get(clave);
  if (!actual || actual.venceEn <= ahora) {
    cubetas.set(clave, { intentos: 1, venceEn: ahora + ventanaMs });
    return true;
  }
  if (actual.intentos >= maxIntentos) return false;
  actual.intentos += 1;
  return true;
}

export function limpiarLimites(): void {
  cubetas.clear();
}

export function ipDeRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'local';
}
