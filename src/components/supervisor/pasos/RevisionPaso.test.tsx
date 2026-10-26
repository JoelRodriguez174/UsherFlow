// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASOS, type Paso } from '@/domain/preparacion';

const usePreparacion = vi.fn();
vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));

// MarcoPaso (con su error/carga) tiene tests propios: acá solo importa lo que dibuja el paso.
vi.mock('@/components/supervisor/MarcoPaso', () => ({ MarcoPaso: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { RevisionPaso } from './RevisionPaso';

const base = (): Paso[] =>
  PASOS.map((p) => ({ ...p, completo: true, bloqueado: false, resumen: '', requisitos: [], avisos: [] }));
const montar = (pasos: Paso[], estado: 'cargando' | 'error' | 'listo' = 'listo') => {
  usePreparacion.mockReturnValue({ estado, pasos, recargar: vi.fn() });
  return render(<RevisionPaso />);
};
const fila = (titulo: string) => screen.getByRole('heading', { name: new RegExp(`^${titulo}:`) }).closest('li') as HTMLElement;

beforeEach(() => usePreparacion.mockReset());
afterEach(cleanup);

describe('RevisionPaso', () => {
  it('tiene su h1 y lista solo los 5 pasos anteriores, cada uno con su enlace', () => {
    montar(base());
    expect(screen.getByRole('heading', { level: 1, name: 'Revisión' })).toBeTruthy();
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('h2'));
    expect(items).toHaveLength(5);
    for (const p of PASOS.slice(0, 5)) {
      expect(within(fila(p.titulo)).getByRole('link').getAttribute('href')).toBe(p.ruta);
    }
  });

  it('marca ❌ el paso incompleto con sus requisitos faltantes, 🟡 el completo con avisos y ✅ el limpio', () => {
    const pasos = base();
    pasos[0] = { ...pasos[0], completo: false, requisitos: [{ texto: 'Filas cargadas', ok: false }, { texto: 'Sin pisarse', ok: true }] };
    pasos[1] = { ...pasos[1], avisos: ['Una sesión pronto'] };
    montar(pasos);
    expect(within(fila('Salón')).getByText(': Incompleto')).toBeTruthy();
    expect(within(fila('Salón')).getByText('Filas cargadas')).toBeTruthy();
    expect(within(fila('Salón')).queryByText('Sin pisarse')).toBeNull();
    expect(within(fila('Sesiones')).getByText(': Con avisos')).toBeTruthy();
    expect(within(fila('Sesiones')).getByText('Una sesión pronto')).toBeTruthy();
    expect(within(fila('Sedes')).getByText(': Listo')).toBeTruthy();
    expect(screen.queryByText('Todo listo')).toBeNull();
  });

  it('"Todo listo" cuando los 5 están completos, y aun así lista los avisos que queden', () => {
    const pasos = base();
    pasos[2] = { ...pasos[2], avisos: ['Sedes parecidas'] };
    montar(pasos);
    expect(screen.getByText('Todo listo')).toBeTruthy();
    expect(within(fila('Sedes')).getByText('Sedes parecidas')).toBeTruthy();
  });

  it('un paso incompleto impide "Todo listo" aunque Revisión misma figure completa', () => {
    const pasos = base();
    pasos[4] = { ...pasos[4], completo: false };
    montar(pasos);
    expect(screen.queryByText('Todo listo')).toBeNull();
  });

  it.each(['error', 'cargando'] as const)('con estado %s no muestra "Todo listo" ni nada engañoso', (estado) => {
    const { container } = montar(base(), estado);
    expect(screen.queryByText('Todo listo')).toBeNull();
    expect(container.textContent).toBe('Revisión'); // solo el título
  });
});
