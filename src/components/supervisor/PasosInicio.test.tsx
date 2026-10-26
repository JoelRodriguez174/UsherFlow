// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASOS, type Paso } from '@/domain/preparacion';

const usePreparacion = vi.fn();
vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));

import { PasosInicio } from './PasosInicio';

const paso = (id: Paso['id'], extra: Partial<Paso> = {}): Paso => ({
  ...PASOS.find((p) => p.id === id)!,
  completo: false,
  bloqueado: false,
  resumen: 'Sin datos',
  requisitos: [],
  avisos: [],
  ...extra,
});

const pasos: Paso[] = [
  paso('salon', { completo: true, resumen: '2 sectores · 80 lugares', requisitos: [{ texto: 'Filas cargadas en el salón', ok: true }] }),
  paso('sesiones', {
    resumen: 'Sin sesiones',
    requisitos: [{ texto: 'Al menos una sesión', ok: false, ejemplo: 'Jueves 19:00' }],
  }),
  paso('sedes', { bloqueado: true, motivoBloqueo: 'Se abre al completar Sesiones' }),
  paso('reservas', { bloqueado: true, motivoBloqueo: 'Se abre al completar Sesiones' }),
  paso('qr', { completo: true, avisos: ['Algo para revisar'] }),
  paso('revision', { bloqueado: true, motivoBloqueo: 'Se abre al completar Sesiones' }),
];

const listo = (p = pasos) => usePreparacion.mockReturnValue({ estado: 'listo', pasos: p, recargar: vi.fn() });

afterEach(() => {
  cleanup();
  usePreparacion.mockReset();
});

const titulo = (t: string) => screen.getByText(t, { selector: 'summary span' });
const detalle = (t: string) => titulo(t).closest('details')!;

describe('PasosInicio', () => {
  it('cuenta los pasos listos y muestra un desplegable cerrado por paso', () => {
    listo();
    render(<PasosInicio />);
    expect(screen.getByText('2 de 6 pasos listos')).toBeTruthy();
    const todos = document.querySelectorAll('details');
    expect(todos).toHaveLength(6);
    todos.forEach((d) => expect(d.open).toBe(false));
  });

  it('cada paso muestra número, título, estado accesible (después del título) y resumen', () => {
    listo();
    render(<PasosInicio />);
    const resumenSalon = detalle('Salón').querySelector('summary')!;
    expect(resumenSalon.textContent).toMatch(/^1 Salón Listo/);
    const salon = detalle('Salón');
    expect(within(salon).getByText('Listo')).toBeTruthy();
    expect(within(salon).getByText('2 sectores · 80 lugares')).toBeTruthy();
    expect(within(detalle('Sesiones')).getByText('Pendiente')).toBeTruthy();
    expect(within(detalle('Sedes')).getByText('Bloqueado')).toBeTruthy();
    // completo pero con avisos: amarillo
    expect(within(detalle('QR de ujieres')).getByText('Con avisos')).toBeTruthy();
  });

  it('al abrirlo lista requisitos con su estado, el ejemplo y los avisos', async () => {
    listo();
    render(<PasosInicio />);
    await userEvent.click(titulo('Sesiones'));
    const d = detalle('Sesiones');
    expect(d.open).toBe(true);
    const item = within(d).getByText('Al menos una sesión').closest('li')!;
    expect(within(item).getByText('Falta')).toBeTruthy();
    expect(within(item).getByText('Ejemplo: Jueves 19:00')).toBeTruthy();
    expect(within(detalle('Salón')).getByText('Filas cargadas en el salón').closest('li')!.textContent).toContain('Cumplido');
    expect(within(detalle('QR de ujieres')).getByText('Algo para revisar')).toBeTruthy();
  });

  it('"Completar este paso" es un enlace a la ruta del paso', () => {
    listo();
    render(<PasosInicio />);
    const enlace = within(detalle('Sesiones')).getByRole('link', { name: /completar este paso/i });
    expect(enlace.getAttribute('href')).toBe('/supervisor/sesiones');
  });

  it('un paso bloqueado se abre pero su acción está deshabilitada y dice por qué', () => {
    listo();
    render(<PasosInicio />);
    const d = detalle('Sedes');
    expect(within(d).queryByRole('link')).toBeNull();
    expect((within(d).getByRole('button', { name: /completar este paso/i }) as HTMLButtonElement).disabled).toBe(true);
    const motivo = within(d).getByText('Se abre al completar Sesiones');
    expect(within(d).getByRole('button').getAttribute('aria-describedby')).toBe(motivo.id);
  });

  it('en error ningún paso muestra listo y se puede reintentar', async () => {
    const recargar = vi.fn();
    usePreparacion.mockReturnValue({ estado: 'error', pasos: pasos.map((p) => ({ ...p, completo: true })), recargar });
    render(<PasosInicio />);
    expect(screen.queryByText('Listo')).toBeNull();
    expect(screen.queryByText(/pasos listos/)).toBeNull();
    expect(screen.queryByText('Bloqueado')).toBeNull();
    expect(screen.getAllByText('Sin revisar')).toHaveLength(6);
    expect(screen.queryByText('Se abre al completar Sesiones')).toBeNull();
    expect(screen.getByText('No pudimos revisar el estado')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('mientras carga avisa y no cuenta nada', () => {
    usePreparacion.mockReturnValue({ estado: 'cargando', pasos, recargar: vi.fn() });
    render(<PasosInicio />);
    expect(screen.getByText('Cargando…')).toBeTruthy();
    expect(screen.queryByText('Listo')).toBeNull();
    expect(screen.queryByText(/pasos listos/)).toBeNull();
    expect(screen.getAllByText('Sin revisar')).toHaveLength(6);
  });
});
