// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import { IngresarSede } from './IngresarSede';

const fetchMock = vi.fn();

beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respJson(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('IngresarSede', () => {
  it('muestra error claro cuando el email no está autorizado', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValueOnce(
      respJson({ ok: false, error: 'NO_AUTORIZADO', mensaje: 'Este email no está autorizado para ninguna sede.' }, 403),
    );

    render(<IngresarSede />);
    await user.type(screen.getByLabelText('Email'), 'intruso@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect((await screen.findByRole('alert')).textContent).toContain('no está autorizado');
    expect(replace).not.toHaveBeenCalled();
  });

  it('primera activación: email -> código de 6 dígitos (auto-envío) -> definir contraseña -> redirige a /sede', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(respJson({ ok: true, paso: 'codigo_activacion' }))
      .mockReturnValueOnce(respJson({ ok: true, requiereContrasena: true }))
      .mockReturnValueOnce(respJson({ ok: true }));

    render(<IngresarSede />);
    await user.type(screen.getByLabelText('Email'), 'pastor@iglesia.org');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    const inputCod = await screen.findByLabelText('Código de 6 dígitos');
    expect((screen.getByRole('button', { name: /Reenviar código en \d+s/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(inputCod, '482910');

    const nueva = await screen.findByLabelText('Nueva contraseña');
    await user.type(nueva, 'mi-clave-segura');
    await user.type(screen.getByLabelText('Repetí la contraseña'), 'mi-clave-segura');
    await user.click(screen.getByRole('button', { name: 'Guardar y entrar al mapa' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sede'));
  });

  it('cuenta activa: email -> contraseña (con mostrar/ocultar) -> código 2FA -> redirige directo a /sede', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(respJson({ ok: true, paso: 'contrasena' }))
      .mockReturnValueOnce(respJson({ ok: true, paso: 'codigo_2fa' }))
      .mockReturnValueOnce(respJson({ ok: true, requiereContrasena: false }));

    render(<IngresarSede />);
    await user.type(screen.getByLabelText('Email'), 'pastor@iglesia.org');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    const inputPass = await screen.findByLabelText('Contraseña');
    expect(inputPass.getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(inputPass.getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(inputPass.getAttribute('type')).toBe('password');

    await user.type(inputPass, 'mi-clave-segura');
    await user.click(screen.getByRole('button', { name: 'Ingresar y enviar código' }));

    await user.type(await screen.findByLabelText('Código de 6 dígitos'), '123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sede'));
  });
});
