// Valores de prueba (~750 lugares): reemplazar por la plantilla real del salón.
import type { Plantilla, PlantillaFila } from '@/domain/plantilla';
import type { Seccion } from '@/domain/types';

const CANTIDAD_FILAS = 20;
const ANCHO: Record<Seccion, number> = { izquierda: 10, centro: 18, derecha: 10 };

function construir(seccion: Seccion, numero: number): PlantillaFila {
  const ancho = ANCHO[seccion];
  if (seccion === 'centro' && numero <= 2) {
    return { numero, tramos: [{ tipo: 'reservado', capacidad: ancho, etiqueta: 'Pastores' }] };
  }
  if (seccion === 'izquierda' && numero >= 3 && numero <= 6) {
    return {
      numero,
      tramos: [
        { tipo: 'publico', capacidad: 4 },
        { tipo: 'reservado', capacidad: 2, etiqueta: 'Mamás' },
        { tipo: 'publico', capacidad: 4 },
      ],
    };
  }
  if (seccion === 'derecha' && numero <= 2) {
    return {
      numero,
      tramos: [
        { tipo: 'reservado', capacidad: 4, etiqueta: 'Alabanza' },
        { tipo: 'publico', capacidad: ancho - 4 },
      ],
    };
  }
  return { numero, tramos: [{ tipo: 'publico', capacidad: ancho }] };
}

function seccionEjemplo(seccion: Seccion): PlantillaFila[] {
  return Array.from({ length: CANTIDAD_FILAS }, (_, i) => construir(seccion, i + 1));
}

export const PLANTILLA_EJEMPLO: Plantilla = {
  izquierda: seccionEjemplo('izquierda'),
  centro: seccionEjemplo('centro'),
  derecha: seccionEjemplo('derecha'),
};
