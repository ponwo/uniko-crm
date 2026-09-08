import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

/**
 * Mock del servicio de entrega (FCM/APNs/autopush). Solo para pruebas.
 *
 * Vive tras el mismo gate que el resto de mocks: 404 incondicional en
 * producción, indistinguible de una ruta que no existe.
 *
 * **Con caminos infelices, que es a lo que viene** (condición 5 del ADR-003: los
 * conectores se prueban apagados, encendidos y fallando). El comportamiento se
 * elige por el propio endpoint, para que una prueba pueda tener a la vez un
 * teléfono sano y uno caducado:
 *
 * - endpoint que contiene `caducado`  → **410 Gone**
 * - endpoint que contiene `rechaza`   → 500
 * - endpoint que contiene `lento`     → tarda 12 s (más que el timeout del adaptador)
 * - cualquier otro                    → 201, y se apunta en la bandeja de salida
 */

type EnvioRecibido = {
  endpoint: string;
  /** Lo que llegó como cuerpo. DEBE estar vacío: el aviso es opaco (FR-505). */
  body: string;
  /** Cabeceras que importan para verificar la firma VAPID. */
  authorization: string | null;
  ttl: string | null;
  at: string;
};

const enviados: EnvioRecibido[] = [];

export async function POST(req: Request) {
  const denied = mockGuard();
  if (denied) return denied;

  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  const body = await req.text();

  if (endpoint.includes("lento")) {
    await new Promise((r) => setTimeout(r, 12_000));
  }

  enviados.push({
    endpoint,
    body,
    authorization: req.headers.get("authorization"),
    ttl: req.headers.get("ttl"),
    at: new Date().toISOString(),
  });

  if (endpoint.includes("caducado")) return new Response(null, { status: 410 });
  if (endpoint.includes("rechaza")) return new Response(null, { status: 500 });
  return new Response(null, { status: 201 });
}

/** Lo recibido, para que el arnés compruebe que el cuerpo va VACÍO. */
export async function GET() {
  const denied = mockGuard();
  if (denied) return denied;
  return Response.json({ enviados });
}

export async function DELETE() {
  const denied = mockGuard();
  if (denied) return denied;
  enviados.length = 0;
  return Response.json({ ok: true });
}
