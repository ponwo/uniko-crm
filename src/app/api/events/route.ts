import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { SSE_HEARTBEAT_MS, SSE_PING_EVENT } from "@/lib/sse-constants";
import { subscribe } from "@/server/events/bus";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = SSE_HEARTBEAT_MS;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId } = session;

  let cleanup: (() => void) | null = null;

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

      const unsubscribe = subscribe(organizationId, (event) => {
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );
      });

      // Dos señales de vida en el mismo tic, y no es redundancia:
      //
      // El comentario defiende del corte por inactividad en proxies, que es
      // para lo que se puso. Pero la especificación de server-sent events manda
      // ignorar las líneas que empiezan por `:` —"Ignore the line"— sin
      // despachar evento ni tocar estado observable, así que el CLIENTE NO
      // PUEDE VERLO. Sin algo más, una conexión sana y callada es indistinguible
      // de una muerta, que es el fallo que arregla la 018.
      //
      // El evento con nombre es lo que el cliente sí puede escuchar. Se añade
      // sin quitar el comentario: es un cambio aditivo, y un EventSource
      // descarta en silencio los eventos con nombre que no tiene registrados,
      // así que ningún cliente anterior se entera.
      const heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        send(`event: ${SSE_PING_EVENT}\n` + `data: {}\n\n`);
      }, HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
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
