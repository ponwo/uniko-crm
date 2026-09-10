import { describe, expect, it } from "vitest";
import {
  claveDeEscenario,
  telefonoDeEscenario,
  validarGuion,
  validarRangoDeTelefono,
  type Propuesta,
} from "@/server/lab/guion";

/**
 * 021 Entrega 3 — Las reglas de un escenario propio (FR-627, FR-628).
 *
 * Todo lo que se prueba aquí es función pura: sin base de datos y sin mocks.
 * La mitad del chequeo de teléfono que SÍ consulta —si el número ya es de un
 * contacto real— vive en `escenarios.ts` y se prueba aparte, porque es la que
 * de verdad protege al inquilino.
 */

const guion = (script: string[]): Propuesta => ({
  label: "Un caso",
  description: "",
  script,
});

describe("el teléfono de un escenario propio (FR-628)", () => {
  it("es determinista: la misma clave da siempre el mismo número", () => {
    expect(telefonoDeEscenario("gen_precios_0_ab12")).toBe(
      telefonoDeEscenario("gen_precios_0_ab12")
    );
  });

  it("cae en el rango reservado y tiene la forma de un número de Meta", () => {
    const t = telefonoDeEscenario("cualquier_clave");
    expect(t.startsWith("5219")).toBe(true);
    expect(t).toHaveLength(13);
    expect(/^\d+$/.test(t)).toBe(true);
  });

  it("claves distintas dan números distintos", () => {
    const a = telefonoDeEscenario("gen_uno_0_aaaaa");
    const b = telefonoDeEscenario("gen_dos_1_bbbbb");
    expect(a).not.toBe(b);
  });

  /**
   * El bloque de los seis del producto es `5210000000001..6`, y tras
   * `normalizeMx` queda `520000000000…`. Se rechazan LAS DOS formas: si un
   * escenario propio pisara el contacto de prueba de uno del producto, las dos
   * familias se mezclarían en la misma conversación simulada.
   */
  it("rechaza el rango de los seis genéricos, en sus dos formas", () => {
    expect(validarRangoDeTelefono("5210000000001")).toBe("rango_de_genericos");
    expect(validarRangoDeTelefono("520000000001")).toBe("rango_de_genericos");
  });

  it("rechaza cualquier número fuera del rango reservado", () => {
    expect(validarRangoDeTelefono("5215512345678")).toBe(
      "fuera_del_rango_reservado"
    );
  });

  it("acepta uno del rango propio", () => {
    expect(validarRangoDeTelefono(telefonoDeEscenario("x"))).toBeNull();
  });
});

describe("el guion se sostiene solo (FR-627)", () => {
  it("acepta un guion normal", () => {
    expect(
      validarGuion(guion(["Hola, ¿tienen disponibilidad?", "¿Cuánto cuesta?"]))
    ).toBeNull();
  });

  it("exige entre 2 y 5 líneas", () => {
    expect(validarGuion(guion(["Hola"]))).toBe("pocas_lineas");
    expect(validarGuion(guion(["a", "b", "c", "d", "e", "f"]))).toBe(
      "muchas_lineas"
    );
  });

  it("rechaza líneas vacías y larguísimas", () => {
    expect(validarGuion(guion(["Hola", "   "]))).toBe("linea_vacia");
    expect(validarGuion(guion(["Hola", "x".repeat(501)]))).toBe("linea_larga");
  });

  it("exige nombre, y no uno kilométrico", () => {
    expect(validarGuion({ ...guion(["a", "b"]), label: " " })).toBe(
      "sin_etiqueta"
    );
    expect(
      validarGuion({ ...guion(["a", "b"]), label: "x".repeat(81) })
    ).toBe("etiqueta_larga");
  });

  /**
   * El corazón de FR-627: el cliente simulado no reacciona, dispara su
   * siguiente línea diga lo que diga el agente. Un guion que presupone una
   * respuesta evalúa al agente por no adivinar.
   */
  it("rechaza una línea que da por hecho lo que contestó el agente", () => {
    expect(
      validarGuion(guion(["¿Qué opciones tienen?", "Eso me interesa, ¿cuánto?"]))
    ).toBe("depende_del_contexto");
    expect(
      validarGuion(guion(["¿Qué tienen?", "El segundo, ¿cuánto sale?"]))
    ).toBe("depende_del_contexto");
  });

  /** Con acentos también: "último" tiene que casar con "ultimo". */
  it("lo detecta aunque venga acentuado", () => {
    expect(
      validarGuion(guion(["¿Qué tienen?", "El último que dijiste, ¿cuánto?"]))
    ).toBe("depende_del_contexto");
  });
});

describe("la clave de un escenario", () => {
  /**
   * Guarda contra un fallo real que tuvo este archivo: el regex que quita
   * acentos se escribió mal y borraba DÍGITOS. Una etiqueta con números
   * producía claves que no la representaban, y el fallo era invisible leyendo
   * el código.
   */
  it("conserva los dígitos de la etiqueta", () => {
    expect(claveDeEscenario("Plan 2024", 0)).toContain("2024");
  });

  it("quita acentos y deja algo legible", () => {
    const k = claveDeEscenario("Presupuestó rápido", 1);
    expect(k).toContain("presupuesto_rapido");
    expect(k.startsWith("gen_")).toBe(true);
  });

  it("no se queda sin cuerpo aunque la etiqueta sea solo símbolos", () => {
    expect(claveDeEscenario("¿¡!?", 0)).toContain("escenario");
  });
});
