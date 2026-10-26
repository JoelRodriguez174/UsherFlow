// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const replace = vi.fn();
let consulta = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(consulta),
}));

import { leerAcceso } from '@/lib/acceso';
import EntrarPage from './page';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe('/entrar', () => {
  it('con k y rol=centro guarda el acceso y navega a /seccion/centro', () => {
    consulta = 'k=abc&rol=centro';
    render(<EntrarPage />);
    expect(leerAcceso()).toEqual({ clave: 'abc', rol: 'centro' });
    expect(replace).toHaveBeenCalledWith('/seccion/centro');
  });

  it('rol=puerta va a /puerta y rol=supervisor va a /supervisor', () => {
    consulta = 'k=abc&rol=puerta';
    const primero = render(<EntrarPage />);
    expect(replace).toHaveBeenLastCalledWith('/puerta');
    primero.unmount();

    consulta = 'k=xyz&rol=supervisor';
    render(<EntrarPage />);
    expect(replace).toHaveBeenLastCalledWith('/supervisor');
    expect(leerAcceso()).toEqual({ clave: 'xyz', rol: 'supervisor' });
  });

  it('rol=sede guarda el acceso y va a /sede', () => {
    consulta = 'k=pastor&rol=sede';
    render(<EntrarPage />);
    expect(leerAcceso()).toEqual({ clave: 'pastor', rol: 'sede' });
    expect(replace).toHaveBeenCalledWith('/sede');
  });

  it('con un rol inválido muestra el error y no guarda ni navega', () => {
    consulta = 'k=abc&rol=xyz';
    render(<EntrarPage />);
    expect(screen.getByRole('alert').textContent).toMatch(/QR/);
    expect(replace).not.toHaveBeenCalled();
    expect(leerAcceso()).toBeNull();
  });

  it('sin k muestra el error y no navega', () => {
    consulta = 'rol=centro';
    render(<EntrarPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(leerAcceso()).toBeNull();
  });

  it('sin rol tampoco navega', () => {
    consulta = 'k=abc';
    render(<EntrarPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
