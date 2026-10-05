import { beforeEach, describe, expect, it } from "vitest";
import { aiMockSnapshot, recordAiMockCall, resetAiMock } from "@/server/dev/ai-mock-state";

/**
 * 032 — El ai-mock guarda el último prompt que recibió (system + historial) para que
 * el arnés PRUEBE que la URL del catálogo nunca llega al modelo (SC-004), en vez de
 * suponerlo. Como `lastModel`, vive solo en el entorno de pruebas.
 */
describe("032 — ai-mock: el último prompt", () => {
  beforeEach(() => resetAiMock());

  it("guarda el contenido de todos los mensajes del último turno", () => {
    recordAiMockCall("m1", [
      { role: "system", content: "Eres Uni. send_catalog" },
      { role: "user", content: "¿qué venden?" },
    ]);
    recordAiMockCall("m2", [
      { role: "system", content: "Eres Uni." },
      { role: "assistant", content: "¡Claro!" },
      { role: "user", content: "gracias" },
    ]);
    const s = aiMockSnapshot();
    expect(s.lastModel).toBe("m2");
    expect(s.lastPrompt).toContain("Eres Uni.");
    expect(s.lastPrompt).toContain("¡Claro!");
    expect(s.lastPrompt).toContain("gracias");
    expect(s.lastPrompt).not.toContain("send_catalog");
  });

  it("sin mensajes, lastPrompt es null; reset lo limpia", () => {
    recordAiMockCall("m1");
    expect(aiMockSnapshot().lastPrompt).toBeNull();
    recordAiMockCall("m1", [{ role: "user", content: "hola" }]);
    expect(aiMockSnapshot().lastPrompt).toBe("hola");
    resetAiMock();
    expect(aiMockSnapshot().lastPrompt).toBeNull();
    expect(aiMockSnapshot().lastModel).toBeNull();
  });
});
