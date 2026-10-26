const ZONA = 'America/Argentina/Buenos_Aires';

// Argentina es UTC-3 todo el año (sin horario de verano): se convierte explícito, sin depender del navegador.
/** `datetime-local` ("2026-11-01T18:30") -> ISO con la hora de Argentina. */
export const deLocalAr = (v: string) => `${v}:00-03:00`;
/** ISO -> valor para `datetime-local` en hora de Argentina. */
export const aLocalAr = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 16);
export const mostrarHora = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(iso));
