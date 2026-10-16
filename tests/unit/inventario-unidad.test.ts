import { describe, expect, it } from "vitest";
import { unidadPara } from "@/server/inventario/unidad";

/**
 * La unidad de la existencia en plural (2026-10-15). MS-Stock la guarda como texto
 * libre del negocio, así que la regla pluraliza las palabras que reconoce y deja
 * igual las abreviaturas, los símbolos y lo que no entiende.
 */

describe("unidadPara — plural de la unidad del negocio", () => {
  it("con cantidad 1 la unidad queda tal cual", () => {
    for (const u of ["pieza", "caja", "par", "galón", "kg", "Pieza"]) {
      expect(unidadPara(u, 1), u).toBe(u);
    }
  });

  it("las unidades de palabra comunes van en plural (incluidas las de MS-Stock)", () => {
    const casos: [string, string][] = [
      ["pieza", "piezas"],
      ["litro", "litros"],
      ["caja", "cajas"],
      ["par", "pares"],
      ["metro", "metros"],
      ["rollo", "rollos"],
      ["bolsa", "bolsas"],
      ["paquete", "paquetes"],
      ["unidad", "unidades"],
      ["millar", "millares"],
      ["barril", "barriles"],
      ["galón", "galones"],
      ["almacén", "almacenes"],
      ["lápiz", "lápices"],
      ["café", "cafés"],
      ["kit", "kits"],
      ["set", "sets"],
      ["juego", "juegos"],
      ["servicio", "servicios"],
      ["sesión", "sesiones"],
      ["Pieza", "Piezas"],
    ];
    for (const [u, plural] of casos) expect(unidadPara(u, 14), u).toBe(plural);
  });

  it("las abreviaturas y símbolos no se tocan", () => {
    for (const u of ["kg", "g", "m", "cm", "mm", "km", "ml", "L", "l", "lt", "lts", "pz", "pzs", "pza", "pza.", "pzas", "ud", "uds", "und", "gal", "oz", "lb", "PZA", "KG", "m²", "m2"]) {
      expect(unidadPara(u, 14), u).toBe(u);
    }
  });

  it("lo que ya termina en -s o -x queda igual (no se duplica ni se singulariza)", () => {
    for (const u of ["piezas", "litros", "pares", "lunes", "tórax"]) {
      expect(unidadPara(u, 3), u).toBe(u);
      expect(unidadPara(u, 1), u).toBe(u);
    }
  });

  it("varias palabras: se pluraliza hasta la preposición, el número o la abreviatura", () => {
    expect(unidadPara("caja de 12", 3)).toBe("cajas de 12");
    expect(unidadPara("paquete con 100 hojas", 2)).toBe("paquetes con 100 hojas");
    expect(unidadPara("metro cuadrado", 5)).toBe("metros cuadrados");
    expect(unidadPara("rollo 50 m", 4)).toBe("rollos 50 m");
    expect(unidadPara("bolsa 1 kg", 2)).toBe("bolsas 1 kg");
    expect(unidadPara("caja x 12", 2)).toBe("cajas x 12");
  });

  it("cantidades con fracción también van en plural", () => {
    expect(unidadPara("litro", 2.5)).toBe("litros");
    expect(unidadPara("metro", 0.5)).toBe("metros");
    expect(unidadPara("kg", 2.5)).toBe("kg");
  });
});
