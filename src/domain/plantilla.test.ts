import { describe, expect, it } from "vitest";
import { PLANTILLA_EJEMPLO } from "@/config/plantilla";
import { validarPlantilla, type Plantilla } from "./plantilla";

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
