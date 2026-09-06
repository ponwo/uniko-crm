import { mockGuard } from "@/lib/dev-guard";
import { SSE_PING_EVENT } from "@/lib/sse-constants";

export const dynamic = "force-dynamic";

/**
 * Un canal SSE que enmudece sin cerrarse. Solo para pruebas.
 *
 * Reproduce en escritorio el síntoma que iOS provoca solo: la conexión deja de
 * entregar, pero NO se cierra, NO dispara `error` y `readyState` se queda en
 * OPEN. Sin esto, la detección por silencio no se puede probar de forma
 * determinista en un navegador de escritorio — habría que esperar a que un
 * teléfono real colabore.
 *
 * **No sustituye a la prueba en dispositivo** (Principio IX, nivel 3): simula
 * el síntoma, no la causa. Que esto pase no demuestra que el sistema operativo
 * congele la app ni que `readyState` mienta; demuestra que si ocurre, lo
 * detectamos.
 *
 * Vive tras el mismo gate que el resto de mocks: 404 incondicional en
 * producción, indistinguible de una ruta que no existe.
 *
 * Parámetros:
 * - `?latidos=N` — cuántas señales de vida mandar antes de callarse (default 2).
 * - `?intervalo=MS` — cada cuánto (default 500 ms, para no esperar 25 s en un test).
 */
export async function GET(req: Request) {
  const denied = mockGuard();
  if (denied) return denied;

  const url = new URL(req.url);
  const latidos = Number(url.searchParams.get("latidos") ?? 2);
  const intervalo = Number(url.searchParams.get("intervalo") ?? 500);

  let cleanup: (() => void) | null = null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      let enviados = 0;
      const timer = setInterval(() => {
        if (enviados >= latidos) {
          // Y aquí se calla. A propósito NO se cierra el stream ni se aborta:
          // cerrar dispararía `error` en el cliente, que es justo el aviso que
          // en el fallo real no llega. El socket queda abierto, mudo, vivo para
          // el navegador y muerto para el usuario.
          clearInterval(timer);
          return;
        }
        enviados += 1;
        send(`: ping\n\n`);
        send(`event: ${SSE_PING_EVENT}\n` + `data: {}\n\n`);
      }, intervalo);

      cleanup = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
