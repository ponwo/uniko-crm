import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_HEARTBEAT_MS, SSE_PING_EVENT } from "@/lib/sse-constants";
// Estático a propósito, igual que en bot-profile: `vi.mock` se hoistea por
// encima de los imports, así que la ruta nace ya con la sesión y el bus falsos.
import { GET } from "@/app/api/events/route";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () => ({ organizationId: "org_1", userId: "u_1" }),
  };
});

vi.mock("@/server/events/bus", () => ({
  // Nadie publica en estos tests: lo que se mide es el heartbeat, no los
  // eventos de dominio.
  subscribe: () => () => {},
}));

/**
 * Entrega 1 de la 018: el heartbeat tiene que ser OBSERVABLE.
 *
 * El comentario `: ping` mantiene vivo el stream frente a proxies, pero la
 * especificación manda ignorarlo en el cliente, así que no sirve como señal de
 * vida. Estos tests fijan que el evento con nombre existe y que el comentario
 * NO desapareció: el cambio es aditivo, y quitar el comentario rompería la
 * defensa contra proxies sin que ningún test lo notara.
 */
describe("heartbeat del canal SSE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Lee del stream durante `ms` de reloj falso y devuelve el texto acumulado. */
  async function leerDurante(ms: number): Promise<string> {
    const req = new Request("http://localhost/api/events");
    const res = await GET(req);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let texto = "";

    // El primer chunk (`: conectado`) ya está en cola sin avanzar el reloj.
    const primero = await reader.read();
    if (primero.value) texto += decoder.decode(primero.value);

    const restante = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) texto += decoder.decode(value);
      }
    })();

    await vi.advanceTimersByTimeAsync(ms);
    void restante;
    await reader.cancel();
    return texto;
  }

  it("emite el evento con nombre en cada tic", async () => {
    const texto = await leerDurante(SSE_HEARTBEAT_MS + 1_000);
    expect(texto).toContain(`event: ${SSE_PING_EVENT}`);
  });

  // Ojo al contar: `": ping"` también casa DENTRO de `"event: ping"`. Hay que
  // contar líneas exactas o el comentario parece aparecer el doble de veces.
  const cuentaLineas = (texto: string, linea: string) =>
    texto.split("\n").filter((l) => l === linea).length;

  it("sigue emitiendo el comentario `: ping` (el cambio es aditivo)", async () => {
    const texto = await leerDurante(SSE_HEARTBEAT_MS + 1_000);
    expect(cuentaLineas(texto, ": ping")).toBeGreaterThan(0);
  });

  it("manda las dos señales en el mismo tic, no una u otra", async () => {
    const texto = await leerDurante(SSE_HEARTBEAT_MS + 1_000);
    const comentarios = cuentaLineas(texto, ": ping");
    const eventos = cuentaLineas(texto, `event: ${SSE_PING_EVENT}`);
    expect(comentarios).toBeGreaterThan(0);
    expect(eventos).toBe(comentarios);
  });

  it("no emite heartbeat antes de que pase el intervalo", async () => {
    const texto = await leerDurante(SSE_HEARTBEAT_MS - 5_000);
    expect(texto).not.toContain(`event: ${SSE_PING_EVENT}`);
    // El `: conectado` inicial sí está: es otra cosa, y no es señal de vida.
    expect(texto).toContain(": conectado");
  });

  it("responde 401 sin sesión, que es en lo que se apoya FR-306", async () => {
    const session = await import("@/lib/auth/session");
    vi.spyOn(session, "requireSession").mockRejectedValueOnce(
      new session.UnauthorizedError()
    );
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
  });
});
