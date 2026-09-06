import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_PING_EVENT } from "@/lib/sse-constants";
import { GET } from "@/app/api/dev/sse-mudo/route";

const envState = vi.hoisted(() => ({ mockEnabled: true }));

vi.mock("@/lib/dev-guard", () => ({
  mockGuard: () =>
    envState.mockEnabled ? null : new Response(null, { status: 404 }),
}));

/**
 * El simulador de muerte silenciosa (018).
 *
 * Lo que tiene que hacer es contraintuitivo: dejar de entregar SIN cerrar. Si
 * cerrara, el navegador dispararía `error` — que es justo el aviso que en el
 * fallo real no llega, y entonces estaríamos simulando el caso fácil en vez
 * del difícil. Estos tests fijan esa diferencia, que es fácil de romper sin
 * querer al "arreglar" el endpoint.
 */
describe("simulador de muerte silenciosa", () => {
  beforeEach(() => {
    envState.mockEnabled = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function abrir(query: string) {
    const res = await GET(
      new Request(`http://localhost/api/dev/sse-mudo${query}`)
    );
    return res;
  }

  /** Lee durante `ms` de reloj falso sin cerrar el lector. */
  async function leer(res: Response, ms: number) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let texto = "";
    let cerrado = false;

    const bucle = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          cerrado = true;
          return;
        }
        if (value) texto += decoder.decode(value);
      }
    })();

    await vi.advanceTimersByTimeAsync(ms);
    void bucle;
    return { texto, cerrado, reader };
  }

  it("manda exactamente los latidos pedidos y luego se calla", async () => {
    const res = await abrir("?latidos=3&intervalo=100");
    const { texto, reader } = await leer(res, 1_000);
    const eventos = texto
      .split("\n")
      .filter((l) => l === `event: ${SSE_PING_EVENT}`).length;
    expect(eventos).toBe(3);
    await reader.cancel();
  });

  it("NO cierra el stream tras callarse (si cerrara, dispararía error)", async () => {
    const res = await abrir("?latidos=1&intervalo=100");
    const { cerrado, reader } = await leer(res, 2_000);
    expect(cerrado).toBe(false);
    await reader.cancel();
  });

  it("sigue callado por mucho que se espere", async () => {
    const res = await abrir("?latidos=1&intervalo=100");
    const { texto, reader } = await leer(res, 30_000);
    const eventos = texto
      .split("\n")
      .filter((l) => l === `event: ${SSE_PING_EVENT}`).length;
    expect(eventos).toBe(1);
    await reader.cancel();
  });

  it("responde 404 cuando el gate de desarrollo está cerrado", async () => {
    envState.mockEnabled = false;
    const res = await abrir("");
    expect(res.status).toBe(404);
  });
});
