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
      expect(p.toLowerCase()).not.toContain("talla");
    }
  });

  it("encendida: la acción lleva size y la regla de separar nombre base y talla", () => {
    const p = prompt(true);
    expect(p).toContain('"size":"<talla que pidió el cliente');
    expect(p).toMatch(/NO la pongas en query: ponla en size/);
    // 028 (FR-1309): el nombre base va en singular.
    expect(p).toContain('"query":"<nombre base del producto, en singular y sin la talla, o su SKU>"');
    expect(p).toMatch(/en singular \(playera, no playeras\)/);
  });

  it("encendida: describe check_stock y las reglas de no inventar", () => {
    const p = prompt(true);
    expect(p).toContain('{"action":"check_stock","query":');
    expect(p).toMatch(/antes de afirmar/i);
    expect(p).toMatch(/nunca inventes/i);
    expect(p).toMatch(/SKU/);
  });
});

/**
 * 032 — `send_catalog` en el prompt (FR-1701, FR-1712): solo con la bandera; para
 * preguntas generales (un producto concreto sigue siendo `check_stock`), y con la
 * advertencia de que la frase de entrada no promete el adjunto: si no hay catálogo,
 * esa frase sale sola.
 */
describe("032 — el prompt y el catálogo PDF", () => {
  it("encendida: la acción, sin prometer el adjunto, para preguntas generales", () => {
    const p = prompt(true);
    expect(p).toContain('{"action":"send_catalog","reply":"..."}');
    expect(p).toMatch(/NO debe prometer el adjunto/);
    expect(p).toMatch(/preguntas generales \(qué venden, qué tienen, si hay catálogo\) → send_catalog/);
    expect(p).toMatch(/un producto concreto → check_stock/);
  });

  it("encendida (US3): no describe el catálogo; existencia y precio, solo con check_stock; manda el inventario", () => {
    const p = prompt(true);
    expect(p).toContain("NUNCA describas, resumas ni cites el catálogo: no lo ves");
    expect(p).toMatch(/existencia y precio solo con check_stock/i);
    expect(p).toMatch(
      /si lo que el cliente cita del catálogo no coincide con el inventario, manda el inventario/i
    );
  });

  it("encendida (FR-1709): el prompt no trae ninguna dirección", () => {
    expect(prompt(true)).not.toMatch(/https?:\/\//);
  });

  it("encendida: aceptar el ofrecimiento del sistema («¿te lo mando?») también es send_catalog", () => {
    expect(prompt(true)).toMatch(
      /Si el sistema ofreció el catálogo \(«¿te lo mando\?»\) y el cliente acepta → send_catalog/
    );
  });

  it("apagada (o sin decir nada): ni la acción ni el catálogo", () => {
    for (const p of [prompt(false), prompt(undefined)]) {
      expect(p).not.toContain("send_catalog");
      expect(p.toLowerCase()).not.toContain("catálogo");
    }
  });
});
