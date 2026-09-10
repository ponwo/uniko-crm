import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "@/middleware";

/**
 * 024 — `/api/dev/*` responde 404 ANTES de que Next mire el método (FR-901,
 * FR-902, FR-904).
 *
 * `mockGuard()` corre dentro de cada handler; el App Router resuelve el
 * método antes. Si un `route.ts` no exporta `PUT`, Next responde 405 sin
 * pasar por la guardia, y en producción la diferencia entre 404 y 405 confirma
 * qué rutas de mock existen. El único sitio que corre antes del enrutado es el
 * middleware, así que estos tests afirman tres cosas: que responde 404 cuando
 * los mocks no están habilitados, que deja pasar cuando sí, y que su `matcher`
 * cubre TODO lo que llama a `mockGuard()` — porque una ruta dev fuera del
 * prefijo es una ruta a la que el 405 vuelve.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(method: string, path = "/api/dev/wa-mock/outbox"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method });
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

describe("024 — el middleware de /api/dev en producción", () => {
  it("responde 404 a los siete métodos, exista o no la ruta (FR-901)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");

    for (const method of METHODS) {
      for (const path of [
        "/api/dev/wa-mock/outbox", // existe y exporta GET/DELETE
        "/api/dev/wa-mock/status", // existe y solo exporta POST
        "/api/dev/inexistente-de-verdad", // no existe
      ]) {
        const res = middleware(req(method, path));
        expect(
          res.status,
          `${method} ${path} debió ser 404 en producción; el middleware es el ` +
            "único que corre antes del enrutado por método."
        ).toBe(404);
        expect(
          res.headers.get("x-middleware-next"),
          `${method} ${path} siguió hacia la ruta: Next respondería 405 a un ` +
            "método no exportado y eso delata que la ruta existe."
        ).toBeNull();
      }
    }
  });

  it("sin la bandera de mocks también es 404, incluso en desarrollo", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(middleware(req("PUT")).status).toBe(404);
  });
});

describe("024 — el middleware deja pasar donde los mocks existen (FR-905)", () => {
  it("con la bandera fuera de producción, sigue hacia la ruta", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    const res = middleware(req("PUT"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("024 — el matcher cubre todo lo que llama a mockGuard() (FR-902, FR-904)", () => {
  it("acota el perímetro exactamente a /api/dev/:path*", () => {
    expect(config.matcher).toEqual(["/api/dev/:path*"]);
  });

  /**
   * Se comprueba sobre el ÁRBOL: una ruta que llame a `mockGuard()` fuera de
   * `src/app/api/dev/` queda fuera del perímetro, y el 405 vuelve por el
   * método que no exporte. No hay test unitario por ruta que lo atrape,
   * porque el 405 lo produce Next, no el código de la ruta.
   */
  it("ningún archivo de src/app llama a mockGuard() fuera de src/app/api/dev", () => {
    const appDir = resolve(process.cwd(), "src/app");
    const offenders: string[] = [];
    walk(appDir, (file) => {
      if (!/\.tsx?$/.test(file)) return;
      if (!readFileSync(file, "utf8").includes("mockGuard(")) return;
      const rel = relative(appDir, file).replaceAll("\\", "/");
      if (!rel.startsWith("api/dev/")) offenders.push(rel);
    });
    expect(
      offenders,
      "Estas rutas llaman a mockGuard() fuera de /api/dev: el middleware no " +
        "las cubre y en producción responderían 405 a un método no exportado."
    ).toEqual([]);
  });

  it("y sí hay rutas bajo src/app/api/dev que lo llamen (el test no está vacío)", () => {
    const devDir = resolve(process.cwd(), "src/app/api/dev");
    let guarded = 0;
    walk(devDir, (file) => {
      if (/route\.ts$/.test(file) && readFileSync(file, "utf8").includes("mockGuard(")) {
        guarded++;
      }
    });
    expect(guarded).toBeGreaterThan(0);
  });
});

function walk(dir: string, visit: (file: string) => void): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}
