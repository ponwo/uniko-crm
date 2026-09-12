import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProduct,
  health,
  lookup,
  looksLikeSku,
  searchProducts,
} from "@/server/inventario/client";

/**
 * 026 — El adaptador de MS-Stock (FR-1110, FR-1114): el único módulo que
 * conoce HTTP de MS-Stock. Devuelve resultados tipados, nunca lanza, respeta
 * los 3 s y no reintenta. Todo con `fetch` falso: aquí no hay red.
 */

const KEY = "k".repeat(40);
const PRODUCT = {
  sku: "PLY-NEG",
  name: "Playera negra",
  description: null,
  stock: 7,
  unit: "pieza",
  price: 199,
  currency: "MXN",
  available: true,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("026 — adaptador de MS-Stock", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("INVENTARIO", "on");
    vi.stubEnv("STOCK_BASE_URL", "https://stock.example/");
    vi.stubEnv("STOCK_API_KEY", KEY);
    vi.stubEnv("STOCK_SSO_SECRET", "s".repeat(40));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("producto exacto: 200 → datos, con la llave en X-API-Key y la URL del contrato", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(PRODUCT));
    vi.stubGlobal("fetch", fetchMock);
    const r = await getProduct("ply-neg");
    expect(r).toEqual({ ok: true, data: PRODUCT });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stock.example/v1/agent/products/PLY-NEG");
    expect(new Headers(init.headers).get("x-api-key")).toBe(KEY);
  });

  it("mapea los status a errores tipados sin lanzar", async () => {
    const cases: [number, string][] = [
      [404, "not_found"],
      [401, "unauthorized"],
      [503, "unavailable"],
      [500, "unavailable"],
      [422, "invalid"],
    ];
    for (const [status, error] of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ error: { code: "X", message: "x" } }, status))
      );
      expect(await getProduct("PLY-NEG"), `status ${status}`).toEqual({ ok: false, error });
    }
  });

  it("JSON roto o forma inválida → invalid (nunca datos a medias)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))
    );
    expect(await getProduct("PLY-NEG")).toEqual({ ok: false, error: "invalid" });
    const { stock: _omitido, ...sinStock } = PRODUCT;
    void _omitido;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(sinStock)));
    expect(await getProduct("PLY-NEG")).toEqual({ ok: false, error: "invalid" });
  });

  it("fallo de red → network; la llave no aparece en el log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getProduct("PLY-NEG")).toEqual({ ok: false, error: "network" });
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    error.mockRestore();
  });

  it("una respuesta que nunca llega → timeout en ~3 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      )
    );
    const pending = getProduct("PLY-NEG");
    await vi.advanceTimersByTimeAsync(3_100);
    expect(await pending).toEqual({ ok: false, error: "timeout" });
  });

  it("búsqueda: q y limit en la URL; 200 → results + truncated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ results: [PRODUCT], truncated: true }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await searchProducts("playera negra");
    expect(r).toEqual({ ok: true, data: { results: [PRODUCT], truncated: true } });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://stock.example/v1/agent/search?q=playera+negra&limit=5");
  });

  it("lookup con forma de SKU: exacto primero y, si 404, la búsqueda", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: "NOT_FOUND", message: "" } }, 404))
      .mockResolvedValueOnce(json({ results: [PRODUCT], truncated: false }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await lookup("PLY-NEG");
    expect(r).toEqual({ ok: true, data: { products: [PRODUCT], truncated: false } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/v1/agent/products/PLY-NEG");
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("/v1/agent/search?q=PLY-NEG");
  });

  it("lookup con forma de SKU y 200: no busca de más", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(PRODUCT));
    vi.stubGlobal("fetch", fetchMock);
    const r = await lookup("PLY-NEG");
    expect(r).toEqual({ ok: true, data: { products: [PRODUCT], truncated: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lookup con texto libre va directo a la búsqueda", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ results: [], truncated: false }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await lookup("playera negra");
    expect(r).toEqual({ ok: true, data: { products: [], truncated: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/v1/agent/search");
  });

  it("health: 200 → ok, 503 → unavailable, sin llave", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ status: "ok", db: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await health()).toEqual({ ok: true, data: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stock.example/health");
    expect(new Headers(init.headers).get("x-api-key")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ status: "degraded" }, 503)));
    expect(await health()).toEqual({ ok: false, error: "unavailable" });
  });

  it("looksLikeSku distingue un SKU de una frase", () => {
    expect(looksLikeSku("PLY-NEG")).toBe(true);
    expect(looksLikeSku("ply-neg")).toBe(true);
    expect(looksLikeSku("A")).toBe(true);
    expect(looksLikeSku("playera negra")).toBe(false);
    expect(looksLikeSku("¿PLY-NEG?")).toBe(false);
    expect(looksLikeSku("X".repeat(65))).toBe(false);
    expect(looksLikeSku("")).toBe(false);
  });
});
