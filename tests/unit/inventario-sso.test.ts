import { decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 026 — El pase SSO que emite el botón "Inventario" (FR-1106): exactamente los
 * claims del contrato de MS-Stock (sso-token.md), firmado con el secreto
 * compartido, con vida de 2 minutos y un identificador nuevo por clic.
 */

const SECRET = "s".repeat(40);
const STOCK = "https://stock.example";

async function load() {
  vi.resetModules();
  return (await import("@/server/inventario/sso")).issueSsoUrl;
}

async function decode(url: string) {
  const token = new URL(url).searchParams.get("token") ?? "";
  const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
    audience: STOCK,
    issuer: "http://localhost:3000",
  });
  return { payload, header: decodeProtectedHeader(token), token };
}

describe("026 — issueSsoUrl", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("INVENTARIO", "on");
    vi.stubEnv("STOCK_BASE_URL", STOCK + "/");
    vi.stubEnv("STOCK_API_KEY", "k".repeat(40));
    vi.stubEnv("STOCK_SSO_SECRET", SECRET);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("emite la URL del portal con un JWT HS256 y los claims del contrato", async () => {
    const issueSsoUrl = await load();
    const url = await issueSsoUrl({ userId: "usr_1", name: "Gerardo" });
    expect(url.startsWith(`${STOCK}/portal/sso?token=`)).toBe(true);
    const { payload, header } = await decode(url);
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload.iss).toBe("http://localhost:3000");
    expect(payload.aud).toBe(STOCK);
    expect(payload.sub).toBe("usr_1");
    expect(payload.name).toBe("Gerardo");
    expect(payload.exp! - payload.iat!).toBe(120);
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.next).toBeUndefined();
  });

  it("cada emisión trae un jti nuevo", async () => {
    const issueSsoUrl = await load();
    const a = await decode(await issueSsoUrl({ userId: "u", name: "n" }));
    const b = await decode(await issueSsoUrl({ userId: "u", name: "n" }));
    expect(a.payload.jti).not.toBe(b.payload.jti);
  });

  it("next viaja solo si es una ruta interna del portal; el nombre se recorta a 80", async () => {
    const issueSsoUrl = await load();
    const interno = await decode(
      await issueSsoUrl({ userId: "u", name: "n", next: "/portal/products/PLY-NEG" })
    );
    expect(interno.payload.next).toBe("/portal/products/PLY-NEG");
    const externo = await decode(
      await issueSsoUrl({ userId: "u", name: "n", next: "https://evil.example/portal" })
    );
    expect(externo.payload.next).toBeUndefined();
    const largo = await decode(await issueSsoUrl({ userId: "u", name: "x".repeat(100) }));
    expect((largo.payload.name as string).length).toBe(80);
  });
});
