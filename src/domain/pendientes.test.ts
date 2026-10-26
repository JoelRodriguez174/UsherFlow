import { describe, expect, it } from 'vitest';
import type { Pendiente } from './types';
import {
  UMBRAL_AMBAR_MS,
  ahoraServidor,
  calcularOffset,
  pendienteEsAmbar,
} from './pendientes';

const AHORA = Date.parse('2026-10-22T20:00:00.000Z');

function pendienteHace(ms: number): Pendiente {
  return {
    id: 'p',
    seccion: 'centro',
    cantidad: 2,
    creadoEn: new Date(AHORA - ms).toISOString(),
    sedeId: null,
  };
}

describe('pendienteEsAmbar', () => {
  it('el umbral es 180 000 ms', () => {
    expect(UMBRAL_AMBAR_MS).toBe(180_000);
  });

  it('creado hace 179 999 ms no es ámbar', () => {
    expect(pendienteEsAmbar(pendienteHace(179_999), AHORA)).toBe(false);
  });

  it('creado hace 180 000 ms es ámbar', () => {
    expect(pendienteEsAmbar(pendienteHace(180_000), AHORA)).toBe(true);
  });
});

describe('calcularOffset', () => {
  it('con RTT de 200 ms compensa 100 ms (la mitad del viaje)', () => {
    const serverNow = new Date(AHORA).toISOString();
    // Sin compensar daría 0 (serverNow − clienteFin); con RTT 200 suma 100.
    expect(calcularOffset(serverNow, AHORA - 200, AHORA)).toBe(100);
  });

  it('relojes sincronizados: el servidor sella a mitad del viaje y el offset es 0', () => {
    const serverNow = new Date(AHORA - 100).toISOString();
    expect(calcularOffset(serverNow, AHORA - 200, AHORA)).toBe(0);
  });

  it('reloj local adelantado 10 min da un offset de unos −600 000 ms', () => {
    const serverNow = new Date(AHORA).toISOString();
    const local = AHORA + 600_000;
    expect(calcularOffset(serverNow, local - 200, local)).toBe(-599_900);
  });
});

describe('ahoraServidor', () => {
  it('suma el offset al reloj local', () => {
    expect(ahoraServidor(1_000, 250)).toBe(1_250);
  });

  it('Review Focus 4: reloj adelantado 10 min con offset −600 000 da la hora real y un pendiente de 1 min no es ámbar', () => {
    const relojLocal = AHORA + 600_000;
    const real = ahoraServidor(relojLocal, -600_000);
    expect(real).toBe(AHORA);
    expect(pendienteEsAmbar(pendienteHace(60_000), real)).toBe(false);
  });
});
