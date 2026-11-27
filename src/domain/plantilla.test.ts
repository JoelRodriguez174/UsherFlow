import { describe, expect, it } from "vitest";
import { PLANTILLA_EJEMPLO } from "@/config/plantilla";
import {
  calcularNuevoSectorSinSolape,
  construirPlantillaUniforme,
  indicesConSolape,
  partirRango,
  validarPlantilla,
  type Plantilla,
} from "./plantilla";

function clonar(): Plantilla {
  return structuredClone(PLANTILLA_EJEMPLO);
}

describe("validarPlantilla", () => {
  it("acepta PLANTILLA_EJEMPLO", () => {
    expect(validarPlantilla(PLANTILLA_EJEMPLO)).toEqual([]);
  });

  it("rechaza capacidad <= 0", () => {
    const p = clonar();
    p.centro[0].tramos[0].capacidad = 0;
    const errores = validarPlantilla(p);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.some((e) => e.includes("capacidad"))).toBe(true);
  });

  it("rechaza números de fila repetidos en una sección", () => {
    const p = clonar();
    p.izquierda[1].numero = p.izquierda[0].numero;
    expect(validarPlantilla(p).some((e) => e.includes("repetido"))).toBe(true);
  });

  it("rechaza un tramo reservado sin etiqueta", () => {
    const p = clonar();
    p.centro[0].tramos[0] = { tipo: "reservado", capacidad: 8 };
    expect(validarPlantilla(p).some((e) => e.includes("etiqueta"))).toBe(true);
  });

  it("rechaza una fila sin tramos", () => {
    const p = clonar();
    p.derecha[0].tramos = [];
    expect(validarPlantilla(p).length).toBeGreaterThan(0);
  });
});

describe("partirRango", () => {
  it("reparte 1–20 en 2, 3 o 4 partes contiguas sin huecos", () => {
    expect(partirRango(1, 20, 2)).toEqual([[1, 10], [11, 20]]);
    expect(partirRango(1, 20, 3)).toEqual([[1, 6], [7, 13], [14, 20]]);
    expect(partirRango(1, 20, 4)).toEqual([[1, 5], [6, 10], [11, 15], [16, 20]]);
  });

  it("devuelve null si no alcanzan las filas para las partes pedidas", () => {
    expect(partirRango(1, 2, 3)).toBeNull();
    expect(partirRango(5, 4, 2)).toBeNull();
  });
});

describe("construirPlantillaUniforme", () => {
  it("genera filas públicas válidas según cantidad de filas y sillas por sección", () => {
    const p = construirPlantillaUniforme({
      izquierda: { filas: 5, sillas: 8 },
      centro: { filas: 10, sillas: 16 },
      derecha: { filas: 0, sillas: 8 },
    });
    expect(validarPlantilla(p)).toEqual([]);
    expect(p.izquierda).toHaveLength(5);
    expect(p.izquierda[0]).toEqual({ numero: 1, tramos: [{ tipo: "publico", capacidad: 8 }] });
    expect(p.centro).toHaveLength(10);
    expect(p.centro[9].tramos[0].capacidad).toBe(16);
    expect(p.derecha).toEqual([]);
  });
});

describe("calcularNuevoSectorSinSolape", () => {
  it("usa el primer hueco libre cuando hay filas sin cubrir", () => {
    const res = calcularNuevoSectorSinSolape([{ desde: 1, hasta: 2 }, { desde: 5, hasta: 6 }], 1, 6);
    expect(res).toEqual({ nuevo: { desde: 3, hasta: 4 }, indiceRecortar: null, nuevoHastaRecortado: null });
  });

  it("parte el último sector con >=2 filas cuando ya está todo cubierto", () => {
    const res = calcularNuevoSectorSinSolape(
      [{ desde: 1, hasta: 2 }, { desde: 3, hasta: 4 }, { desde: 5, hasta: 6 }],
      1,
      6,
    );
    expect(res).toEqual({ nuevo: { desde: 6, hasta: 6 }, indiceRecortar: 2, nuevoHastaRecortado: 5 });
  });

  it("devuelve null cuando ya hay 1 sector por fila", () => {
    const res = calcularNuevoSectorSinSolape(
      [{ desde: 1, hasta: 1 }, { desde: 2, hasta: 2 }],
      1,
      2,
    );
    expect(res).toBeNull();
  });
});

describe("indicesConSolape", () => {
  it("detecta sectores superpuestos e ignora los disjuntos", () => {
    const sol = indicesConSolape([{ desde: 1, hasta: 3 }, { desde: 3, hasta: 5 }, { desde: 6, hasta: 8 }]);
    expect([...sol]).toEqual([0, 1]);
  });
});
