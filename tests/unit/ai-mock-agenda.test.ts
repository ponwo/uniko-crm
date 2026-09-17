import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * 015 (FR-025) — El ai-mock ofrece y agenda SOLO si el system prompt nombra
 * la acción, y reserva ÚNICAMENTE copiando el startUtc del bloque HORARIOS
 * OFRECIDOS. Sin ese bloque no puede reservar —igual que un modelo real, que no
 * copia un ISO que no le enseñaron— y por eso el arnés detecta si el contexto
 * deja de viajar: se comporta como el LLM real en LanCo (re-ofrece en bucle).
 */

const ACCIONES =
  'Eres "Uni". - {"action":"offer_slots","reply":"..."} - {"action":"book_slot","startUtc":"..."}';
const CON_OFRECIDOS = [
  ACCIONES,
  "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN (los puso el sistema):",
  '1. jue 17 sep, 16:00 → startUtc "2026-09-17T22:00:00.000Z"',
  '2. jue 17 sep, 16:30 → startUtc "2026-09-17T22:30:00.000Z"',
].join("\n");
const SIN_AGENDA = 'Eres "Uni". - {"action":"reply","text":"..."}';

function run(system: string, user: string) {
  return JSON.parse(
    aiMockCompletion([
      { role: "system", content: system },
      { role: "user", content: user },
    ])
  );
}

describe("015 — ai-mock y la agenda", () => {
  it("«quiero agendar una cita» → offer_slots (el sistema pega los horarios)", () => {
    expect(run(ACCIONES, "Hola, quiero agendar una cita")).toEqual({
      action: "offer_slots",
      reply: "Claro, tengo estos horarios:",
    });
    expect(run(ACCIONES, "¿qué horarios tienen?").action).toBe("offer_slots");
  });

  it("«el primer horario» con el bloque en el prompt → book_slot con ESE startUtc, tal cual", () => {
    const r = run(CON_OFRECIDOS, "El primer horario, agéndamelo por favor");
    expect(r.action).toBe("book_slot");
    expect(r.startUtc).toBe("2026-09-17T22:00:00.000Z");
  });

  it("«el primero» SIN el bloque en el prompt → no puede reservar: vuelve a ofrecer", () => {
    // Es el fallo real de LanCo, modelado: sin el ISO a la vista no hay cita.
    expect(run(ACCIONES, "El primer horario, agéndamelo por favor").action).toBe("offer_slots");
  });

  it("sin la acción en el prompt (bandera apagada): el eco de siempre", () => {
    const r = run(SIN_AGENDA, "Hola, quiero agendar una cita");
    expect(r.action).toBe("reply");
    expect(r.text).toContain("Respuesta de prueba");
  });
});
