import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";

/**
 * 026 — El prompt habla de inventario SOLO con la bandera (FR-1109, SC-004):
 * apagada, ni un token; encendida, la acción y las reglas que evitan que el
 * agente prometa lo que no hay.
 */

const profile = {
  id: "ap_1",
  organizationId: "org_1",
  name: "Uni",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  enabled: true,
} as unknown as typeof schema.agentProfile.$inferSelect;

function prompt(inventario: boolean | undefined) {
  return buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }], inventario });
}

describe("026 — el prompt y el inventario", () => {
  it("apagada (o sin decir nada): no menciona inventario ni la acción", () => {
    for (const p of [prompt(false), prompt(undefined)]) {
      expect(p).not.toContain("check_stock");
      expect(p.toLowerCase()).not.toContain("inventario");
      expect(p.toLowerCase()).not.toContain("existencia");
    }
  });

  it("encendida: describe check_stock y las reglas de no inventar", () => {
    const p = prompt(true);
    expect(p).toContain('{"action":"check_stock","query":');
    expect(p).toMatch(/antes de afirmar/i);
    expect(p).toMatch(/nunca inventes/i);
    expect(p).toMatch(/SKU/);
  });
});
