import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 023 — El seed demo no existe en producción (FR-802, FR-803).
 *
 * Sembrar la demo borra todo el `kb_entry` de la organización, todo el
 * historial del Laboratorio y sobrescribe el perfil del agente. Vivía en
 * `POST /api/seed/demo`, alcanzable en las instancias de clientes, tras una
 * guardia que solo miraba si había contactos — la tabla garantizadamente vacía
 * en el negocio al que debía proteger.
 *
 * Estos tests afirman las DOS mitades de la retirada, y la segunda es la que se
 * olvida: que responda 404 **sin haber mirado la sesión**. Con el gate dentro
 * del `withAuth`, una petición anónima en producción recibiría 401, y un 401 ya
 * delata que la ruta existe.
 */

const requireSession = vi.fn();

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...original, requireSession: () => requireSession() };
});

afterEach(() => {
  vi.unstubAllEnvs();
  requireSession.mockReset();
});

/**
 * Estos dos importan un route handler del App Router, y eso arrastra el grafo
 * entero de la app —Drizzle, el esquema, Better Auth—. Tarda ~3 s la primera
 * vez, y con el límite por defecto de 5 s el test pasaba aislado y caía dentro
 * de la suite completa: intermitente, que es peor que no tenerlo.
 *
 * El tiempo NO está en lo que se afirma, sino en resolver módulos. Se sube el
 * límite en vez de adelgazar la prueba: lo que comprueba —que el gate corre
 * antes que la autenticación— exige cargar el handler de verdad.
 */
const TIMEOUT_POR_EL_GRAFO_DE_MODULOS = 30_000;

describe("023 — la ruta del seed demo en producción", () => {
  it("responde 404, no 401, y NO consulta la sesión (FR-803)", { timeout: TIMEOUT_POR_EL_GRAFO_DE_MODULOS }, async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");

    const { POST } = await import("@/app/api/dev/seed-demo/route");
    const res = await POST();

    expect(res.status).toBe(404);
    expect(
      requireSession,
      "El gate corrió DESPUÉS de la autenticación: en producción una petición " +
        "anónima recibiría 401 y eso delata que la ruta existe."
    ).not.toHaveBeenCalled();
  });

  it("sin la bandera de mocks tampoco existe, ni en desarrollo", { timeout: TIMEOUT_POR_EL_GRAFO_DE_MODULOS }, async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");

    const { POST } = await import("@/app/api/dev/seed-demo/route");
    const res = await POST();

    expect(res.status).toBe(404);
    expect(requireSession).not.toHaveBeenCalled();
  });
});

describe("023 — la ruta vieja ya no existe (FR-802)", () => {
  /**
   * Se comprueba sobre el ÁRBOL, no importando el módulo: un `import()` de algo
   * inexistente no compila, así que el typecheck se cae antes de que el test
   * pueda demostrar nada. El App Router publica por convención de carpetas —
   * que el directorio no exista ES que la ruta no exista.
   */
  it("no queda nada bajo src/app/api/seed", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/app/api/seed")),
      "Volvió a aparecer `src/app/api/seed`: el seed demo estaría otra vez " +
        "alcanzable en producción, que es justo lo que la 023 retiró."
    ).toBe(false);
  });
});
