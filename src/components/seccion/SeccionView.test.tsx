// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Fila, Tramo } from "@/domain/types";
import { grupoMaxJuntoFila, libresFila } from "@/domain/disponibilidad";
import type { FilaVista, PendienteVista, SectorVista, SedeVista } from "@/state/derivar";
import { SeccionView } from "./SeccionView";
import { haceCuanto, opcionesUbicacion } from "./helpers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AHORA = Date.parse("2026-10-22T20:00:00.000Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();
const MIN = 60_000;

function tramo(id: number, ocupados: number, capacidad = 8, extra: Partial<Tramo> = {}): Tramo {
  return { id, orden: id, tipo: "publico", capacidad, ocupados, etiqueta: null, ...extra };
}

function fila(id: number, tramos: Tramo[], extra: Partial<Fila> = {}): Fila {
  return {
    id,
    seccion: "centro",
    numero: id,
    fragmentada: false,
    verificadaEn: null,
    tramos,
    ...extra,
  };
}

function vista(f: Fila): FilaVista {
  const libres = libresFila(f);
  return { fila: f, libres, grupoMaxJunto: grupoMaxJuntoFila(f), estaLlena: libres === 0 };
}

function pendiente(cantidad = 3, ambar = false, id = "p1"): PendienteVista {
  return { pendiente: { id, seccion: "centro", cantidad, sedeId: null, creadoEn: hace(60_000) }, ambar };
}

const ok = () => Promise.resolve(true);
const okSentar = () => Promise.resolve({ ok: true });

function armar(filas: Fila[], pendientes: PendienteVista[] = [], over: Record<string, unknown> = {}, sedes: SedeVista[] = []) {
  const props = {
    onSentar: vi.fn(okSentar),
    onNoLlegaron: vi.fn(ok),
    onSeLevanto: vi.fn(ok),
    onCorregir: vi.fn(ok),
    onJuntar: vi.fn(ok),
    onVerificar: vi.fn(ok),
    onAgregarFila: vi.fn(ok),
    ...over,
  };
  const utils = render(
    <SeccionView
      seccion="centro"
      filas={filas.map(vista)}
      pendientes={pendientes}
      sedes={sedes}
      ahoraServidorMs={AHORA}
      {...props}
    />,
  );
  return { ...props, ...utils };
}

function grupoFila(numero: number) {
  return screen.getByRole("group", { name: `Fila ${numero}` });
}

describe("PendienteCard / sentar", () => {
  it("con un pendiente de 3 y filas vacías, un solo click en 'Sentar en Fila 1' llama onSentar(id, tramo de la fila 1)", async () => {
    const user = userEvent.setup();
    const { onSentar } = armar([fila(1, [tramo(11, 0)]), fila(2, [tramo(21, 0)])], [pendiente(3)]);

    expect(screen.getByRole("heading", { name: "Vienen 3" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sentar en Fila 1" }));

    expect(onSentar).toHaveBeenCalledTimes(1);
    expect(onSentar).toHaveBeenCalledWith("p1", 11);
  });

  it("fila 1 llena: sugiere la 2", async () => {
    const user = userEvent.setup();
    const { onSentar } = armar([fila(1, [tramo(11, 8)]), fila(2, [tramo(21, 0)])], [pendiente(3)]);

    expect(screen.queryByRole("button", { name: "Sentar en Fila 1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sentar en Fila 2" }));
    expect(onSentar).toHaveBeenCalledWith("p1", 21);
  });

  it("fila sugerida con dos tramos públicos: el botón nombra el tramo y 'Otra fila…' deja elegir otro", async () => {
    const user = userEvent.setup();
    const filas = [
      fila(1, [tramo(11, 0, 4, { etiqueta: "Pasillo" }), tramo(12, 0, 6, { etiqueta: "Ventana", orden: 2 })]),
      fila(2, [tramo(21, 0)]),
    ];
    const { onSentar } = armar(filas, [pendiente(3)]);

    // 4 libres vs 6 libres: el de menor sobrante que alcanza es "Pasillo".
    expect(screen.getByRole("button", { name: "Sentar en Fila 1 · Pasillo" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Otra fila…" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: /^Fila 1 · Ventana · 6 libres$/ }));

    expect(onSentar).toHaveBeenCalledTimes(1);
    expect(onSentar).toHaveBeenCalledWith("p1", 12);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("'Otra fila…' en filas de un tramo lista las filas donde entra el grupo y no las que no", async () => {
    const user = userEvent.setup();
    armar([fila(1, [tramo(11, 7)]), fila(2, [tramo(21, 0)]), fila(3, [tramo(31, 0)])], [pendiente(3)]);

    await user.click(screen.getByRole("button", { name: "Otra fila…" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).queryByRole("button", { name: /^Fila 1 / })).toBeNull();
    expect(within(dialogo).getByRole("button", { name: /^Fila 2 · 8 libres$/ })).toBeTruthy();
    expect(within(dialogo).getByRole("button", { name: /^Fila 3 · 8 libres$/ })).toBeTruthy();
  });

  it("si no entra en ningún tramo avisa, no ofrece elegir fila y 'No llegaron' es la acción principal", async () => {
    const user = userEvent.setup();
    const { onNoLlegaron } = armar([fila(1, [tramo(11, 7)])], [pendiente(3)]);

    expect(screen.queryByRole("button", { name: /^Sentar en Fila/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Elegir fila…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Otra fila…" })).toBeNull();
    expect(screen.getByText(/no hay lugar para 3 juntos/i)).toBeTruthy();

    const boton = screen.getByRole("button", { name: "No llegaron" });
    expect(boton.className).toContain("min-h-12");
    await user.click(boton);
    expect(onNoLlegaron).toHaveBeenCalledWith("p1");
  });

  it("sin sugerencia pero con un tramo donde entra (fila fragmentada) ofrece 'Elegir fila…'", async () => {
    const user = userEvent.setup();
    const { onSentar } = armar([fila(1, [tramo(11, 2)], { fragmentada: true })], [pendiente(3)]);

    expect(screen.queryByRole("button", { name: /^Sentar en Fila/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Elegir fila…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Fila 1 · 6 libres/ }));
    expect(onSentar).toHaveBeenCalledWith("p1", 11);
  });

  it("si la única opción es el tramo sugerido no muestra 'Otra fila…'", () => {
    armar([fila(1, [tramo(11, 0)]), fila(2, [tramo(21, 7)])], [pendiente(3)]);
    expect(screen.getByRole("button", { name: "Sentar en Fila 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Otra fila…" })).toBeNull();
  });

  it("pendiente ámbar muestra 'Falta confirmar' en un role=status; el normal no", () => {
    armar([fila(1, [tramo(11, 0)])], [pendiente(3, true)]);
    const estado = screen.getByRole("status");
    expect(estado.textContent).toContain("Falta confirmar");
    cleanup();

    armar([fila(1, [tramo(11, 0)])], [pendiente(3, false)]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Falta confirmar/)).toBeNull();
  });

  it("'No llegaron' llama onNoLlegaron con el id", async () => {
    const user = userEvent.setup();
    const { onNoLlegaron } = armar([fila(1, [tramo(11, 0)])], [pendiente(3)]);
    await user.click(screen.getByRole("button", { name: "No llegaron" }));
    expect(onNoLlegaron).toHaveBeenCalledWith("p1");
  });

  it("muestra solo el primer pendiente y cuántos esperan detrás", () => {
    armar([fila(1, [tramo(11, 0)])], [pendiente(3, false, "p1"), pendiente(2, false, "p2")]);
    expect(screen.getByRole("heading", { name: "Vienen 3" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Vienen 2" })).toBeNull();
    expect(screen.getByText(/1 grupo más esperando/)).toBeTruthy();
  });

  it("sin pendientes no hay botón de sentar", () => {
    armar([fila(1, [tramo(11, 0)])], []);
    expect(screen.queryByRole("button", { name: /^Sentar en/ })).toBeNull();
    expect(screen.getByText(/No hay grupos en camino/)).toBeTruthy();
  });

  it("guarda contra el doble toque sin usar disabled nativo y libera al terminar", async () => {
    const user = userEvent.setup();
    let resolver: (v: { ok: boolean }) => void = () => {};
    const onSentar = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolver = r)));
    armar([fila(1, [tramo(11, 0)])], [pendiente(3)], { onSentar });

    const boton = screen.getByRole("button", { name: "Sentar en Fila 1" });
    await user.click(boton);
    await user.click(boton);

    expect(onSentar).toHaveBeenCalledTimes(1);
    expect((boton as HTMLButtonElement).disabled).toBe(false);
    expect(boton.getAttribute("aria-disabled")).toBe("true");
    expect(boton.getAttribute("aria-busy")).toBe("true");

    await act(async () => resolver({ ok: false }));
    expect(boton.getAttribute("aria-disabled")).toBeNull();
    expect(boton.getAttribute("aria-busy")).toBeNull();

    await user.click(boton);
    expect(onSentar).toHaveBeenCalledTimes(2);
    await act(async () => resolver({ ok: true }));
  });

  it("libera el estado ocupado aunque el callback rechace", async () => {
    const user = userEvent.setup();
    const onSentar = vi.fn(() => Promise.reject(new Error("boom")));
    armar([fila(1, [tramo(11, 0)])], [pendiente(3)], { onSentar });
    const boton = screen.getByRole("button", { name: "Sentar en Fila 1" });
    await user.click(boton);
    await waitFor(() => expect(boton.getAttribute("aria-busy")).toBeNull());
    await user.click(boton);
    expect(onSentar).toHaveBeenCalledTimes(2);
  });
});

describe("Mis filas", () => {
  it("ordena siempre por número de fila, sin importar ocupación ni verificación", () => {
    const filas = [
      fila(1, [tramo(11, 0)]), // vacía
      fila(2, [tramo(21, 2)], { verificadaEn: hace(5 * MIN) }), // con gente
      fila(3, [tramo(31, 7)], { verificadaEn: hace(1 * MIN) }), // casi llena => primero
      fila(4, [tramo(41, 0)]), // vacía
      fila(5, [tramo(51, 3)], { verificadaEn: hace(30 * MIN) }), // con gente, más vieja que la 2
    ];
    armar([filas[2], filas[4], filas[0], filas[3], filas[1]], []);
    const titulos = within(screen.getByRole("list", { name: "Mis filas" }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titulos).toEqual(["Fila 1", "Fila 2", "Fila 3", "Fila 4", "Fila 5"]);
  });

  it("muestra la edad de verificación de cada fila", () => {
    armar(
      [
        fila(1, [tramo(11, 2)], { verificadaEn: hace(12 * MIN) }),
        fila(2, [tramo(21, 2)], { verificadaEn: null }),
      ],
      [],
    );
    expect(within(grupoFila(1)).getByText(/hace 12 min/)).toBeTruthy();
    expect(within(grupoFila(2)).getByText(/sin verificar/i)).toBeTruthy();
  });

  it("'Ya revisé' llama onVerificar(filaId)", async () => {
    const user = userEvent.setup();
    const { onVerificar } = armar([fila(4, [tramo(41, 2)])], []);
    await user.click(within(grupoFila(4)).getByRole("button", { name: "Ya revisé" }));
    expect(onVerificar).toHaveBeenCalledWith(4);
  });

  it("'Se levantó alguien' llama onSeLevanto(tramoId) sin pedir tramo en filas de un tramo", async () => {
    const user = userEvent.setup();
    const { onSeLevanto } = armar([fila(1, [tramo(11, 4)])], []);
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Se levantó alguien" }));
    expect(onSeLevanto).toHaveBeenCalledTimes(1);
    expect(onSeLevanto).toHaveBeenCalledWith(11);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("en filas con varios tramos públicos 'Se levantó alguien' pregunta el tramo", async () => {
    const user = userEvent.setup();
    const { onSeLevanto } = armar(
      [fila(1, [tramo(11, 2, 4, { etiqueta: "Pasillo" }), tramo(12, 3, 6, { etiqueta: "Ventana", orden: 2 })])],
      [],
    );
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Se levantó alguien" }));
    expect(onSeLevanto).not.toHaveBeenCalled();

    await user.click(within(grupoFila(1)).getByRole("button", { name: /^Ventana/ }));
    expect(onSeLevanto).toHaveBeenCalledTimes(1);
    expect(onSeLevanto).toHaveBeenCalledWith(12);
  });

  it("filas fragmentadas muestran el aviso y 'Juntos' llama onJuntar", async () => {
    const user = userEvent.setup();
    const { onJuntar } = armar(
      [fila(1, [tramo(11, 5)], { fragmentada: true }), fila(2, [tramo(21, 5)])],
      [],
    );
    expect(within(grupoFila(1)).getByText(/lugares sueltos/i)).toBeTruthy();
    expect(within(grupoFila(2)).queryByText(/lugares sueltos/i)).toBeNull();
    expect(within(grupoFila(2)).queryByRole("button", { name: "Juntos" })).toBeNull();

    await user.click(within(grupoFila(1)).getByRole("button", { name: "Juntos" }));
    expect(onJuntar).toHaveBeenCalledWith(1);
  });

  it("los tramos reservados se ven con su etiqueta, sin acciones", () => {
    armar(
      [
        fila(1, [tramo(11, 2, 6), tramo(12, 0, 2, { tipo: "reservado", etiqueta: "Mamás", orden: 2 })]),
        fila(2, [tramo(21, 0, 8, { tipo: "reservado", etiqueta: "Pastores" })]),
      ],
      [],
    );
    expect(within(grupoFila(1)).getByText(/Mamás · reservado/)).toBeTruthy();
    // Un solo tramo público: acción directa, no hay botón por el tramo reservado.
    expect(within(grupoFila(1)).queryByRole("button", { name: /Mamás/ })).toBeNull();
    // Fila entera reservada: sin ninguna acción.
    expect(within(grupoFila(2)).getByText(/Pastores · reservado/)).toBeTruthy();
    expect(within(grupoFila(2)).queryAllByRole("button")).toHaveLength(0);
  });

  it("'Agregar fila' llama onAgregarFila una sola vez aunque se toque dos veces mientras espera", async () => {
    const user = userEvent.setup();
    let resolver: (v: boolean) => void = () => {};
    const onAgregarFila = vi.fn(() => new Promise<boolean>((r) => (resolver = r)));
    armar([fila(1, [tramo(11, 0)])], [], { onAgregarFila });
    const boton = screen.getByRole("button", { name: "Agregar fila" });
    await user.click(boton);
    await user.click(boton);
    expect(onAgregarFila).toHaveBeenCalledTimes(1);
    expect(boton.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolver(true));
    expect(boton.getAttribute("aria-busy")).toBeNull();
  });
});

describe("Corregir conteo", () => {
  it("pregunta cuántos lugares libres ve y llama onCorregir(tramoId, libres)", async () => {
    const user = userEvent.setup();
    const { onCorregir } = armar([fila(1, [tramo(11, 3, 8)])], []);

    await user.click(within(grupoFila(1)).getByRole("button", { name: "Corregir conteo" }));
    const dialogo = screen.getByRole("dialog");
    const campo = within(dialogo).getByLabelText("¿Cuántos lugares libres ves?") as HTMLInputElement;
    expect(campo.getAttribute("inputmode")).toBe("numeric");
    expect(campo.value).toBe("5");

    await user.clear(campo);
    await user.type(campo, "2");
    await user.click(within(dialogo).getByRole("button", { name: "Guardar" }));

    expect(onCorregir).toHaveBeenCalledWith(11, 2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("los botones + y − ajustan el número dentro de 0 y la capacidad", async () => {
    const user = userEvent.setup();
    const { onCorregir } = armar([fila(1, [tramo(11, 7, 8)])], []);
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Corregir conteo" }));
    const dialogo = screen.getByRole("dialog");
    const campo = within(dialogo).getByLabelText("¿Cuántos lugares libres ves?") as HTMLInputElement;

    expect(campo.value).toBe("1");
    await user.click(within(dialogo).getByRole("button", { name: "Un lugar libre más" }));
    await user.click(within(dialogo).getByRole("button", { name: "Un lugar libre menos" }));
    await user.click(within(dialogo).getByRole("button", { name: "Un lugar libre menos" }));
    await user.click(within(dialogo).getByRole("button", { name: "Un lugar libre menos" }));
    expect(campo.value).toBe("0");

    await user.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(onCorregir).toHaveBeenCalledWith(11, 0);
  });

  it("un valor fuera de rango no se guarda", async () => {
    const user = userEvent.setup();
    const { onCorregir } = armar([fila(1, [tramo(11, 3, 8)])], []);
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Corregir conteo" }));
    const dialogo = screen.getByRole("dialog");
    const campo = within(dialogo).getByLabelText("¿Cuántos lugares libres ves?");
    await user.clear(campo);
    await user.type(campo, "9");
    await user.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(onCorregir).not.toHaveBeenCalled();
    expect(within(dialogo).getByText(/entre 0 y 8/)).toBeTruthy();
  });

  it("con varios tramos públicos corrige por tramo, mostrando etiqueta y capacidad", async () => {
    const user = userEvent.setup();
    const { onCorregir } = armar(
      [fila(1, [tramo(11, 2, 4, { etiqueta: "Pasillo" }), tramo(12, 3, 6, { etiqueta: "Ventana", orden: 2 })])],
      [],
    );
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Corregir conteo" }));
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.textContent).toMatch(/Pasillo \(4 lugares\)/);
    expect(dialogo.textContent).toMatch(/Ventana \(6 lugares\)/);

    const campo = within(dialogo).getByLabelText(/Ventana.*lugares libres/) as HTMLInputElement;
    expect(campo.value).toBe("3");
    await user.clear(campo);
    await user.type(campo, "6");
    await user.click(within(dialogo).getByRole("button", { name: "Guardar Ventana" }));
    expect(onCorregir).toHaveBeenCalledTimes(1);
    expect(onCorregir).toHaveBeenCalledWith(12, 6);
  });

  it("si onCorregir falla el modal queda abierto", async () => {
    const user = userEvent.setup();
    const onCorregir = vi.fn(() => Promise.resolve(false));
    armar([fila(1, [tramo(11, 3, 8)])], [], { onCorregir });
    await user.click(within(grupoFila(1)).getByRole("button", { name: "Corregir conteo" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar" }));
    expect(onCorregir).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("haceCuanto", () => {
  it("null => sin verificar", () => {
    expect(haceCuanto(null, AHORA)).toBe("sin verificar");
  });
  it("menos de un minuto => recién", () => {
    expect(haceCuanto(hace(20_000), AHORA)).toBe("recién");
  });
  it("minutos", () => {
    expect(haceCuanto(hace(MIN), AHORA)).toBe("hace 1 min");
    expect(haceCuanto(hace(12 * MIN + 30_000), AHORA)).toBe("hace 12 min");
    expect(haceCuanto(hace(59 * MIN), AHORA)).toBe("hace 59 min");
  });
  it("horas y días", () => {
    expect(haceCuanto(hace(60 * MIN), AHORA)).toBe("hace 1 h");
    expect(haceCuanto(hace(2 * 60 * MIN + 10 * MIN), AHORA)).toBe("hace 2 h");
    expect(haceCuanto(hace(25 * 60 * MIN), AHORA)).toBe("hace 1 d");
  });
  it("una fecha futura (reloj corrido) no da números negativos", () => {
    expect(haceCuanto(hace(-5 * MIN), AHORA)).toBe("recién");
  });
  it("una fecha inválida => sin verificar", () => {
    expect(haceCuanto("no-es-fecha", AHORA)).toBe("sin verificar");
  });
});

describe("opcionesUbicacion", () => {
  it("lista por número de fila solo los tramos públicos donde entra el grupo junto", () => {
    const filas = [
      fila(3, [tramo(31, 0, 4, { etiqueta: "A" }), tramo(32, 6, 8, { etiqueta: "B", orden: 2 })]),
      fila(1, [tramo(11, 7)]),
      fila(2, [tramo(21, 1), tramo(22, 0, 2, { tipo: "reservado", etiqueta: "Mamás", orden: 2 })]),
    ].map(vista);
    const r = opcionesUbicacion(filas, 3);
    expect(r.map((o) => o.tramo.id)).toEqual([21, 31]);
    expect(r.map((o) => o.texto)).toEqual(["Fila 2 · 7 libres", "Fila 3 · A · 4 libres"]);
  });

  it("devuelve vacío si no entra en ningún lado", () => {
    expect(opcionesUbicacion([vista(fila(1, [tramo(11, 7)]))], 3)).toEqual([]);
  });
});

describe("sede en el pendiente y resumen de sedes", () => {
  const catan: SedeVista = { sedeId: "s1", nombre: "Catán", porSeccion: { centro: { cantidad: 120, consumido: 78, quedan: 42, sectores: [] } }, completo: false };
  const tristan: SedeVista = { sedeId: "s2", nombre: "Tristán S.", porSeccion: { centro: { cantidad: 50, consumido: 30, quedan: 20, sectores: [] } }, completo: false };
  const soloIzq: SedeVista = { sedeId: "s3", nombre: "Moreno", porSeccion: { izquierda: { cantidad: 10, consumido: 1, quedan: 9, sectores: [] } }, completo: false };
  const conSede = (): PendienteVista => {
    const p = pendiente(3);
    return { ...p, pendiente: { ...p.pendiente, sedeId: "s1" } };
  };

  it("un pendiente con sede muestra '3 de Catán'", () => {
    armar([fila(1, [tramo(11, 0)])], [conSede()], {}, [catan]);
    expect(screen.getByText("3 de Catán")).toBeTruthy();
  });

  it("sin sede, o con una sede desconocida, no muestra 'de'", () => {
    armar([fila(1, [tramo(11, 0)])], [pendiente(3)], {}, [catan]);
    expect(screen.queryByText(/^3 de /)).toBeNull();
    cleanup();
    armar([fila(1, [tramo(11, 0)])], [conSede()], {}, []);
    expect(screen.queryByText(/^3 de /)).toBeNull();
  });

  it("resume las sedes con reserva en esta sección", () => {
    armar([fila(1, [tramo(11, 0)])], [], {}, [catan, tristan, soloIzq]);
    expect(screen.getByText("Catán 78/120 · Tristán S. 30/50")).toBeTruthy();
  });

  it("sin sedes no hay resumen", () => {
    armar([fila(1, [tramo(11, 0)])], [], {}, []);
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
  });
});

describe("sectores de la sede y aviso de fuera de sector", () => {
  const sectores: SectorVista[] = [
    { sectorId: 1, nombre: "Centro medio", filaDesde: 5, filaHasta: 8, cantidad: 20, quedan: 12 },
    { sectorId: 2, nombre: "Centro fondo", filaDesde: 9, filaHasta: 12, cantidad: 30, quedan: 30 },
  ];
  const catan = (sec = sectores): SedeVista => ({
    sedeId: "s1",
    nombre: "Catán",
    porSeccion: { centro: { cantidad: 50, consumido: 8, quedan: 42, sectores: sec } },
    completo: false,
  });
  const conSede = (): PendienteVista => {
    const p = pendiente(3);
    return { ...p, pendiente: { ...p.pendiente, sedeId: "s1" } };
  };

  it("el pendiente con sede muestra los sectores de su sede con sus filas", () => {
    armar([fila(1, [tramo(11, 0)])], [conSede()], {}, [catan()]);
    expect(screen.getByText("Sede Catán: Centro medio (filas 5–8), Centro fondo (filas 9–12)")).toBeTruthy();
  });

  it("sin sede, o con sección entera, no muestra la línea de sectores", () => {
    armar([fila(1, [tramo(11, 0)])], [pendiente(3)], {}, [catan()]);
    expect(screen.queryByText(/^Sede /)).toBeNull();
    cleanup();
    armar([fila(1, [tramo(11, 0)])], [conSede()], {}, [catan([{ sectorId: null, nombre: null, filaDesde: null, filaHasta: null, cantidad: 50, quedan: 42 }])]);
    expect(screen.queryByText(/^Sede /)).toBeNull();
  });

  describe("sugerencia dentro del sector de la sede", () => {
    const sectorFondo: SectorVista[] = [{ sectorId: 3, nombre: "Centro atrás", filaDesde: 14, filaHasta: 20, cantidad: 30, quedan: 30 }];
    const veinte = (ocupadasDesde14 = 0) =>
      Array.from({ length: 20 }, (_, i) => fila(i + 1, [tramo((i + 1) * 10, i + 1 >= 14 ? ocupadasDesde14 : 0)]));

    it("sede con sector en las filas 14–20: 'Sentar en Fila 14' y se sienta en su tramo", async () => {
      const user = userEvent.setup();
      const { onSentar } = armar(veinte(), [conSede()], {}, [catan(sectorFondo)]);
      expect(screen.queryByRole("button", { name: "Sentar en Fila 1" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Sentar en Fila 14" }));
      expect(onSentar).toHaveBeenCalledWith("p1", 140);
    });

    it("si las filas del sector no tienen lugar para el grupo, cae a la sugerencia general", () => {
      armar(veinte(8), [conSede()], {}, [catan(sectorFondo)]);
      expect(screen.getByRole("button", { name: "Sentar en Fila 1" })).toBeTruthy();
    });

    it("sin sede, o con sede de sección entera, sugiere la fila general", () => {
      armar(veinte(), [pendiente(3)], {}, [catan(sectorFondo)]);
      expect(screen.getByRole("button", { name: "Sentar en Fila 1" })).toBeTruthy();
      cleanup();
      armar(veinte(), [conSede()], {}, [catan([{ sectorId: null, nombre: null, filaDesde: null, filaHasta: null, cantidad: 50, quedan: 42 }])]);
      expect(screen.getByRole("button", { name: "Sentar en Fila 1" })).toBeTruthy();
    });
  });

  it("si sentar vuelve con fueraDeSector muestra un aviso con la sede y los sectores, sin bloquear", async () => {
    const user = userEvent.setup();
    const onSentar = vi.fn(() => Promise.resolve({ ok: true, fueraDeSector: ["Centro medio", "Centro fondo"] }));
    armar([fila(1, [tramo(11, 0)])], [conSede()], { onSentar }, [catan()]);
    expect(screen.queryByText(/fuera del sector/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sentar en Fila 1" }));

    expect(onSentar).toHaveBeenCalledWith("p1", 11);
    expect(await screen.findByText("Esa fila está fuera del sector asignado a Catán: Centro medio, Centro fondo")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(/fuera del sector/)).toBeNull();
  });

  it("sin fueraDeSector no hay aviso", async () => {
    const user = userEvent.setup();
    const { onSentar } = armar([fila(1, [tramo(11, 0)])], [conSede()], {}, [catan()]);
    await user.click(screen.getByRole("button", { name: "Sentar en Fila 1" }));
    expect(onSentar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/fuera del sector/)).toBeNull();
  });
});
