import { describe, expect, it } from 'vitest';
import { aLocalAr, deLocalAr, mostrarHora } from './fechas';

describe('fechas (hora de Argentina)', () => {
  it('deLocalAr agrega el offset -03:00', () => {
    expect(deLocalAr('2026-11-02T20:00')).toBe('2026-11-02T20:00:00-03:00');
  });

  it('aLocalAr pasa un instante UTC a hora de Argentina para datetime-local', () => {
    expect(aLocalAr('2026-11-01T21:30:00Z')).toBe('2026-11-01T18:30');
  });

  it('deLocalAr y aLocalAr son inversas', () => {
    expect(aLocalAr(deLocalAr('2026-03-05T09:15'))).toBe('2026-03-05T09:15');
  });

  it('mostrarHora formatea en Argentina sin depender de la zona del navegador', () => {
    const texto = mostrarHora('2026-10-25T13:00:00Z');
    expect(texto).toContain('10:00');
  });
});
