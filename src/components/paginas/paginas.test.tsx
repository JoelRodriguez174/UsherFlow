// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const llamarRpc = vi.fn();
const leerAcceso = vi.fn();
const mandar = vi.fn();
let contexto: Record<string, unknown>;

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));
vi.mock('@/lib/acceso', () => ({
  leerAcceso: () => leerAcceso(),
  guardarAcceso: vi.fn(),
  armarEnlace: (origen: string, k: string, rol: string) => `${origen}/entrar?k=${k}&rol=${rol}`,
}));
vi.mock('@/state/SalonProvider', () => ({
  SalonProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSalon: () => contexto,
  useTick: () => 1_000_000,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { olvidarAjustesEnMemoria } from '@/lib/ajustes';
import { PuertaPagina } from './PuertaPagina';
import { SeccionPagina } from './SeccionPagina';
import { SedePagina } from './SedePagina';
import SeccionRoute from '@/app/seccion/[seccion]/page';

const resumen = { libres: 10, grupoMaxJunto: 4 };
function armarContexto(extra: Record<string, unknown> = {}) {
  return {
    derivado: {
      filasPorSeccion: { izquierda: [], centro: [], derecha: [] },
      resumenPorSeccion: { izquierda: resumen, centro: resumen, derecha: resumen },
      resumenParaSede: () => ({ izquierda: resumen, centro: resumen, derecha: resumen }),
      sedes: [],
      liberado: false,
      pendientesPorSeccion: { izquierda: [], centro: [], derecha: [] },
      ocupacion: { ocupados: 5, capacidad: 50, porcentaje: 10 },
    },
    filas: {},
    offsetMs: 0,
    conexion: 'connected',
    error: null,
    claveInvalida: false,
    cargando: false,
    acciones: { mandar, agregarFila: vi.fn() },
    limpiarError: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  olvidarAjustesEnMemoria();
  contexto = armarContexto();
  leerAcceso.mockReturnValue({ clave: 'SUPER1', rol: 'supervisor' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('estados comunes', () => {
  it('con la clave inválida muestra "Pedí un QR nuevo" y no la vista del rol', () => {
    contexto = armarContexto({ claveInvalida: true });
    render(<PuertaPagina />);
    expect(screen.getByRole('heading', { name: 'Pedí un QR nuevo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Puerta' })).toBeNull();
  });

  it('mientras carga muestra un estado de espera con un solo <main>', () => {
    contexto = armarContexto({ cargando: true });
    const { container } = render(<PuertaPagina />);
    expect(screen.getByText(/Cargando el salón/)).toBeTruthy();
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('clave inválida según el rol', () => {
  it('el pastor de sede no ve "escaneá un QR": se le dice que abra de nuevo el enlace del supervisor', () => {
    leerAcceso.mockReturnValue(null);
    render(<SedePagina />);
    expect(screen.getByRole('heading', { name: 'Pedí un QR nuevo' })).toBeTruthy();
    expect(screen.queryByText(/escanealo|QR actual/i)).toBeNull();
    expect(screen.getByText(/Abrí de nuevo el enlace que te mandó el supervisor/)).toBeTruthy();
  });

  it('el ujier sigue viendo la indicación del QR', () => {
    contexto = armarContexto({ claveInvalida: true });
    render(<PuertaPagina />);
    expect(screen.getByText(/escanealo con la cámara/)).toBeTruthy();
  });
});

describe('PuertaPagina', () => {
  it('arma la vista de la Puerta, con un solo <main> y el encabezado semántico', () => {
    const { container } = render(<PuertaPagina />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Puerta' })).toBeTruthy();
    expect(screen.getByText('Conectado')).toBeTruthy();
  });

  it('muestra el error del salón en el encabezado', () => {
    contexto = armarContexto({ error: 'Sin conexión: no se pudo guardar.' });
    render(<PuertaPagina />);
    expect(screen.getByRole('alert').textContent).toContain('Sin conexión');
  });

  it('manda el grupo con acciones.mandar', async () => {
    const user = userEvent.setup();
    mandar.mockResolvedValue({ ok: true });
    render(<PuertaPagina />);
    await user.click(screen.getByRole('button', { name: /Mandar 2 al Centro/ }));
    expect(mandar).toHaveBeenCalledWith('centro', 2, null);
  });

  it('el modo pico se activa desde el encabezado y se recuerda en localStorage', async () => {
    const user = userEvent.setup();
    contexto = armarContexto({
      derivado: {
        ...armarContexto().derivado,
        pendientesPorSeccion: {
          izquierda: [],
          derecha: [],
          centro: [{ pendiente: { id: 'p', seccion: 'centro', cantidad: 2, creadoEn: 'x' }, ambar: false }],
        },
      },
    });
    render(<PuertaPagina />);
    expect(screen.getByText('1 sin confirmar')).toBeTruthy();
    const boton = screen.getByRole('button', { name: 'Hora pico' });
    expect(boton.getAttribute('aria-pressed')).toBe('false');
    await user.click(boton);
    expect(boton.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('usherflow.modoPico')).toBe('true');
    expect(screen.queryByText('1 sin confirmar')).toBeNull();
  });

  it('el interruptor de sonido informa al módulo de audio y se recuerda', async () => {
    const user = userEvent.setup();
    render(<PuertaPagina />);
    const boton = screen.getByRole('button', { name: 'Sonido' });
    expect(boton.getAttribute('aria-pressed')).toBe('true');
    await user.click(boton);
    expect(boton.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('usherflow.sonido')).toBe('false');
  });
});

describe('SeccionPagina', () => {
  it('muestra la sección pedida', () => {
    const { container } = render(<SeccionPagina seccion="derecha" />);
    expect(screen.getByRole('heading', { name: 'Sección Derecha' })).toBeTruthy();
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('vibra cuando llega un grupo nuevo a la sección, pero no con la carga inicial', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const vista = (id: string) => ({ pendiente: { id, seccion: 'centro', cantidad: 2, creadoEn: '2026-10-22T20:00:00Z' }, ambar: false });
    const conPendientes = (ids: string[]) =>
      armarContexto({
        derivado: {
          ...armarContexto().derivado,
          pendientesPorSeccion: { izquierda: [], derecha: [], centro: ids.map(vista) },
        },
      });

    contexto = conPendientes(['a']);
    const { rerender } = render(<SeccionPagina seccion="centro" />);
    expect(vibrate).not.toHaveBeenCalled();

    contexto = conPendientes(['a', 'b']);
    rerender(<SeccionPagina seccion="centro" />);
    expect(vibrate).toHaveBeenCalledTimes(1);

    contexto = conPendientes(['b']);
    rerender(<SeccionPagina seccion="centro" />);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});

describe('ruta /seccion/[seccion]', () => {
  it('una sección desconocida da 404', async () => {
    await expect(SeccionRoute({ params: Promise.resolve({ seccion: 'balcon' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each(['izquierda', 'centro', 'derecha'])('acepta %s', async (seccion) => {
    const elemento = await SeccionRoute({ params: Promise.resolve({ seccion }) });
    expect(elemento.props.seccion).toBe(seccion);
  });
});
