import { describe, expect, it } from "vitest";
import { agentActionSchema, degradeAction } from "@/server/ai/actions";

/**
 * 026 — `check_stock` existe en el esquema del turno SOLO con la bandera
 * (FR-1108). Apagada, un modelo que la devolviera fallaría el parseo y el
 * pipeline haría lo de siempre con una salida inválida; encendida, la acción
 * llega tipada y, si el conector falla, se degrada como `offer_slots`.
 */

const check = { action: "check_stock", query: "playera negra", reply: "Déjame revisar." };

describe("026 — la acción check_stock", () => {
  it("con la bandera, la acepta con query de 2 a 100 y reply opcional", () => {
    const schema = agentActionSchema({ agenda: false, inventario: true });
    expect(schema.safeParse(check).success).toBe(true);
    expect(schema.safeParse({ action: "check_stock", query: "PLY-NEG" }).success).toBe(true);
    expect(schema.safeParse({ action: "check_stock", query: "a" }).success).toBe(false);
    expect(schema.safeParse({ action: "check_stock", query: "x".repeat(101) }).success).toBe(false);
  });

  it("tallas: size opcional de 1 a 20 caracteres (se recorta); vacía o larga ⇒ inválida", () => {
    const schema = agentActionSchema({ agenda: false, inventario: true });
    const parsed = schema.safeParse({ ...check, size: " G " });
    expect(parsed.success && parsed.data.action === "check_stock" && parsed.data.size).toBe("G");
    expect(schema.safeParse({ ...check, size: "" }).success).toBe(false);
    expect(schema.safeParse({ ...check, size: "x".repeat(21) }).success).toBe(false);
    // Degradar conserva la frase aunque venga talla.
    expect(degradeAction({ action: "check_stock", query: "x", size: "G", reply: "Veo." })).toEqual({
      action: "reply",
      text: "Veo.",
    });
  });

  it("sin la bandera, la acción no existe en el esquema", () => {
    const schema = agentActionSchema({ agenda: false, inventario: false });
    expect(schema.safeParse(check).success).toBe(false);
    // Las de siempre siguen ahí, y la agenda sigue mandando por su cuenta.
    expect(schema.safeParse({ action: "reply", text: "hola" }).success).toBe(true);
    expect(
      agentActionSchema({ agenda: true, inventario: false }).safeParse({ action: "offer_slots" })
        .success
    ).toBe(true);
  });

  it("degradar check_stock: reply si la hay, none si no", () => {
    expect(degradeAction({ action: "check_stock", query: "x", reply: "Déjame revisar." })).toEqual({
      action: "reply",
      text: "Déjame revisar.",
    });
    expect(degradeAction({ action: "check_stock", query: "x" })).toEqual({ action: "none" });
  });
});
