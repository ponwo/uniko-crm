import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/dev/stock-mock/[...path]/route";
import { resetStockMock, stockMockSnapshot } from "@/server/dev/stock-mock-state";

/**
 * 026 — El MS-Stock de mentira responde como el de verdad (contrato de la
 * feature 003) y obedece los modos infelices. Si el mock miente, el self-test
 * prueba contra algo que no existe.
 */

const KEY = "desarrollo-local-stock-key-0123456789abcdef";
const SECRET = "desarrollo-local-sso-secret-0123456789abcdef";
const BASE = "http://localhost:3000/api/dev/stock-mock";

function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

function get(path: string, opts: { key?: string; query?: string } = {}) {
  const req = new Request(`${BASE}/${path}${opts.query ? `?${opts.query}` : ""}`, {
    headers: opts.key ? { "x-api-key": opts.key } : {},
  });
  return GET(req, ctx(path));
}

async function setMode(mode: string) {
  const req = new Request(`${BASE}/_mode`, { method: "POST", body: JSON.stringify({ mode }) });
  return POST(req, ctx("_mode"));
}

describe("026 — stock-mock", () => {
  beforeEach(() => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STOCK_API_KEY", KEY);
    vi.stubEnv("STOCK_SSO_SECRET", SECRET);
    vi.stubEnv("STOCK_BASE_URL", BASE);
    resetStockMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetStockMock();
  });

  it("en producción no existe (404), sea cual sea la ruta", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("health")).status).toBe(404);
    expect((await get("_state")).status).toBe(404);
  });

  it("/health sin llave → ok; /v1 sin llave o con otra → 401", async () => {
    expect((await get("health")).status).toBe(200);
    expect((await get("v1/agent/products/PLY-NEG")).status).toBe(401);
    expect((await get("v1/agent/products/PLY-NEG", { key: "otra" })).status).toBe(401);
    expect(stockMockSnapshot().calls).toEqual([
      { path: "/v1/agent/products/PLY-NEG", authorized: false },
      { path: "/v1/agent/products/PLY-NEG", authorized: false },
    ]);
  });

  it("producto exacto con la forma pública; minúsculas valen; inactivo → 404", async () => {
    const r = await get("v1/agent/products/ply-neg", { key: KEY });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      sku: "PLY-NEG",
      name: "Playera negra",
      description: "Algodón 100%",
      stock: 7,
      unit: "pieza",
      price: 199,
      currency: "MXN",
      available: true,
    });
    const inactive = await get("v1/agent/products/GOR-02", { key: KEY });
    expect(inactive.status).toBe(404);
    expect((await inactive.json()).error.code).toBe("NOT_FOUND");
  });

  it("búsqueda sin acentos ni mayúsculas, q corta → 422, limit acota y marca truncated", async () => {
    const r = await get("v1/agent/search", { key: KEY, query: "q=PLÁYERA" });
    const body = await r.json();
    expect(body.results.map((p: { sku: string }) => p.sku)).toEqual(["PLY-NEG", "PLY-BLA"]);
    expect(body.truncated).toBe(false);
    expect((await get("v1/agent/search", { key: KEY, query: "q=a" })).status).toBe(422);
    const limited = await (await get("v1/agent/search", { key: KEY, query: "q=gor&limit=1" })).json();
    expect(limited.results).toHaveLength(1);
    expect(limited.truncated).toBe(false); // GOR-02 es inactiva: solo hay una gorra
  });

  it("modo down → 503 en /v1 y /health; unauthorized → 401 aunque la llave sea buena; garbage → no JSON", async () => {
    await setMode("down");
    expect((await get("health")).status).toBe(503);
    expect((await get("v1/agent/products/PLY-NEG", { key: KEY })).status).toBe(503);
    await setMode("unauthorized");
    expect((await get("v1/agent/products/PLY-NEG", { key: KEY })).status).toBe(401);
    await setMode("garbage");
    expect(await (await get("v1/agent/products/PLY-NEG", { key: KEY })).text()).toBe("not json");
    expect((await setMode("otro")).status).toBe(422);
  });

  it("portal/sso verifica el pase y registra a quién dejó entrar", async () => {
    const token = await new SignJWT({ name: "Gerardo", next: "/portal/products/PLY-NEG" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("http://localhost:3000")
      .setAudience(BASE)
      .setSubject("usr_1")
      .setJti("11111111-1111-1111-1111-111111111111")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(new TextEncoder().encode(SECRET));
    const r = await get("portal/sso", { query: `token=${encodeURIComponent(token)}` });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Gerardo desde Uniko");
    expect(stockMockSnapshot().lastSso).toMatchObject({
      iss: "http://localhost:3000",
      aud: BASE,
      sub: "usr_1",
      name: "Gerardo",
      next: "/portal/products/PLY-NEG",
    });
  });

  it("portal/sso rechaza otro secreto y otra audiencia", async () => {
    const mk = (secret: string, aud: string) =>
      new SignJWT({ name: "X" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("http://localhost:3000")
        .setAudience(aud)
        .setSubject("u")
        .setJti("22222222-2222-2222-2222-222222222222")
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(new TextEncoder().encode(secret));
    const bad = await get("portal/sso", { query: `token=${await mk("o".repeat(40), BASE)}` });
    expect(bad.status).toBe(400);
    const wrongAud = await get("portal/sso", { query: `token=${await mk(SECRET, "http://otra")}` });
    expect(wrongAud.status).toBe(400);
    expect(stockMockSnapshot().lastSso).toBeNull();
  });
});
