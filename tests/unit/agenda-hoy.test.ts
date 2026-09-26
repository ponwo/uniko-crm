import { describe, expect, it } from "vitest";
import { nowLabelInTz } from "@/lib/time/slots";
import { withDayMarkers } from "@/server/ai/history";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";

/**
 * 015 (ajuste 2026-09-26) — El agente sabe en qué día vive.
 *
 * Encontrado en producción por el dueño, DOS veces seguidas. Una conversación
 * retomada dos días después arrastraba este mensaje del agente:
 *
 *   «Tu cita quedó agendada para mañana jueves a las 10:00 am 🎉»
 *
 * El cliente escribió «hola quisiera agendar una cita» y el agente contestó
 * «ya tienes una cita para mañana jueves 24» — un viernes 25. Dos agujeros a
 * la vez: el prompt no decía qué día era hoy, y en el hilo que ve el modelo
 * veinte mensajes seguidos no llevan ninguna marca de tiempo, como si fueran
 * de la misma tarde.
 */

const TZ = "America/Mexico_City";
/** Viernes 25 de septiembre de 2026, 21:57 en México. */
const AHORA = new Date("2026-09-26T03:57:00.000Z");

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

describe("015 — nowLabelInTz", () => {
  it("dice día, fecha, AÑO y hora en la zona del negocio", () => {
    const s = nowLabelInTz(AHORA, TZ);
    expect(s).toMatch(/viernes/i);
    expect(s).toContain("25");
    expect(s).toMatch(/septiembre/i);
    // El año importa: sin él, «jueves 24» es ambiguo entre años.
    expect(s).toContain("2026");
    expect(s).toContain("21:57");
  });

  it("una fecha inválida no revienta el turno", () => {
    expect(nowLabelInTz(new Date("nada"), TZ)).toBe("");
  });
});

describe("015 — el prompt dice qué hora es", () => {
  it("con `ahora`, lo pone y explica para qué sirve", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
      ahora: nowLabelInTz(AHORA, TZ),
    });
    // El locale es-MX mete coma tras el día: «viernes, 25 de septiembre…».
    expect(p).toMatch(/AHORA ES: viernes, 25 de septiembre de 2026, 21:57/);
    expect(p).toMatch(/qué fechas del historial YA PASARON/);
  });

  it("y prohíbe repetir una cita vista en el historial como si siguiera en pie", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
    });
    expect(p).toMatch(/un «mañana a las 10» dicho hace dos días ya pasó/);
    expect(p).toMatch(/NUNCA repitas una cita que viste en el historial/);
  });

  it("sin `ahora` no aparece el bloque", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
    });
    expect(p).not.toContain("AHORA ES:");
  });
});

describe("015 — el hilo lleva marcado dónde empieza lo de hoy", () => {
  const viejo = new Date("2026-09-24T04:25:00.000Z"); // 23 sep, 22:25 en México
  const deHoy = new Date("2026-09-26T03:32:00.000Z"); // 25 sep, 21:32

  it("un hilo que cruza días avisa de lo viejo y de dónde empieza hoy", () => {
    const out = withDayMarkers(
      [
        { role: "assistant", content: "Tu cita quedó agendada para mañana jueves", at: viejo },
        { role: "user", content: "hola quisiera agendar una cita", at: deHoy },
      ],
      { timezone: TZ, now: AHORA }
    );
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toMatch(/conversación ANTERIOR/);
    expect(out[0]?.content).toMatch(/no la des por vigente/);
    expect(out[2]?.role).toBe("system");
    expect(out[2]?.content).toBe("(Lo que sigue es de HOY.)");
    // Los mensajes siguen ahí, en su orden y sin tocar su texto.
    expect(out.filter((m) => m.role !== "system").map((m) => m.content)).toEqual([
      "Tu cita quedó agendada para mañana jueves",
      "hola quisiera agendar una cita",
    ]);
  });

  it("si todo es de hoy, no se marca nada (el hilo se lee solo)", () => {
    const out = withDayMarkers(
      [
        { role: "user", content: "hola", at: deHoy },
        { role: "assistant", content: "¡hola!", at: deHoy },
      ],
      { timezone: TZ, now: AHORA }
    );
    expect(out.every((m) => m.role !== "system")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("un hilo entero de días pasados avisa, aunque no haya nada de hoy", () => {
    const out = withDayMarkers(
      [{ role: "assistant", content: "para mañana jueves", at: viejo }],
      { timezone: TZ, now: AHORA }
    );
    expect(out[0]?.role).toBe("system");
    expect(out).toHaveLength(2);
  });

  it("sin mensajes, sin marcas", () => {
    expect(withDayMarkers([], { timezone: TZ, now: AHORA })).toEqual([]);
  });
});
