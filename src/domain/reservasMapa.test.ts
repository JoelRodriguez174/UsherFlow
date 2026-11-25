import { describe, expect, it } from 'vitest';
import {
  acotarCantidad,
  estadoSectorReserva,
  filasParaGuardar,
  hayCambiosEnSesion,
  libresDelSector,
  resumenSesion,
} from './reservasMapa';

describe('reservasMapa', () => {
  it('calcula los libres restantes sin bajar de cero', () => {
    expect(libresDelSector(20, 8)).toBe(12);
    expect(libresDelSector(5, 9)).toBe(0);
    expect(libresDelSector(10, -2)).toBe(10);
  });

  it('determina el estado visual del sector según disponibles, capacidad y elección propia', () => {
    expect(estadoSectorReserva(20, 20, 0)).toBe('disponible');
    expect(estadoSectorReserva(4, 20, 0)).toBe('pocos');
    expect(estadoSectorReserva(5, 20, 0)).toBe('disponible');
    expect(estadoSectorReserva(0, 20, 0)).toBe('agotado');
    expect(estadoSectorReserva(0, 20, 5)).toBe('asignado');
    expect(estadoSectorReserva(15, 20, 3)).toBe('asignado');
  });

  it('acota cantidades al rango válido [0, disponibles]', () => {
    expect(acotarCantidad(12, 10)).toBe(10);
    expect(acotarCantidad(-3, 10)).toBe(0);
    expect(acotarCantidad(4.9, 10)).toBe(4);
    expect(acotarCantidad(Number.NaN, 10)).toBe(0);
  });

  it('detecta diferencias entre lo confirmado y el borrador', () => {
    expect(hayCambiosEnSesion({ 1: 4 }, { 1: 4, 2: 0 })).toBe(false);
    expect(hayCambiosEnSesion({ 1: 4 }, { 1: 6 })).toBe(true);
    expect(hayCambiosEnSesion({}, { 2: 3 })).toBe(true);
    expect(hayCambiosEnSesion({ 1: 4 }, { 1: 0 })).toBe(true);
  });

  it('resume total de lugares y cantidad de sectores elegidos', () => {
    expect(resumenSesion({ 1: 10, 2: 0, 3: 5 })).toEqual({ totalLugares: 15, cantidadSectores: 2 });
    expect(resumenSesion({})).toEqual({ totalLugares: 0, cantidadSectores: 0 });
  });

  it('arma las filas para guardar_reservas_sede omitiendo los sectores en cero', () => {
    const sectores = [
      { id: 1, seccion: 'izquierda' as const, nombre: 'Izquierda A' },
      { id: 2, seccion: 'centro' as const, nombre: 'Centro A' },
    ];
    expect(filasParaGuardar(sectores, 'Domingo 10', { 1: 0, 2: 12 })).toEqual([
      { seccion: 'centro', sesion: 'Domingo 10', cantidad: 12, sector: 'Centro A' },
    ]);
  });
});
