// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapaSalon, type SectorMapa } from "./MapaSalon";

afterEach(cleanup);

const sectores: SectorMapa[] = [
  { id: 1, seccion: "izquierda", nombre: "adelante", filaDesde: 1, filaHasta: 6, estado: "agotado" },
  { id: 2, seccion: "izquierda", nombre: "medio", filaDesde: 7, filaHasta: 13, estado: "disponible", detalle: "quedan 14" },
  { id: 3, seccion: "centro", nombre: "medio", filaDesde: 7, filaHasta: 13, estado: "preferido" },
  { id: 4, seccion: "derecha", nombre: "atrás", filaDesde: 14, filaHasta: 20, estado: "asignado", detalle: "40 lugares" },
];

const boton = (id: number) => screen.getAllByRole("button")[id - 1];

describe("MapaSalon", () => {
  it("muestra las tres secciones, el escenario y un botón por sector con su estado en texto", () => {
    render(<MapaSalon sectores={sectores} />);
    for (const n of ["Izquierda", "Centro", "Derecha"]) {
      expect(screen.getByRole("heading", { name: n })).toBeTruthy();
    }
    expect(screen.getByText("ESCENARIO")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(boton(1).textContent).toContain("filas 1–6");
    expect(boton(1).textContent).toContain("Agotado");
    expect(boton(2).textContent).toContain("Disponible");
    expect(boton(2).textContent).toContain("quedan 14");
    expect(boton(3).textContent).toContain("Tu preferencia");
    expect(boton(4).textContent).toContain("Asignado");
  });

  it("clic en disponible llama onAlternar con el id; agotado y asignado no", async () => {
    const onAlternar = vi.fn();
    render(<MapaSalon sectores={sectores} onAlternar={onAlternar} />);
    await userEvent.click(boton(2));
    expect(onAlternar).toHaveBeenCalledExactlyOnceWith(2);
    await userEvent.click(boton(1));
    await userEvent.click(boton(4));
    expect(onAlternar).toHaveBeenCalledTimes(1);
    await userEvent.click(boton(3));
    expect(onAlternar).toHaveBeenLastCalledWith(3);
  });

  it("expone aria-pressed y aria-disabled según el estado", () => {
    render(<MapaSalon sectores={sectores} onAlternar={() => {}} />);
    expect(boton(3).getAttribute("aria-pressed")).toBe("true");
    expect(boton(2).getAttribute("aria-pressed")).toBe("false");
    expect(boton(2).getAttribute("aria-disabled")).toBeNull();
    expect(boton(1).getAttribute("aria-disabled")).toBe("true");
    expect(boton(4).getAttribute("aria-disabled")).toBe("true");
  });

  it("deshabilitado bloquea todo", async () => {
    const onAlternar = vi.fn();
    render(<MapaSalon sectores={sectores} onAlternar={onAlternar} deshabilitado />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      await userEvent.click(b);
    }
    expect(onAlternar).not.toHaveBeenCalled();
  });

  it("sin onAlternar los botones no son interactivos", async () => {
    render(<MapaSalon sectores={sectores} />);
    expect(boton(2).getAttribute("aria-disabled")).toBe("true");
  });

  it("lista vacía muestra el mensaje y ningún botón", () => {
    render(<MapaSalon sectores={[]} />);
    expect(screen.getByText("El supervisor todavía no definió los sectores.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("respeta el orden del arreglo dentro de cada sección", () => {
    const orden: SectorMapa[] = [
      { id: 10, seccion: "centro", nombre: "atrás", filaDesde: 14, filaHasta: 20, estado: "disponible" },
      { id: 11, seccion: "centro", nombre: "adelante", filaDesde: 1, filaHasta: 6, estado: "disponible" },
    ];
    render(<MapaSalon sectores={orden} />);
    const centro = screen.getByRole("group", { name: "Centro" });
    const nombres = within(centro).getAllByRole("button").map((b) => b.textContent);
    expect(nombres[0]).toContain("atrás");
    expect(nombres[1]).toContain("adelante");
  });

  it("incluye la leyenda y la etiqueta personalizada del escenario", () => {
    render(<MapaSalon sectores={sectores} etiquetaEscenario="PÚLPITO" />);
    expect(screen.getByText("PÚLPITO")).toBeTruthy();
    const ley = screen.getByRole("list", { name: "Leyenda" });
    for (const t of ["Disponible", "Agotado", "Tu preferencia", "Asignado"]) {
      expect(within(ley).getByText(t)).toBeTruthy();
    }
  });
  it("etiquetaPreferido reemplaza 'Tu preferencia' en el estado y en la leyenda", () => {
    render(<MapaSalon sectores={sectores} etiquetaPreferido="Pedido por alguna sede" />);
    expect(boton(3).textContent).toContain("Pedido por alguna sede");
    expect(screen.queryByText("Tu preferencia")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Leyenda" })).getByText("Pedido por alguna sede")).toBeTruthy();
  });

  it("por defecto la leyenda dice 'Tu preferencia'", () => {
    render(<MapaSalon sectores={sectores} />);
    expect(within(screen.getByRole("list", { name: "Leyenda" })).getByText("Tu preferencia")).toBeTruthy();
  });

  it("sin onAlternar ningún botón lleva aria-pressed; con onAlternar sí", () => {
    const { unmount } = render(<MapaSalon sectores={sectores} />);
    for (const b of screen.getAllByRole("button")) expect(b.hasAttribute("aria-pressed")).toBe(false);
    unmount();
    render(<MapaSalon sectores={sectores} onAlternar={() => {}} />);
    expect(boton(3).getAttribute("aria-pressed")).toBe("true");
  });

  it("'Agotado' usa el texto normal (no el suave) para alcanzar contraste AA", () => {
    render(<MapaSalon sectores={sectores} />);
    expect(boton(1).classList.contains("text-texto")).toBe(true);
    expect(boton(1).classList.contains("text-texto-suave")).toBe(false);
  });
});
