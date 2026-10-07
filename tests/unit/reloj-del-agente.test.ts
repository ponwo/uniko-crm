import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { schema as Schema } from "@/lib/db";

/**
 * 033 — El agente sabe qué día es, CON O SIN AGENDA, y lee el conocimiento
 * vigente contra ese mismo día.
 *
 * Hasta la 033 la fecha y los separadores del historial solo existían con la
 * agenda encendida: los negocios sin agenda —los dos clientes de la flota—
 * tenían un agente que no sabía qué día era, y para él ninguna promoción «hasta
 * el 15» podía vencer. Esta prueba corre el turno entero con la agenda APAGADA.
 */

const { chatJson, conocimientoVigente } = vi.hoisted(() => ({
  chatJson: vi.fn(),
  conocimientoVigente: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/kb/vigencia", () => ({ conocimientoVigente }));
vi.mock("@/server/agenda/settings", () => ({
  getSettings: async () => ({ timezone: "America/Tijuana" }),
}));
vi.mock("@/server/agenda/agent", () => ({
  offeredSlotsFor: async () => [],
  bookedInConversation: async () => null,
  offerSlots: vi.fn(),
  bookSlot: vi.fn(),
  moveSlot: vi.fn(),
}));

// BD simulada: cola de resultados de select (conversación, perfil, historial,
// etapas) y escrituras que no importan aquí.
const selectQueue: unknown[][] = [];
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({ values: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{}]) }) }) }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tabla) => new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }) }
  ),
}));

const { runAgentTurn } = await import("@/server/ai/pipeline");
const { buildAgentSystemPrompt } = await import("@/server/ai/prompts");

/** Miércoles 7 de octubre de 2026, 18:30 en México (= jueves 8, 00:30 UTC). */
const AHORA = new Date("2026-10-08T00:30:00.000Z");
const HACE_TRES_DIAS = new Date("2026-10-04T23:00:00.000Z");

const perfil = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Uni",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
};

function encolarTurno() {
  selectQueue.push(
    [
      {
        id: "cv_1",
        organizationId: "org_1",
        contactId: "ct_1",
        channel: "whatsapp",
        isTest: true,
        aiEnabled: true,
        handoffAt: null,
        lastInboundAt: AHORA,
      },
    ],
    [perfil],
    [
      // El historial llega en orden descendente (el pipeline lo invierte).
      { id: "m2", direction: "in", text: "¿sigue la promo?", createdAt: AHORA },
      {
        id: "m1",
        direction: "out",
        text: "¡Sí! El 2x1 es hasta el 5 de octubre.",
        createdAt: HACE_TRES_DIAS,
      },
    ],
    [{ id: "st_1", name: "Nuevo" }]
  );
}

const agendaAntes = process.env.AGENDA;
beforeEach(() => {
  selectQueue.length = 0;
  chatJson.mockReset();
  chatJson.mockResolvedValue({ ok: true, data: { action: "none" }, raw: "{}" });
  conocimientoVigente.mockReset();
  conocimientoVigente.mockResolvedValue([
    { id: "kb_1", kind: "qa", question: "¿Horario?", answer: "De 9 a 18.", content: null, validUntil: null },
  ]);
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  delete process.env.AGENDA;
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (agendaAntes === undefined) delete process.env.AGENDA;
  else process.env.AGENDA = agendaAntes;
});

function mensajesDelTurno(): { role: string; content: string }[] {
  expect(chatJson).toHaveBeenCalledTimes(1);
  return chatJson.mock.calls[0]![1] as { role: string; content: string }[];
}

describe("033 — el turno del agente SIN agenda", () => {
  it("el prompt dice qué día y hora es en el negocio (México)", async () => {
    encolarTurno();
    await runAgentTurn("cv_1", { ahora: AHORA });
    const sistema = mensajesDelTurno()[0]!.content;
    expect(sistema).toMatch(/AHORA ES: miércoles, 7 de octubre de 2026, 18:30/);
  });

  it("pide el conocimiento VIGENTE contra el mismo instante y la misma zona", async () => {
    encolarTurno();
    await runAgentTurn("cv_1", { ahora: AHORA });
    expect(conocimientoVigente).toHaveBeenCalledWith("org_1", {
      ahora: AHORA,
      zona: "America/Mexico_City",
    });
    expect(mensajesDelTurno()[0]!.content).toContain("P: ¿Horario?\nR: De 9 a 18.");
  });

  it("el historial marca lo de días anteriores y dónde empieza hoy", async () => {
    encolarTurno();
    await runAgentTurn("cv_1", { ahora: AHORA });
    const msgs = mensajesDelTurno();
    expect(msgs[1]).toMatchObject({ role: "system" });
    expect(msgs[1]!.content).toMatch(/conversación ANTERIOR/);
    expect(msgs[2]).toEqual({ role: "assistant", content: "¡Sí! El 2x1 es hasta el 5 de octubre." });
    expect(msgs[3]).toEqual({ role: "system", content: "(Lo que sigue es de HOY.)" });
    expect(msgs[4]).toEqual({ role: "user", content: "¿sigue la promo?" });
  });

  it("y la regla: lo dicho en días anteriores no se repite como vigente", async () => {
    encolarTurno();
    await runAgentTurn("cv_1", { ahora: AHORA });
    expect(mensajesDelTurno()[0]!.content).toMatch(
      /Lo que se dijo ahí sobre promociones, precios, fechas, cupos o inscripciones pudo cambiar: NUNCA lo repitas como vigente/
    );
  });
});

describe("033 — el turno del agente CON agenda", () => {
  it("la zona es la de la agenda: un solo «hoy» para horarios, fecha y conocimiento", async () => {
    process.env.AGENDA = "on";
    encolarTurno();
    await runAgentTurn("cv_1", { ahora: AHORA });
    expect(conocimientoVigente).toHaveBeenCalledWith("org_1", {
      ahora: AHORA,
      zona: "America/Tijuana",
    });
    // 00:30 UTC del 8 = 17:30 del 7 en Tijuana.
    expect(mensajesDelTurno()[0]!.content).toMatch(/AHORA ES: miércoles, 7 de octubre de 2026, 17:30/);
  });
});

describe("033 — el prompt (constructor)", () => {
  const profile = perfil as unknown as typeof Schema.agentProfile.$inferSelect;

  it("la regla del historial va siempre, con y sin agenda", () => {
    for (const agenda of [false, true]) {
      const p = buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }], agenda });
      expect(p).toMatch(/NUNCA lo repitas como vigente solo porque está en el historial/);
      expect(p).toMatch(/Lo vigente es lo que diga HOY el conocimiento del negocio/);
    }
  });

  it("la línea de la fecha sirve también para las fechas del conocimiento", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      ahora: "miércoles, 7 de octubre de 2026, 18:30",
    });
    expect(p).toMatch(/qué fechas del historial YA PASARON \(también las que mencione el conocimiento del negocio\)/);
  });
});
