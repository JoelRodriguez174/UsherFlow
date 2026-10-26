import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "..");

// Sin exclusiones: todo componente y página debe usar tokens, nunca hex.
const EXCLUIDOS_LEGACY: readonly string[] = [];

const HEX = /#[0-9a-fA-F]{3,8}\b/;

function archivosTsx(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosTsx(completo));
    else if (entrada.name.endsWith(".tsx") && !entrada.name.endsWith(".test.tsx")) {
      salida.push(completo);
    }
  }
  return salida;
}

function todos(): string[] {
  return ["components", "app"]
    .flatMap((carpeta) => archivosTsx(path.join(RAIZ, carpeta)))
    .map((f) => path.relative(RAIZ, f).split(path.sep).join("/"));
}

describe("sin colores hex en componentes y páginas", () => {
  const relativos = todos().filter((f) => !EXCLUIDOS_LEGACY.includes(f));

  it("encuentra archivos para revisar", () => {
    expect(relativos.length).toBeGreaterThan(0);
  });

  it.each(relativos)("%s no contiene hex", (relativo) => {
    const texto = readFileSync(path.join(RAIZ, relativo), "utf8");
    expect(texto.match(HEX)?.[0] ?? null).toBeNull();
  });

  it("no hay exclusiones", () => {
    expect(EXCLUIDOS_LEGACY).toEqual([]);
  });
});
