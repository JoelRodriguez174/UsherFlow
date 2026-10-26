// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armarEnlace, guardarAcceso, leerAcceso } from './acceso';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('acceso', () => {
  it('leerAcceso devuelve null sin datos', () => {
    expect(leerAcceso()).toBeNull();
  });

  it('guardarAcceso + leerAcceso hacen ida y vuelta', () => {
    guardarAcceso('clave-1', 'centro');
    expect(leerAcceso()).toEqual({ clave: 'clave-1', rol: 'centro' });
  });

  it('acepta el rol sede', () => {
    guardarAcceso('clave-2', 'sede');
    expect(leerAcceso()).toEqual({ clave: 'clave-2', rol: 'sede' });
  });

  it('un valor corrupto o con rol inválido da null', () => {
    sessionStorage.setItem('usherflow.acceso', '{no es json');
    expect(leerAcceso()).toBeNull();
    sessionStorage.setItem('usherflow.acceso', JSON.stringify({ clave: 'k', rol: 'rey' }));
    expect(leerAcceso()).toBeNull();
    sessionStorage.setItem('usherflow.acceso', JSON.stringify({ clave: '', rol: 'puerta' }));
    expect(leerAcceso()).toBeNull();
  });

  it('si sessionStorage lanza, no revienta', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => guardarAcceso('k', 'puerta')).not.toThrow();
    expect(leerAcceso()).toBeNull();
  });

  it('armarEnlace produce /entrar?k=<clave>&rol=centro', () => {
    expect(armarEnlace('https://usherflow.app', 'abc123', 'centro')).toBe(
      'https://usherflow.app/entrar?k=abc123&rol=centro',
    );
  });

  it('armarEnlace escapa la clave', () => {
    expect(armarEnlace('http://x', 'a b&c', 'supervisor')).toBe('http://x/entrar?k=a%20b%26c&rol=supervisor');
  });
});
