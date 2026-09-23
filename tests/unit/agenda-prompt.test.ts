import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";

/**
 * 015 (FR-023) — El prompt le enseña al modelo los huecos YA OFRECIDOS en la
 * conversación con su instante exacto.
 *
 * Por qué existe este archivo, con la evidencia de LanCo del 2026-09-17: el
 * modelo solo veía en el historial «hoy jueves, 17 de septiembre a las 16:00»
 * —sin año ni zona— y el motor compara `book_slot` por epoch exacto, a
 * propósito. Resultado: ofrecía bien y después re-ofrecía en bucle; ninguna
 * cita. Estos tests afirman que el ISO viaja. Si alguien lo quita "porque el
 * historial ya dice la hora", se ponen rojos — el historial NO dice el ISO.
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

const ofrecidos = [
  { label: "jue 17 sep, 16:00", startUtc: "2026-09-17T22:00:00.000Z" },
  { label: "jue 17 sep, 16:30", startUtc: "2026-09-17T22:30:00.000Z" },
];

function prompt(input: {
  agenda?: boolean;
  offeredSlots?: { label: string; startUtc: string }[];
}) {
  return buildAgentSystemPrompt({
    profile,
    kb: [],
    stages: [{ name: "Nuevo" }],
    ...input,
  });
}

describe("015 — el prompt y los horarios ofrecidos (FR-023)", () => {
  it("con agenda y ofrecidos: la lista lleva etiqueta E instante exacto, numerada", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toContain("HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN");
    expect(p).toContain('1. jue 17 sep, 16:00 → startUtc "2026-09-17T22:00:00.000Z"');
    expect(p).toContain('2. jue 17 sep, 16:30 → startUtc "2026-09-17T22:30:00.000Z"');
  });

  it("…y la regla manda copiar el startUtc tal cual, nunca calcularlo", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toMatch(/copia su startUtc TAL CUAL/);
    expect(p).toMatch(/«El primero» es el 1 de esa lista/);
    expect(p).toContain('"startUtc":"<el startUtc EXACTO de uno de los HORARIOS OFRECIDOS');
  });

  it("con agenda y sin ofrecidos: lo dice, y manda ofrecer primero", () => {
    for (const p of [prompt({ agenda: true }), prompt({ agenda: true, offeredSlots: [] })]) {
      expect(p).toContain("HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN: ninguno todavía");
      expect(p).toContain("primero offer_slots");
      expect(p).not.toContain("→ startUtc");
    }
  });

  it("sin agenda: ni una palabra de horarios ofrecidos, aunque se pasen", () => {
    for (const p of [prompt({ agenda: false, offeredSlots: ofrecidos }), prompt({ offeredSlots: ofrecidos })]) {
      expect(p).not.toContain("HORARIOS OFRECIDOS");
      expect(p).not.toContain("2026-09-17T22:00:00.000Z");
      expect(p).not.toContain("book_slot");
    }
  });
});

/**
 * 015 (ajuste 2026-09-23) — La otra mitad del fallo de LanCo fue de REDACCIÓN:
 * el agente afirmó «a las 11:00 no tengo disponibilidad» cuando las 11:00
 * estaban libres. No podía saberlo —no estaban en su lista—, así que la regla
 * le prohíbe afirmarlo.
 */
describe("015 — el prompt prohíbe declarar falta de disponibilidad (ajuste 2026-09-23)", () => {
  it("dice que la lista es más ancha que el menú y manda buscar la hora pedida", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toMatch(/búscalos en HORARIOS OFRECIDOS y reserva ese/);
    expect(p).toMatch(/muchos más de los tres que se le enseñaron/);
  });

  it("prohíbe afirmar ocupado/lleno/sin disponibilidad, y manda volver a ofrecer", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toMatch(/NUNCA afirmes que está ocupado, lleno o que no hay disponibilidad/);
    expect(p).toMatch(/di que lo confirmas y usa offer_slots/);
  });

  it("sin agenda, ninguna de esas reglas aparece", () => {
    const p = prompt({ agenda: false, offeredSlots: ofrecidos });
    expect(p).not.toMatch(/no hay disponibilidad/);
    expect(p).not.toMatch(/HORARIOS OFRECIDOS/);
  });
});
