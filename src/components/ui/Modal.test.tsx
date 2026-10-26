// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

afterEach(cleanup);

function Demo({ onCerrar = () => {} }: { onCerrar?: () => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      <Modal
        abierto={abierto}
        onCerrar={() => {
          onCerrar();
          setAbierto(false);
        }}
        titulo="Editar fila"
      >
        <button>Primero</button>
        <button>Último</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("no renderiza nada si está cerrado", () => {
    render(
      <Modal abierto={false} onCerrar={() => {}} titulo="X">
        <p>contenido</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("se nombra por su título (aria-labelledby)", async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog", { name: "Editar fila" })).toBeTruthy();
  });

  it("al abrir, el foco entra al modal", async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.contains(document.activeElement)).toBe(true);
  });

  it("Tab desde el último elemento vuelve al primero y Shift+Tab al revés", async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const cerrar = screen.getByRole("button", { name: "Cerrar" });
    const ultimo = screen.getByRole("button", { name: "Último" });
    ultimo.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(cerrar);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it("Escape llama a onCerrar", async () => {
    const onCerrar = vi.fn();
    render(<Demo onCerrar={onCerrar} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.keyboard("{Escape}");
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("al cerrar el foco vuelve al elemento que lo abrió", async () => {
    render(<Demo />);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    await userEvent.click(abrir);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abrir);
  });

  it("tocar el fondo cierra", async () => {
    const onCerrar = vi.fn();
    render(<Demo onCerrar={onCerrar} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.click(screen.getByTestId("modal-fondo"));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
