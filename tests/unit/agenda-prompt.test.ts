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

/**
 * 015 (ajuste 2026-09-25) — Mover la cita es trabajo del agente; cancelar no.
 *
 * Medido en el Laboratorio de LanCo con el LLM real: ante «¿me la cambias a la
 * tarde?» escalaba a un humano. Y tenía razón con lo que sabía — el prompt solo
 * hablaba de cancelar, y él lo extendió. El motor sí sabe mover.
 */
describe("015 — mover vs cancelar en el prompt (ajuste 2026-09-25)", () => {
  it("con agenda: move_slot existe y se dice que mover es trabajo suyo", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toContain('"action":"move_slot"');
    expect(p).toMatch(/es trabajo TUYO: usa move_slot/);
    expect(p).toMatch(/No lo mandes con una persona por esto/);
  });

  it("…y cancelar SIGUE siendo de humanos, dicho como algo distinto de mover", () => {
    const p = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(p).toMatch(/CANCELAR una cita → handoff/);
    expect(p).toMatch(/Cancelar y mover no son lo mismo/);
  });

  it("sin agenda: ni move_slot ni la regla aparecen", () => {
    const p = prompt({ agenda: false, offeredSlots: ofrecidos });
    expect(p).not.toContain("move_slot");
    expect(p).not.toMatch(/Cancelar y mover/);
  });
});

/**
 * 015 (ajuste 2026-09-25) — El agente tiene que SABER si el cliente ya tiene
 * cita.
 *
 * Medido en el arnés: reservar borra los horarios ofrecidos, así que al pedir
 * un cambio el agente vuelve a ofrecer; y en el turno siguiente, sin este
 * hecho, emitía `book_slot` — el cliente acababa con DOS citas. En el historial
 * de la conversación ese dato no se ve.
 */
describe("015 — la cita actual viaja al prompt (ajuste 2026-09-25)", () => {
  it("con cita: la dice y prohíbe reservar una segunda", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
      offeredSlots: ofrecidos,
      citaActual: "sáb 26 sep, 10:30",
    });
    expect(p).toContain("CITA ACTUAL DE ESTE CLIENTE: sáb 26 sep, 10:30");
    expect(p).toMatch(/es MOVERLA \(move_slot\), NUNCA reservar una segunda/);
  });

  it("sin cita, o sin agenda, no aparece el bloque", () => {
    const sinCita = prompt({ agenda: true, offeredSlots: ofrecidos });
    expect(sinCita).not.toContain("CITA ACTUAL DE ESTE CLIENTE");
    const sinAgenda = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: false,
      citaActual: "sáb 26 sep, 10:30",
    });
    expect(sinAgenda).not.toContain("CITA ACTUAL DE ESTE CLIENTE");
  });
});
