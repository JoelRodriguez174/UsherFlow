import { useCallback, useSyncExternalStore } from 'react';

/**
 * Preferencias locales del dispositivo (modo pico, sonido). Viven en localStorage, siempre dentro de
 * try/catch (modo privado, almacenamiento bloqueado, SSR). Si no hay almacenamiento, la preferencia
 * vive en memoria durante la sesión de la página: el control sigue funcionando, solo no persiste.
 */
const enMemoria = new Map<string, string>();
const oyentes = new Set<() => void>();

export function leerAjuste(clave: string): string | null {
  if (enMemoria.has(clave)) return enMemoria.get(clave) ?? null;
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardarAjuste(clave: string, valor: string): void {
  enMemoria.set(clave, valor);
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // sin almacenamiento: queda en memoria
  }
  oyentes.forEach((avisar) => avisar());
}

/** Solo para tests: olvida lo que haya en memoria. */
export function olvidarAjustesEnMemoria(): void {
  enMemoria.clear();
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener('storage', avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener('storage', avisar);
  };
}

/** Preferencia booleana persistida. En el servidor / hidratación devuelve el valor por defecto. */
export function useAjusteBooleano(clave: string, porDefecto: boolean): [boolean, (v: boolean) => void] {
  const valor = useSyncExternalStore(
    suscribir,
    () => {
      const crudo = leerAjuste(clave);
      return crudo === null ? porDefecto : crudo === 'true';
    },
    () => porDefecto,
  );
  const cambiar = useCallback((v: boolean) => guardarAjuste(clave, String(v)), [clave]);
  return [valor, cambiar];
}
