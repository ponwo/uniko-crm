import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * 033 — El ai-mock contesta según el conocimiento que RECIBIÓ.
 *
 * Con el eco de siempre, «el dato vencido deja de afirmarse» pasaría aunque el
 * vencido llegara al prompt: el mock diría lo mismo supiera o no. Aquí se prueba
 * que sabe decir que NO sabe, y que solo cuenta la sección del conocimiento —no
 * el historial, donde el tema puede seguir apareciendo porque se habló de él.
 */

const prompt = (kb: string) =>
  [
    'Eres "Uni", el asistente de WhatsApp de este negocio.',
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad):\n${kb}`,
    "Etapas del pipeline disponibles: Nuevo | Interesado",
    "AHORA ES: miércoles, 7 de octubre de 2026, 18:30 (hora del negocio).",
  ].join("\n\n");

function run(system: string, ...turnos: { role: string; content: string }[]) {
  return JSON.parse(aiMockCompletion([{ role: "system", content: system }, ...turnos]));
}

describe("033 — ai-mock y el conocimiento", () => {
  it("el tema está en el conocimiento → SI_CONOZCO", () => {
    const r = run(prompt("P: ¿Hay promo?\nR: El 2x1 KBTOK-PROMO7 sigue."), {
      role: "user",
      content: "¿sigue la promo KBTOK-PROMO7?",
    });
    expect(r).toEqual({ action: "reply", text: "SI_CONOZCO KBTOK-PROMO7" });
  });

  it("el tema NO está → NO_CONOZCO, con el camino de siempre (lo confirma)", () => {
    const r = run(prompt("P: ¿Horario?\nR: De 9 a 18."), {
      role: "user",
      content: "¿sigue la promo KBTOK-PROMO7?",
    });
    expect(r.action).toBe("reply");
    expect(r.text).toMatch(/^NO_CONOZCO KBTOK-PROMO7: no cuento con esa información/);
  });

  it("que el tema siga en el HISTORIAL no lo vuelve conocimiento", () => {
    const r = run(
      prompt("(knowledge base vacío)"),
      { role: "user", content: "¿tienen promo KBTOK-PROMO7?" },
      { role: "assistant", content: "SI_CONOZCO KBTOK-PROMO7" },
      { role: "user", content: "¿y sigue la KBTOK-PROMO7?" }
    );
    expect(r.text).toMatch(/^NO_CONOZCO/);
  });

  it("un tema mencionado fuera de la sección del conocimiento tampoco cuenta", () => {
    const sistema = `${prompt("P: ¿Horario?\nR: De 9 a 18.")}\n\nNota: KBTOK-PROMO7`;
    expect(run(sistema, { role: "user", content: "¿KBTOK-PROMO7?" }).text).toMatch(/^NO_CONOZCO/);
  });

  it("sin token, el eco de siempre: ningún arnés existente cambia", () => {
    const r = run(prompt("P: ¿Horario?\nR: De 9 a 18."), {
      role: "user",
      content: "¿hacen envíos?",
    });
    expect(r.action).toBe("reply");
    expect(r.text).toContain("Respuesta de prueba");
  });
});
