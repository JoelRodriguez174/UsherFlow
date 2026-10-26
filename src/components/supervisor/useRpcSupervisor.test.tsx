// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { ClaveInvalidaError } from '@/lib/rpc';
import { useRpcSupervisor } from './useRpcSupervisor';

afterEach(() => {
  cleanup();
  llamarRpc.mockReset();
});

describe('useRpcSupervisor', () => {
  it('llamar antepone p_clave y devuelve la respuesta, también la de error de negocio', async () => {
    llamarRpc.mockResolvedValueOnce({ success: false, error: 'X' });
    const { result } = renderHook(() => useRpcSupervisor('SUPER1'));
    let res;
    await act(async () => {
      res = await result.current.llamar('guardar_sesion', { p_nombre: 'Jueves' });
    });
    expect(llamarRpc).toHaveBeenCalledWith('guardar_sesion', { p_clave: 'SUPER1', p_nombre: 'Jueves' });
    expect(res).toEqual({ success: false, error: 'X' });
    expect(result.current.mensaje).toBeNull();
  });

  it('llamar deja un mensaje de error de red y devuelve null; clave inválida tiene el suyo', async () => {
    llamarRpc.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new ClaveInvalidaError());
    const { result } = renderHook(() => useRpcSupervisor('SUPER1'));
    await act(async () => {
      expect(await result.current.llamar('r')).toBeNull();
    });
    expect(result.current.mensaje).toEqual({ tipo: 'error', texto: 'msg:ERROR_DE_RED' });
    await act(async () => {
      expect(await result.current.llamar('r')).toBeNull();
    });
    expect(result.current.mensaje).toEqual({ tipo: 'error', texto: 'msg:CLAVE_INVALIDA' });
  });

  it('llamarOk convierte success:false en mensaje de error y null; success:true pasa', async () => {
    llamarRpc.mockResolvedValueOnce({ success: false, error: 'SESION_REPETIDA' }).mockResolvedValueOnce({ success: true, n: 1 });
    const { result } = renderHook(() => useRpcSupervisor('SUPER1'));
    await act(async () => {
      expect(await result.current.llamarOk('r')).toBeNull();
    });
    expect(result.current.mensaje).toEqual({ tipo: 'error', texto: 'msg:SESION_REPETIDA' });
    await act(async () => {
      expect(await result.current.llamarOk('r')).toEqual({ success: true, n: 1 });
    });
  });
});
