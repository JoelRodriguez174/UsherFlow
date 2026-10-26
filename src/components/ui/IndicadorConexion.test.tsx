// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndicadorConexion } from "./IndicadorConexion";

afterEach(cleanup);

describe("IndicadorConexion", () => {
  it("conectado: texto, role=status y sin botón de reintento", () => {
    render(<IndicadorConexion estado="connected" onReintentar={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Conectado");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reconectando: texto y botón de reintento", async () => {
    const onReintentar = vi.fn();
    render(<IndicadorConexion estado="reconnecting" onReintentar={onReintentar} />);
    expect(screen.getByRole("status").textContent).toContain("Reconectando");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onReintentar).toHaveBeenCalledTimes(1);
  });

  it("sin conexión: texto y botón de reintento", () => {
    render(<IndicadorConexion estado="offline" onReintentar={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Sin conexión");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("sincronizando agrega el texto, no solo color", () => {
    render(<IndicadorConexion estado="connected" sincronizando onReintentar={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Sincronizando");
  });
});
