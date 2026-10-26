// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Seccion } from "@/domain/types";
import type { ResumenSeccion } from "@/domain/resumen";
import type { SedeVista } from "@/state/derivar";
import { PuertaView } from "./PuertaView";

vi.mock("@/utils/audio", () => ({ playSuccessSound: vi.fn() }));
import { playSuccessSound } from "@/utils/audio";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Secciones = Record<Seccion, ResumenSeccion & { pendientes: number }>;

function armar(cambios: Partial<Secciones> = {}): Secciones {
  return {
    izquierda: { libres: 14, grupoMaxJunto: 4, pendientes: 0 },
    centro: { libres: 23, grupoMaxJunto: 6, pendientes: 0 },
    derecha: { libres: 6, grupoMaxJunto: 4, pendientes: 0 },
    ...cambios,
  };
}

const ok = () => Promise.resolve({ ok: true });

describe("PuertaView", () => {
  it("arranca con tamaño 2 y manda 3 al Centro una sola vez", async () => {
    const onMandar = vi.fn(ok);
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} />);

    expect(screen.getByRole("button", { name: "2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "3" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "Mandar 3 al Centro" }));

    expect(onMandar).toHaveBeenCalledTimes(1);
    expect(onMandar).toHaveBeenCalledWith("centro", 3, null);
    expect(playSuccessSound).toHaveBeenCalledTimes(1);
  });

  it("si el grupo no entra, el botón de la sección queda deshabilitado y dice No entran 3", async () => {
    const user = userEvent.setup();
    render(
      <PuertaView
        secciones={armar({ derecha: { libres: 6, grupoMaxJunto: 2, pendientes: 0 } })}
        modoPico={false}
        onMandar={vi.fn(ok)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "3" }));

    const boton = screen.getByRole("button", { name: "No entran 3" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.textContent).toContain("No entran 3");
    expect((screen.getByRole("button", { name: "Mandar 3 al Centro" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("el botón 5+ manda 5", async () => {
    const onMandar = vi.fn(ok);
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} />);

    await user.click(screen.getByRole("button", { name: "5+" }));
    await user.click(screen.getByRole("button", { name: "Mandar 5 al Centro" }));

    expect(onMandar).toHaveBeenCalledWith("centro", 5, null);
  });

  it("cada sección muestra hasta N juntos · M libres en números absolutos, sin porcentajes", () => {
    const { container } = render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} />);

    expect(screen.getByText("hasta 4 juntos · 14 libres")).toBeTruthy();
    expect(screen.getByText("hasta 6 juntos · 23 libres")).toBeTruthy();
    expect(screen.getByText("hasta 4 juntos · 6 libres")).toBeTruthy();
    expect(container.textContent).not.toContain("%");
  });

  it("si onMandar devuelve error lo muestra con role=alert y no suena", async () => {
    const onMandar = vi.fn(() => Promise.resolve({ ok: false, error: "Sin conexión con el servidor" }));
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} />);

    await user.click(screen.getByRole("button", { name: "Mandar 2 al Centro" }));

    const alerta = await screen.findByRole("alert");
    expect(within(alerta).getByText("Sin conexión con el servidor")).toBeTruthy();
    expect(playSuccessSound).not.toHaveBeenCalled();
  });

  it("modoPico oculta el contador de pendientes y sin modoPico lo muestra", () => {
    const secciones = armar({ centro: { libres: 20, grupoMaxJunto: 6, pendientes: 2 } });
    const { rerender } = render(<PuertaView secciones={secciones} modoPico={true} onMandar={vi.fn(ok)} />);
    expect(screen.queryByText("2 sin confirmar")).toBeNull();

    rerender(<PuertaView secciones={secciones} modoPico={false} onMandar={vi.fn(ok)} />);
    expect(screen.getByText("2 sin confirmar")).toBeTruthy();
  });

  it("mientras onMandar está en curso deshabilita los botones de mandar (anti doble toque)", async () => {
    let resolver: (r: { ok: boolean }) => void = () => {};
    const onMandar = vi.fn(() => new Promise<{ ok: boolean }>((r) => { resolver = r; }));
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} />);

    const boton = screen.getByRole("button", { name: "Mandar 2 al Centro" }) as HTMLButtonElement;
    await user.click(boton);
    await user.click(boton);
    expect(onMandar).toHaveBeenCalledTimes(1);
    expect(boton.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Mandar 2 a la Izquierda" }) as HTMLButtonElement).disabled).toBe(true);

    resolver({ ok: true });
    await waitFor(() => expect(boton.disabled).toBe(false));
  });

  it("si onMandar lanza una excepción muestra un error y rehabilita los botones", async () => {
    const onMandar = vi.fn(() => Promise.reject(new Error("boom")));
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} />);

    await user.click(screen.getByRole("button", { name: "Mandar 2 al Centro" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mandar 2 al Centro" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("vibra al mandar si el navegador lo soporta, y no falla si vibrate lanza", async () => {
    const vibrate = vi.fn(() => { throw new Error("no permitido"); });
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const user = userEvent.setup();
    render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} />);

    await user.click(screen.getByRole("button", { name: "Mandar 2 al Centro" }));

    expect(vibrate).toHaveBeenCalled();
    expect(playSuccessSound).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(navigator, "vibrate");
  });

  describe("sedes", () => {
    const catan = (quedan: number): SedeVista => ({
      sedeId: "id-catan",
      nombre: "Catán",
      porSeccion: { centro: { cantidad: 50, consumido: 50 - quedan, quedan, sectores: [] } },
      completo: quedan === 0,
    });
    // Para la sede, el Centro tiene más libres (su apartado no se descuenta).
    const paraSede = (id: string | null): Secciones =>
      id === null ? armar() : armar({ centro: { libres: 60, grupoMaxJunto: 6, pendientes: 0 } });

    it("sin sedes no hay chips", () => {
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[]} resumenParaSede={paraSede} />);
      expect(screen.queryByRole("button", { name: "Sin sede" })).toBeNull();
    });

    it("elegir Catán marca el chip, muestra quedan y manda con la sede", async () => {
      const onMandar = vi.fn(ok);
      const user = userEvent.setup();
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} sedes={[catan(42)]} resumenParaSede={paraSede} />);
      expect(screen.getByRole("button", { name: "Sin sede" }).getAttribute("aria-pressed")).toBe("true");

      await user.click(screen.getByRole("button", { name: "3" }));
      await user.click(screen.getByRole("button", { name: "Catán" }));
      expect(screen.getByRole("button", { name: "Catán" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("Catán: quedan 42")).toBeTruthy();
      expect(screen.getByText("hasta 6 juntos · 60 libres")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Mandar 3 de Catán al Centro" }));
      expect(onMandar).toHaveBeenCalledWith("centro", 3, "id-catan");
    });

    it("sede completa: chip (completo) y manda con null", async () => {
      const onMandar = vi.fn(ok);
      const user = userEvent.setup();
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={onMandar} sedes={[catan(0)]} resumenParaSede={paraSede} />);
      await user.click(screen.getByRole("button", { name: "Catán (completo)" }));
      await user.click(screen.getByRole("button", { name: "Mandar 2 al Centro" }));
      expect(onMandar).toHaveBeenCalledWith("centro", 2, null);
    });

    it("sede completa elegida: queda presionado Sin sede, no el chip completo", async () => {
      const user = userEvent.setup();
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[catan(0)]} resumenParaSede={paraSede} />);
      await user.click(screen.getByRole("button", { name: "Catán (completo)" }));
      expect(screen.getByRole("button", { name: "Catán (completo)" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: "Sin sede" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("liberado: no muestra quedan pero el chip sigue", async () => {
      const user = userEvent.setup();
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[catan(42)]} liberado resumenParaSede={paraSede} />);
      await user.click(screen.getByRole("button", { name: "Catán" }));
      expect(screen.queryByText("Catán: quedan 42")).toBeNull();
      expect(screen.getByRole("button", { name: "Catán" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("la sede se mantiene después de mandar", async () => {
      const user = userEvent.setup();
      render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[catan(42)]} resumenParaSede={paraSede} />);
      await user.click(screen.getByRole("button", { name: "Catán" }));
      await user.click(screen.getByRole("button", { name: "Mandar 2 de Catán al Centro" }));
      expect(screen.getByRole("button", { name: "Catán" }).getAttribute("aria-pressed")).toBe("true");
    });
    describe("sectores", () => {
      const sector = (sectorId: number | null, nombre: string | null, d: number | null, h: number | null, cantidad: number, quedan: number) => ({
        sectorId, nombre, filaDesde: d, filaHasta: h, cantidad, quedan,
      });
      const sede = (sectores: ReturnType<typeof sector>[]): SedeVista => ({
        sedeId: "id-catan",
        nombre: "Catán",
        porSeccion: { centro: { cantidad: 50, consumido: 8, quedan: 42, sectores } },
        completo: false,
      });
      const elegirCatan = async (s: SedeVista) => {
        const user = userEvent.setup();
        render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[s]} resumenParaSede={paraSede} />);
        await user.click(screen.getByRole("button", { name: "Catán" }));
      };

      it("con dos sectores en el centro muestra una línea por sector con sus quedan", async () => {
        await elegirCatan(sede([sector(1, "Centro medio", 5, 8, 20, 12), sector(2, "Centro fondo", 9, 12, 30, 30)]));
        expect(screen.getByText("Centro medio (filas 5–8): quedan 12")).toBeTruthy();
        expect(screen.getByText("Centro fondo (filas 9–12): quedan 30")).toBeTruthy();
        expect(screen.queryByText("Catán: quedan 42")).toBeNull();
      });

      it("con un único sector null queda el texto de la Etapa 2", async () => {
        await elegirCatan(sede([sector(null, null, null, null, 50, 42)]));
        expect(screen.getByText("Catán: quedan 42")).toBeTruthy();
      });

      it("con un único sector real el botón lo nombra; con dos o ninguno queda igual", async () => {
        await elegirCatan(sede([sector(1, "Centro medio", 5, 8, 20, 12)]));
        expect(screen.getByRole("button", { name: "Mandar 2 de Catán al Centro — Centro medio" })).toBeTruthy();
        cleanup();
        await elegirCatan(sede([sector(1, "Centro medio", 5, 8, 20, 12), sector(2, "Centro fondo", 9, 12, 30, 30)]));
        expect(screen.getByRole("button", { name: "Mandar 2 de Catán al Centro" })).toBeTruthy();
        cleanup();
        await elegirCatan(sede([sector(null, null, null, null, 50, 42)]));
        expect(screen.getByRole("button", { name: "Mandar 2 de Catán al Centro" })).toBeTruthy();
      });

      it("liberado: no muestra las líneas de sector", async () => {
        const user = userEvent.setup();
        render(<PuertaView secciones={armar()} modoPico={false} onMandar={vi.fn(ok)} sedes={[sede([sector(1, "Centro medio", 5, 8, 20, 12)])]} liberado resumenParaSede={paraSede} />);
        await user.click(screen.getByRole("button", { name: "Catán" }));
        expect(screen.queryByText(/Centro medio/)).toBeNull();
      });
    });
  });
});
