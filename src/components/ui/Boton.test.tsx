// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Boton } from "./Boton";

afterEach(cleanup);

describe("Boton", () => {
  it("con etiqueta y sin texto expone el nombre accesible", () => {
    render(<Boton etiqueta="Cerrar" />);
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });

  it("usa el texto hijo como nombre y por defecto es type=button", () => {
    render(<Boton>Mandar</Boton>);
    const b = screen.getByRole("button", { name: "Mandar" });
    expect(b.getAttribute("type")).toBe("button");
  });

  it("el tamaño grande tiene al menos 48px y el normal 44px", () => {
    render(
      <>
        <Boton tamano="grande">Grande</Boton>
        <Boton>Normal</Boton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Grande" }).className).toContain("min-h-12");
    expect(screen.getByRole("button", { name: "Normal" }).className).toContain("min-h-11");
  });

  it("dispara onClick y respeta disabled", async () => {
    const alClick = vi.fn();
    const { rerender } = render(<Boton onClick={alClick}>Ok</Boton>);
    await userEvent.click(screen.getByRole("button", { name: "Ok" }));
    expect(alClick).toHaveBeenCalledTimes(1);
    rerender(
      <Boton onClick={alClick} disabled>
        Ok
      </Boton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ok" }));
    expect(alClick).toHaveBeenCalledTimes(1);
  });
});
