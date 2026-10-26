// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASOS, type Paso } from '@/domain/preparacion';

const usePreparacion = vi.fn();
vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));

import { MarcoPaso } from './MarcoPaso';

const armar = (extra: Record<string, Partial<Paso>> = {}): Paso[] =>
  PASOS.map((p) => ({
    ...p,
    completo: false,
    bloqueado: false,
    resumen: '',
    requisitos: [],
    avisos: [],
    ...extra[p.id],
  }));

const listo = (extra?: Record<string, Partial<Paso>>) =>
  usePreparacion.mockReturnValue({ estado: 'listo', pasos: armar(extra), recargar: vi.fn() });

afterEach(() => {
  cleanup();
  usePreparacion.mockReset();
});

describe('MarcoPaso', () => {
  it('muestra la barra y el contenido del paso', () => {
    listo({ salon: { completo: true } });
    render(<MarcoPaso paso="salon"><p>formulario del salón</p></MarcoPaso>);
    expect(screen.getByRole('navigation', { name: 'Pasos' })).toBeTruthy();
    expect(screen.getByText('formulario del salón')).toBeTruthy();
  });

  it('un paso bloqueado no renderiza el contenido y manda al paso que lo bloquea', () => {
    listo({ sedes: { bloqueado: true, bloqueadoPor: 'salon', motivoBloqueo: 'texto que no se parsea' } });
    render(<MarcoPaso paso="sedes"><p>formulario de sedes</p></MarcoPaso>);
    expect(screen.queryByText('formulario de sedes')).toBeNull();
    expect(screen.getByText('Completá Salón primero')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a Salón' }).getAttribute('href')).toBe('/supervisor/salon');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('nombra el paso que dice bloqueadoPor (Revisión apunta al primero que falta, no a QR)', () => {
    listo({ revision: { bloqueado: true, bloqueadoPor: 'sesiones' } });
    render(<MarcoPaso paso="revision"><p>x</p></MarcoPaso>);
    expect(screen.getByRole('link', { name: 'Ir a Sesiones' }).getAttribute('href')).toBe('/supervisor/sesiones');
  });

  it('"Siguiente" queda deshabilitado con el motivo mientras el paso no está completo', () => {
    listo({ salon: { requisitos: [{ texto: 'Filas cargadas', ok: false }, { texto: 'Sectores', ok: true }] } });
    render(<MarcoPaso paso="salon"><p>x</p></MarcoPaso>);
    const boton = screen.getByRole('button', { name: 'Siguiente: Sesiones' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(screen.getByText('Falta: Filas cargadas')).toBeTruthy();
    expect(boton.getAttribute('aria-describedby')).toBe(screen.getByText('Falta: Filas cargadas').id);
    expect(screen.queryByRole('link', { name: /siguiente/i })).toBeNull();
  });

  it('con el paso completo (aunque tenga avisos) "Siguiente" es un enlace al paso que sigue', () => {
    listo({ salon: { completo: true, avisos: ['ojo'] } });
    render(<MarcoPaso paso="salon"><p>x</p></MarcoPaso>);
    expect(screen.getByRole('link', { name: 'Siguiente: Sesiones' }).getAttribute('href')).toBe('/supervisor/sesiones');
  });

  it('el último paso no tiene "Siguiente"', () => {
    listo({ revision: { completo: true } });
    render(<MarcoPaso paso="revision"><p>x</p></MarcoPaso>);
    expect(screen.queryByText(/siguiente/i)).toBeNull();
  });

  it('cargando muestra "Cargando…" sin el contenido', () => {
    usePreparacion.mockReturnValue({ estado: 'cargando', pasos: armar(), recargar: vi.fn() });
    render(<MarcoPaso paso="salon"><p>formulario</p></MarcoPaso>);
    expect(screen.getByText('Cargando…')).toBeTruthy();
    expect(screen.queryByText('formulario')).toBeNull();
  });

  it('en error ofrece reintentar y no muestra el contenido', async () => {
    const recargar = vi.fn();
    usePreparacion.mockReturnValue({ estado: 'error', pasos: armar(), recargar });
    render(<MarcoPaso paso="salon"><p>formulario</p></MarcoPaso>);
    expect(screen.getByText('No pudimos revisar el estado')).toBeTruthy();
    expect(screen.queryByText('formulario')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('en error el paso QR conserva su contenido junto al aviso de error', () => {
    usePreparacion.mockReturnValue({ estado: 'error', pasos: armar(), recargar: vi.fn() });
    render(<MarcoPaso paso="qr"><p>enlaces</p></MarcoPaso>);
    expect(screen.getByText('No pudimos revisar el estado')).toBeTruthy();
    expect(screen.getByText('enlaces')).toBeTruthy();
  });

  it('muestra los avisos de su paso una sola vez y no los de otros', () => {
    listo({ sesiones: { avisos: ['La sesión Jueves ya empezó'] }, sedes: { avisos: ['aviso de sedes'] } });
    render(<MarcoPaso paso="sesiones"><p>x</p></MarcoPaso>);
    expect(screen.getAllByText('La sesión Jueves ya empezó')).toHaveLength(1);
    expect(screen.queryByText('aviso de sedes')).toBeNull();
  });

  it('sin avisos no muestra la lista, ni en error ni en Revisión (que ya los detalla)', () => {
    listo();
    const { unmount } = render(<MarcoPaso paso="sesiones"><p>x</p></MarcoPaso>);
    expect(screen.queryByRole('list', { name: 'Avisos' })).toBeNull();
    unmount();
    usePreparacion.mockReturnValue({ estado: 'error', pasos: armar({ sesiones: { avisos: ['a'] } }), recargar: vi.fn() });
    const e = render(<MarcoPaso paso="sesiones"><p>x</p></MarcoPaso>);
    expect(screen.queryByText('a')).toBeNull();
    e.unmount();
    listo({ revision: { avisos: ['agregado de Revisión'] } });
    render(<MarcoPaso paso="revision"><p>x</p></MarcoPaso>);
    expect(screen.queryByText('agregado de Revisión')).toBeNull();
  });
});
