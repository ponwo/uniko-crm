import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 026 — Las variables del conector se exigen SOLO con la bandera encendida
 * (FR-1102). Apagada, una instancia normal no tiene por qué saber qué es
 * STOCK_API_KEY; encendida, faltar una es un error que nombra la variable.
 *
 * `getEnv()` memoiza, así que cada caso reinicia los módulos.
 */

async function loadEnv() {
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.getEnv();
}

describe("026 — STOCK_* solo con INVENTARIO encendida", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("INVENTARIO", "");
    vi.stubEnv("STOCK_BASE_URL", "");
    vi.stubEnv("STOCK_API_KEY", "");
    vi.stubEnv("STOCK_SSO_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagada: no exige nada y las STOCK_* quedan indefinidas", async () => {
    const env = await loadEnv();
    expect(env.STOCK_BASE_URL).toBeUndefined();
    expect(env.STOCK_API_KEY).toBeUndefined();
  });

  it("encendida sin la llave: no arranca y el error nombra la variable", async () => {
    vi.stubEnv("INVENTARIO", "on");
    vi.stubEnv("STOCK_BASE_URL", "https://stock.example");
    vi.stubEnv("STOCK_SSO_SECRET", "s".repeat(40));
    await expect(loadEnv()).rejects.toThrow(/STOCK_API_KEY: obligatoria con INVENTARIO/);
  });

  it("encendida con una llave corta: la rechaza (mínimo 32)", async () => {
    vi.stubEnv("INVENTARIO", "on");
    vi.stubEnv("STOCK_BASE_URL", "https://stock.example");
    vi.stubEnv("STOCK_API_KEY", "corta");
    vi.stubEnv("STOCK_SSO_SECRET", "s".repeat(40));
    await expect(loadEnv()).rejects.toThrow(/STOCK_API_KEY/);
  });

  it("encendida y completa: arranca y normaliza la barra final del origen", async () => {
    vi.stubEnv("INVENTARIO", "on");
    vi.stubEnv("STOCK_BASE_URL", "https://stock.example/");
    vi.stubEnv("STOCK_API_KEY", "k".repeat(40));
    vi.stubEnv("STOCK_SSO_SECRET", "s".repeat(40));
    const env = await loadEnv();
    expect(env.STOCK_BASE_URL).toBe("https://stock.example");
    expect(env.STOCK_API_KEY).toBe("k".repeat(40));
  });

  it("apagada pero con STOCK_* sueltas: no molesta (se ignoran)", async () => {
    vi.stubEnv("STOCK_API_KEY", "corta");
    const env = await loadEnv();
    expect(env.INVENTARIO).toBeUndefined();
  });
});
