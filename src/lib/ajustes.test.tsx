// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { guardarAjuste, leerAjuste, olvidarAjustesEnMemoria, useAjusteBooleano } from './ajustes';

beforeEach(() => {
  localStorage.clear();
  olvidarAjustesEnMemoria();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ajustes locales', () => {
  it('devuelve el valor por defecto y persiste los cambios', () => {
    const { result } = renderHook(() => useAjusteBooleano('t.pico', false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('t.pico')).toBe('true');
  });

  it('lee lo que ya estaba guardado', () => {
    localStorage.setItem('t.sonido', 'false');
    const { result } = renderHook(() => useAjusteBooleano('t.sonido', true));
    expect(result.current[0]).toBe(false);
  });

  it('con localStorage bloqueado sigue funcionando en memoria y no lanza', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(leerAjuste('t.x')).toBeNull();
    const { result } = renderHook(() => useAjusteBooleano('t.x', false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(() => guardarAjuste('t.x', 'false')).not.toThrow();
  });
});
