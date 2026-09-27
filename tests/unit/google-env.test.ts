import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 029 — La app de Google de la agencia va entera o no va, y solo con la agenda
 * encendida (FR-1401, FR-1402). Apagada la agenda, estas variables ni se miran:
 * una instancia normal no tiene por qué saber qué son.
 *
 * `getEnv()` memoiza, así que cada caso reinicia los módulos.
 */

async function loadEnv() {
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.getEnv();
}

async function available() {
  vi.resetModules();
  const mod = await import("@/server/agenda/connectors/google-oauth");
  return mod.googleLinkAvailable();
}

const COMPLETA = {
  GOOGLE_OAUTH_CLIENT_ID: "cli.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-la-agencia",
  GOOGLE_OAUTH_REDIRECT_URI: "https://lanco.cloud/google-calendar/callback",
};

describe("029 — GOOGLE_OAUTH_* con la agenda", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("INVENTARIO", "");
    vi.stubEnv("AGENDA", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "");
    vi.stubEnv("GOOGLE_ONBOARDING_URL", "");
    vi.stubEnv("GOOGLE_AUTH_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin agenda: no exige nada, aunque falten piezas, y el link no existe", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", COMPLETA.GOOGLE_OAUTH_CLIENT_ID);
    const env = await loadEnv();
    expect(env.GOOGLE_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(env.GOOGLE_AUTH_URL).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(await available()).toBe(false);
  });

  it("con agenda y ninguna de las tres: arranca y el link no existe (solo el camino manual)", async () => {
    vi.stubEnv("AGENDA", "on");
    await expect(loadEnv()).resolves.toBeTruthy();
    expect(await available()).toBe(false);
  });

  it("con agenda y una a medias: no arranca y el error nombra la que falta", async () => {
    vi.stubEnv("AGENDA", "on");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", COMPLETA.GOOGLE_OAUTH_CLIENT_ID);
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", COMPLETA.GOOGLE_OAUTH_REDIRECT_URI);
    await expect(loadEnv()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_SECRET: la app de Google de la agencia va completa/);
  });

  it("una redirección http fuera de localhost se rechaza", async () => {
    vi.stubEnv("AGENDA", "on");
    for (const [k, v] of Object.entries(COMPLETA)) vi.stubEnv(k, v);
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://lanco.cloud/google-calendar/callback");
    await expect(loadEnv()).rejects.toThrow(/GOOGLE_OAUTH_REDIRECT_URI: debe ser https/);
  });

  it("http://localhost se acepta (self-test contra los mocks)", async () => {
    vi.stubEnv("AGENDA", "on");
    for (const [k, v] of Object.entries(COMPLETA)) vi.stubEnv(k, v);
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:3000/api/dev/lanco-relay-mock");
    await expect(loadEnv()).resolves.toBeTruthy();
  });

  it("completa: arranca, normaliza la barra de la página de aterrizaje y el link existe", async () => {
    vi.stubEnv("AGENDA", "on");
    for (const [k, v] of Object.entries(COMPLETA)) vi.stubEnv(k, v);
    vi.stubEnv("GOOGLE_ONBOARDING_URL", "https://lanco.cloud/google-calendar/");
    const env = await loadEnv();
    expect(env.GOOGLE_ONBOARDING_URL).toBe("https://lanco.cloud/google-calendar");
    expect(await available()).toBe(true);
  });
});
