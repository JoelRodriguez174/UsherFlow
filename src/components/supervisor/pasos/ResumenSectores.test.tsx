// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Fila, Seccion } from '@/domain/types';
import { ResumenSectores } from './ResumenSectores';

const fila = (seccion: Seccion, numero: number, publico: number, reservado = 0): Fila => ({
  id: numero + (seccion === 'centro' ? 100 : 0),
  seccion,
  numero,
  fragmentada: false,
  verificadaEn: null,
  tramos: [
    { id: 1, orden: 1, tipo: 'publico', capacidad: publico, ocupados: 0, etiqueta: null },
    ...(reservado ? [{ id: 2, orden: 2, tipo: 'reservado' as const, capacidad: reservado, ocupados: 0, etiqueta: 'Mamás' }] : []),
  ],
});

afterEach(cleanup);

describe('ResumenSectores', () => {
  it('suma la capacidad pública de las filas del rango (sin tramos reservados)', () => {
    const filas = Array.from({ length: 10 }, (_, i) => fila('centro', i + 1, 8, 2));
    render(<ResumenSectores sectores={[{ seccion: 'centro', nombre: 'Sector A', desde: 1, hasta: 8 }]} filas={filas} />);
    expect(screen.getByText('Sector A: filas 1 a 8 · 64 lugares')).toBeTruthy();
  });

  it('marca en advertencia las filas de la sección que quedan fuera de todo sector', () => {
    const filas = [1, 2, 3, 4].map((n) => fila('centro', n, 5));
    render(<ResumenSectores sectores={[{ seccion: 'centro', nombre: 'Sector A', desde: 1, hasta: 2 }]} filas={filas} />);
    const aviso = screen.getByText(/sin sector/i);
    expect(aviso.textContent).toContain('3, 4');
    expect(aviso.className).toContain('text-advertencia');
    expect(screen.getByText('Sector A: filas 1 a 2 · 10 lugares').className).not.toContain('text-advertencia');
  });

  it('no marca nada si todas las filas están cubiertas; una sección con filas y sin sectores sí se marca', () => {
    const filas = [fila('centro', 1, 5), fila('derecha', 1, 5)];
    const sectores = [{ seccion: 'centro' as const, nombre: 'Único', desde: 1, hasta: 1 }];
    const { rerender } = render(<ResumenSectores sectores={sectores} filas={[filas[0]]} />);
    expect(screen.queryByText(/sin sector/i)).toBeNull();
    rerender(<ResumenSectores sectores={sectores} filas={filas} />);
    expect(screen.getByText('Filas sin sector: 1').className).toContain('text-advertencia');
  });
});
