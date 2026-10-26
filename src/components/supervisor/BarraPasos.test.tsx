// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { PASOS, type Paso } from '@/domain/preparacion';

const usePreparacion = vi.fn();
vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));

import { BarraPasos } from './BarraPasos';

const pasos: Paso[] = PASOS.map((p, i) => ({
  ...p,
  completo: i === 0,
  bloqueado: i >= 3,
  resumen: '',
  requisitos: [],
  avisos: [],
}));

afterEach(() => {
  cleanup();
  usePreparacion.mockReset();
});

describe('BarraPasos', () => {
  it('muestra un enlace por paso y marca el actual con aria-current="step"', () => {
    usePreparacion.mockReturnValue({ estado: 'listo', pasos, recargar: vi.fn() });
    render(<BarraPasos actual="sesiones" />);
    const nav = screen.getByRole('navigation', { name: 'Pasos' });
    const enlaces = within(nav).getAllByRole('link');
    expect(enlaces).toHaveLength(6);
    expect(enlaces[1].getAttribute('href')).toBe('/supervisor/sesiones');
    expect(enlaces.filter((e) => e.getAttribute('aria-current') === 'step')).toEqual([enlaces[1]]);
  });

  it('cada chip lleva su estado como texto accesible', () => {
    usePreparacion.mockReturnValue({ estado: 'listo', pasos, recargar: vi.fn() });
    render(<BarraPasos actual="salon" />);
    const enlaces = screen.getAllByRole('link');
    expect(within(enlaces[0]).getByText('Listo')).toBeTruthy();
    expect(within(enlaces[1]).getByText('Pendiente')).toBeTruthy();
    expect(within(enlaces[3]).getByText('Bloqueado')).toBeTruthy();
  });

  it('si no se pudo revisar, ningún chip dice listo', () => {
    usePreparacion.mockReturnValue({ estado: 'error', pasos, recargar: vi.fn() });
    render(<BarraPasos actual="salon" />);
    expect(screen.queryByText('Listo')).toBeNull();
  });
});
