'use client';

import { useCallback, useState } from 'react';
import { ClaveInvalidaError, llamarRpc, mensajeDeError, type ResultadoRpc } from '@/lib/rpc';

export type Mensaje = { tipo: 'info' | 'error'; texto: string } | null;

/** Llamadas a RPC como supervisor, con el aviso de error que muestran los paneles de cada paso. */
export function useRpcSupervisor(clave: string) {
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  /** Devuelve la respuesta (también la de error de negocio) o null si falló la red. */
  const llamar = useCallback(
    async (rpc: string, params: Record<string, unknown> = {}): Promise<ResultadoRpc | null> => {
      try {
        return await llamarRpc(rpc, { p_clave: clave, ...params });
      } catch (e) {
        setMensaje({ tipo: 'error', texto: mensajeDeError(e instanceof ClaveInvalidaError ? 'CLAVE_INVALIDA' : 'ERROR_DE_RED') });
        return null;
      }
    },
    [clave],
  );

  /** Como `llamar`, pero un `success:false` deja el aviso de error y devuelve null. */
  const llamarOk = useCallback(
    async (rpc: string, params: Record<string, unknown> = {}): Promise<ResultadoRpc | null> => {
      const res = await llamar(rpc, params);
      if (res && !res.success) {
        setMensaje({ tipo: 'error', texto: mensajeDeError(String(res.error)) });
        return null;
      }
      return res;
    },
    [llamar],
  );

  return { llamar, llamarOk, mensaje, setMensaje };
}
