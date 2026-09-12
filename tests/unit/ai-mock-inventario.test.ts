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
