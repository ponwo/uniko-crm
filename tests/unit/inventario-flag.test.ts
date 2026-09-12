import { describe, expect, it } from "vitest";
import { parseInventarioFlag } from "@/server/inventario/flag";

/**
 * 026 — La bandera del conector de inventario (FR-1101). Lo que importa es el
 * DEFAULT: una instancia que no lo pidió no debe acabar con un botón que lleva
 * a un portal que no existe ni con un agente que promete consultar existencias.
 */

describe("parseInventarioFlag", () => {
  it("sin variable, el conector no existe", () => {
    expect(parseInventarioFlag(undefined)).toBe(false);
    expect(parseInventarioFlag("")).toBe(false);
    expect(parseInventarioFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseInventarioFlag("on")).toBe(true);
    expect(parseInventarioFlag("ON")).toBe(true);
    expect(parseInventarioFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí (las mismas que AGENDA)", () => {
    for (const v of ["1", "true", "TRUE", "si", "sí", "yes"]) {
      expect(parseInventarioFlag(v), v).toBe(true);
    }
  });

  it("cualquier otra cosa lo deja apagado, incluido `off`, `false` y un typo", () => {
    for (const v of ["off", "false", "0", "no", "inventario", "onn"]) {
      expect(parseInventarioFlag(v), v).toBe(false);
    }
  });
});
