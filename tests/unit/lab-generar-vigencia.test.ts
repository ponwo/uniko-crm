import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 033 (FR-1841) — El generador de escenarios parte SOLO de lo vigente, y
 * distingue «no hay conocimiento» de «todo lo tuyo venció».
 *
 * Decirle «carga tu base» a quien sí la tiene, solo que vencida, lo mandaría a
 * escribir de nuevo lo que ya escribió: lo que necesita es renovar fechas. Este
 * camino no lo cubre el arnés (habría que vencer todo el conocimiento de la
 * instancia de pruebas), así que se prueba aquí.
 */

const { conocimientoVigente, conocimientoCompleto, chatJson } = vi.hoisted(() => ({
  conocimientoVigente: vi.fn(),
  conocimientoCompleto: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("@/server/kb/vigencia", () => ({ conocimientoVigente, conocimientoCompleto }));
vi.mock("@/lib/ai", () => ({ chatJson }));

const { generarEscenarios } = await import("@/server/lab/generar");

const vencida = {
  id: "kb_1",
  organizationId: "org_1",
  kind: "qa",
  question: "¿Promo?",
  answer: "El 2x1 hasta el 15.",
  content: null,
  validUntil: "2026-10-15",
  estado: "vencida",
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  conocimientoVigente.mockReset();
  conocimientoCompleto.mockReset();
  chatJson.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("033 — generar escenarios con conocimiento vencido", () => {
  it("todo vencido → motivo propio que pide renovar fechas, sin llamar al modelo", async () => {
    conocimientoVigente.mockResolvedValue([]);
    conocimientoCompleto.mockResolvedValue({ hoy: "2026-10-20", entradas: [vencida] });
    const r = await generarEscenarios("org_1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("kb_vencida");
    expect(r.detalle).toMatch(/Renueva la fecha/);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("sin ninguna entrada → sigue siendo «carga tu conocimiento»", async () => {
    conocimientoVigente.mockResolvedValue([]);
    conocimientoCompleto.mockResolvedValue({ hoy: "2026-10-20", entradas: [] });
    const r = await generarEscenarios("org_1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("kb_vacia");
  });

  it("lee el conocimiento por la puerta de lo VIGENTE (lo vencido no llega al generador)", async () => {
    conocimientoVigente.mockResolvedValue([]);
    conocimientoCompleto.mockResolvedValue({ hoy: "2026-10-20", entradas: [] });
    await generarEscenarios("org_1");
    expect(conocimientoVigente).toHaveBeenCalledWith("org_1");
  });
});
