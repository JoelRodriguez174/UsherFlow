// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Aviso } from "./Aviso";

afterEach(cleanup);

describe("Aviso", () => {
  it("no renderiza con mensaje null", () => {
    const { container } = render(<Aviso mensaje={null} onCerrar={() => {}} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("error usa role=alert", () => {
    render(<Aviso mensaje="Se cayó" tipo="error" onCerrar={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Se cayó");
  });

  it("info usa role=status", () => {
    render(<Aviso mensaje="Listo" tipo="info" onCerrar={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Listo");
  });

  it("el botón de cierre tiene nombre accesible y llama a onCerrar", async () => {
    const onCerrar = vi.fn();
    render(<Aviso mensaje="Hola" onCerrar={onCerrar} />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
