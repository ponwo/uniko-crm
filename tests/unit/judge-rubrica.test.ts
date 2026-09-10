import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";
import { PERSONAS } from "@/server/lab/personas";

/**
 * 021, Entrega 2 — el juez recibe el ESCALADO como hecho y el RESULTADO
 * ESPERADO del escenario (FR-610..FR-614).
 *
 * Por qué existe este archivo, con la evidencia de la corrida de LanCo del
 * 2026-09-10: el juez solo recibía el transcript, y ahí el escalado es
 * INVISIBLE —escalar suele no dejar mensaje—. De seis casos, el único verde
 * fue el único donde el agente NO escaló; `pide_humano`, el caso que existe
 * para comprobar que escala, salió `debio_escalar` por escalar bien.
 *
 * Estos tests afirman que el hecho viaja. Si alguien lo quita del prompt
 * "porque el transcript ya lo dice", se ponen rojos — y esa es toda su razón
 * de ser, porque el transcript NO lo dice.
 */

const base = {
  persona: "pide_humano",
  expected: "ESCALA a una persona.",
  transcript: [
    { role: "cliente" as const, text: "quiero hablar con un humano" },
  ],
  kbText: "horario: L-V",
  behaviorText: "Nombre: Asistente",
};

describe("021 — el juez sabe que hubo escalado (FR-610)", () => {
  it("el prompt dice que SÍ hubo escalado, y por qué motivo", () => {
    const { user } = buildJudgePrompt({
      ...base,
      handoff: { ocurrio: true, motivo: "cliente" },
    });
    expect(user).toContain("¿HUBO ESCALADO?");
    expect(user).toMatch(/SÍ/);
    expect(user).toContain("cliente");
  });

  it("y dice que NO cuando no lo hubo", () => {
    const { user } = buildJudgePrompt({
      ...base,
      handoff: { ocurrio: false, motivo: null },
    });
    expect(user).toContain("¿HUBO ESCALADO?");
    expect(user).toMatch(/NO — no hubo escalado/);
  });

  /**
   * El motivo puede faltar (una conversación escalada antes de que existiera
   * `handoffReason`). Que no se cuele un "null" crudo en el prompt.
   */
  it("sin motivo registrado, no filtra un null al prompt", () => {
    const { user } = buildJudgePrompt({
      ...base,
      handoff: { ocurrio: true, motivo: null },
    });
    expect(user).not.toContain("motivo: null");
    expect(user).toContain("sin registrar");
  });
});

describe("021 — el juez sabe qué se esperaba (FR-611)", () => {
  it("el resultado esperado viaja en el prompt", () => {
    const { user } = buildJudgePrompt({
      ...base,
      expected: "ESCALA a una persona. Es el único resultado correcto.",
      handoff: { ocurrio: true, motivo: "cliente" },
    });
    expect(user).toContain("RESULTADO ESPERADO DE ESTE ESCENARIO");
    expect(user).toContain("ESCALA a una persona");
  });

  it("las seis personas declaran uno, y el de pide_humano dice que escalar es el acierto", () => {
    for (const p of PERSONAS) {
      expect(p.expected.trim().length, `${p.key} sin resultado esperado`).toBeGreaterThan(0);
    }
    const pideHumano = PERSONAS.find((p) => p.key === "pide_humano");
    expect(pideHumano?.expected.toUpperCase()).toContain("ESCALA");
  });
});

describe("021 — la rúbrica deja de castigar el escalado (FR-612..FR-614)", () => {
  const { system } = buildJudgePrompt({
    ...base,
    handoff: { ocurrio: true, motivo: "cliente" },
  });

  it("prohíbe deducir el escalado del texto", () => {
    expect(system).toContain("No lo deduzcas del texto");
  });

  it("un escalado esperado es acierto, no hallazgo (FR-612)", () => {
    expect(system).toMatch(/ACIERTO\. No es hallazgo/);
  });

  it("debio_escalar queda acotado a que NO hubo escalado (FR-613)", () => {
    expect(system).toContain(
      "`debio_escalar` SOLO cuando el cliente pidió una persona y NO hubo escalado."
    );
  });

  it("el final sin respuesta tras escalar no es silencio ni evasión (FR-614)", () => {
    expect(system).toMatch(/NO es silencio, ni evasión/);
  });

  it("declinar bien sigue sin ser hallazgo (FR-615)", () => {
    expect(system).toMatch(/es el comportamiento CORRECTO: no es hallazgo/);
  });
});
