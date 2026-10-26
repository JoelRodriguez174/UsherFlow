import type { Fila, Pendiente } from './types';
import { grupoMaxJuntoFila, libresFila } from './disponibilidad';
import { apartarDelFondo } from './sedes';
import { colocarVirtual, sugerirUbicacion } from './sugerencia';

export interface ResumenSeccion {
  libres: number;
  grupoMaxJunto: number;
}

/**
 * Resumen de una sección descontando los grupos que ya salieron de la puerta
 * pero todavía no se sentaron (se colocan virtualmente, por orden de llegada).
 * Los lugares apartados para sedes se descuentan virtualmente del fondo.
 */
export function resumenSeccion(
  filas: Fila[],
  pendientes: Pendiente[],
  apartadoLugares = 0,
): ResumenSeccion {
  const libresBrutos = filas.reduce((suma, f) => suma + libresFila(f), 0);
  const enCamino = pendientes.reduce((suma, p) => suma + p.cantidad, 0);

  let virtuales = filas;
  const porLlegada = [...pendientes].sort((a, b) =>
    a.creadoEn < b.creadoEn ? -1 : a.creadoEn > b.creadoEn ? 1 : 0,
  );
  for (const p of porLlegada) {
    const u = sugerirUbicacion(virtuales, p.cantidad);
    if (u) virtuales = colocarVirtual(virtuales, u, p.cantidad);
  }

  return {
    libres: Math.max(0, libresBrutos - enCamino - apartadoLugares),
    grupoMaxJunto: apartarDelFondo(virtuales, apartadoLugares).reduce((max, f) => Math.max(max, grupoMaxJuntoFila(f)), 0),
  };
}
