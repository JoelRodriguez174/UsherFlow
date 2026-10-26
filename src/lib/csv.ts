import { SECCIONES, type Seccion } from '@/domain/types';

export interface FilaReserva {
  sede: string;
  seccion: Seccion;
  sesion: string;
  cantidad: number;
  /** Opcional: nombre del sector dentro de la sección. */
  sector?: string;
}

export interface ErrorCsv {
  linea: number;
  motivo: string;
}

// Separa una línea en campos respetando comillas dobles y "" escapado.
// shortcut: un campo entrecomillado no puede abarcar varias líneas; subir si Excel lo exporta así.
function dividir(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else actual += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) {
      campos.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  campos.push(actual.trim());
  return campos;
}

/** Filas leídas de una planilla Excel -> texto con `;`, para pasar por la misma validación que el CSV. */
export function planillaATexto(filas: readonly (readonly unknown[])[]): string {
  const campo = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return filas.map((f) => f.map(campo).join(';')).join('\n');
}

const clave = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function parsearReservasCsv(texto: string): { filas: FilaReserva[]; lineas: number[]; errores: ErrorCsv[] } {
  const lineas = texto.replace(/^\uFEFF/, '').split(/\r?\n/);
  const encabezado = lineas[0] ?? '';
  const sep = encabezado.replace(/"[^"]*"/g, '').includes(';') ? ';' : ',';
  const cols = dividir(encabezado, sep).map(clave);
  const idx = Object.fromEntries(['sede', 'seccion', 'sesion', 'cantidad'].map((n) => [n, cols.indexOf(n)]));
  const iSector = cols.indexOf('sector'); // opcional: no entra en `faltan`
  const faltan = Object.keys(idx).filter((n) => idx[n] < 0);
  if (faltan.length) {
    return { filas: [], lineas: [], errores: [{ linea: 1, motivo: `Faltan columnas: ${faltan.join(', ')}` }] };
  }

  const filas: FilaReserva[] = [];
  /** Línea del archivo de cada fila de `filas` (mismo índice); no se manda al servidor. */
  const numeros: number[] = [];
  const errores: ErrorCsv[] = [];
  lineas.forEach((texto, i) => {
    if (i === 0 || !texto.trim()) return;
    const linea = i + 1;
    const c = dividir(texto, sep);
    const sede = c[idx.sede] ?? '';
    const sesion = c[idx.sesion] ?? '';
    const seccionRaw = c[idx.seccion] ?? '';
    const cantidadRaw = c[idx.cantidad] ?? '';
    const seccion = SECCIONES.find((s) => s === seccionRaw.toLowerCase());
    const cantidad = /^\d+$/.test(cantidadRaw) ? Number(cantidadRaw) : 0;
    const motivo = !sede
      ? 'Falta la sede'
      : !sesion
        ? 'Falta la sesión'
        : !seccion
          ? `Sección inválida: ${seccionRaw}`
          : cantidad <= 0
            ? `Cantidad inválida: ${cantidadRaw}`
            : null;
    if (motivo || !seccion) errores.push({ linea, motivo: motivo ?? '' });
    else {
      const sector = iSector >= 0 ? (c[iSector] ?? '') : '';
      filas.push(sector ? { sede, seccion, sesion, cantidad, sector } : { sede, seccion, sesion, cantidad });
      numeros.push(linea);
    }
  });
  return { filas, lineas: numeros, errores };
}
