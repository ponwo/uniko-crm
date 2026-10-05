import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * 026 — El ai-mock solo propone `check_stock` si el system prompt la menciona.
 * Con la bandera apagada el esquema del turno no la conoce, así que una regla
 * incondicional haría escalar a humano a la corrida `default` de la matriz por
 * culpa del mock, no del producto.
 */

const CON = 'Eres "Uni". - {"action":"check_stock","query":"..."} - consultar existencias';
const SIN = 'Eres "Uni". - {"action":"reply","text":"..."}';

function run(system: string, user: string) {
  return JSON.parse(
    aiMockCompletion([
      { role: "system", content: system },
      { role: "user", content: user },
    ])
  );
}

describe("026 — ai-mock y check_stock", () => {
  it("con el marcador en el prompt, '¿tienen X?' consulta X", () => {
    expect(run(CON, "¿tienen playera negra?")).toEqual({
      action: "check_stock",
      query: "playera negra",
      reply: "Déjame revisar.",
    });
    expect(run(CON, "Hola, ¿hay gorra?").query).toBe("gorra");
  });

  it("tallas (005): '… en G', '… talla G' y '… en talla G' separan nombre base y talla", () => {
    expect(run(CON, "¿tienen playera roja en G?")).toEqual({
      action: "check_stock",
      query: "playera roja",
      size: "G",
      reply: "Déjame revisar.",
    });
    expect(run(CON, "¿tienen playera roja talla M?")).toMatchObject({ query: "playera roja", size: "M" });
    expect(run(CON, "¿hay playera roja en talla XXG?")).toMatchObject({ query: "playera roja", size: "XXG" });
    // 028: talla de varias palabras y plural tal cual (el stock-mock lo tolera, como MS-Stock).
    expect(run(CON, "¿tienen playeras en extra chica?")).toMatchObject({ query: "playeras", size: "extra chica" });
    expect(run(CON, "¿tienen pantalones en 40?")).toMatchObject({ query: "pantalones", size: "40" });
    expect(run(CON, "¿tienen playera negra?")).not.toHaveProperty("size");
  });

  it("'cuánto cuesta la PLY-NEG' quita el artículo y deja el SKU", () => {
    expect(run(CON, "¿cuánto cuesta la PLY-NEG?").query).toBe("PLY-NEG");
    expect(run(CON, "precio de las tazas").query).toBe("tazas");
  });

  it("sin el marcador, la misma pregunta recibe el eco de siempre", () => {
    const out = run(SIN, "¿tienen playera negra?");
    expect(out.action).toBe("reply");
    expect(out.text).toContain("Respuesta de prueba");
  });

  it("las reglas anteriores siguen mandando (humano, compra)", () => {
    expect(run(CON, "quiero hablar con un humano").action).toBe("handoff");
    expect(run(CON, "lo compro").action).toBe("move_stage");
  });
});

/**
 * 032 — `send_catalog` (FR-1714): solo si el prompt la ofrece, y antes que
 * `check_stock` («¿tienes catálogo?» trae un «tienes» que check_stock leería como
 * producto). Las frases van ancladas: una pregunta por un producto, aunque mencione
 * el catálogo, sigue siendo check_stock.
 */
const CON_CATALOGO = `${CON} - {"action":"send_catalog","reply":"..."} - catálogo PDF`;

describe("032 — ai-mock y send_catalog", () => {
  it("con la acción en el prompt, las preguntas generales piden el catálogo", () => {
    const generales = [
      "¿qué venden?",
      "¿Qué tienen?",
      "que manejan?",
      "¿tienes catálogo?",
      "¿tienen catalogo?",
      "mándame el catálogo",
      "¿me puedes enviar el catálogo?",
      "pásame el catálogo",
    ];
    for (const pregunta of generales) {
      expect(run(CON_CATALOGO, pregunta), pregunta).toEqual({ action: "send_catalog", reply: "¡Claro!" });
    }
  });

  it("«catálogo completo» trae una frase de más de 1024 caracteres (para ejercitar el recorte del pie)", () => {
    const out = run(CON_CATALOGO, "mándame el catálogo completo");
    expect(out.action).toBe("send_catalog");
    expect(out.reply.length).toBeGreaterThan(1024);
    expect(out.reply.startsWith("¡Claro!")).toBe(true);
  });

  it("una pregunta por un producto sigue siendo check_stock, aunque mencione el catálogo", () => {
    expect(run(CON_CATALOGO, "¿tienen playera negra?")).toEqual({
      action: "check_stock",
      query: "playera negra",
      reply: "Déjame revisar.",
    });
    expect(
      run(
        CON_CATALOGO,
        "En el catálogo dice que la playera negra cuesta $150, ¿cuánto cuesta la playera negra?"
      )
    ).toMatchObject({ action: "check_stock", query: "playera negra" });
  });

  it("la frase de la persona del Laboratorio («¿Qué es lo más popular que tienen?») no la dispara", () => {
    expect(run(CON_CATALOGO, "¿Qué es lo más popular que tienen?").action).not.toBe("send_catalog");
  });

  it("sin la acción en el prompt, nunca la propone", () => {
    expect(run(CON, "¿qué venden?").action).not.toBe("send_catalog");
    expect(run(SIN, "¿qué venden?").action).toBe("reply");
    expect(run(SIN, "mándame el catálogo").action).toBe("reply");
  });
});
