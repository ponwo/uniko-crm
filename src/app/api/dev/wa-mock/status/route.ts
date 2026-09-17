import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { emitOutboundStatus } from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  waMessageId: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  /** Reproduce el `errors[]` que Meta adjunta a los `failed`. */
  errorCode: z.number().int().optional(),
  errorMessage: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Resolver el número desde el mensaje (el payload real lleva metadata).
  const r = await emitOutboundStatus(body.data);
  if (r === "not_found") return apiError(404, "not_found", "Mensaje no encontrado");
  if (r === "not_connected") return apiError(409, "not_connected", "Sin número conectado");
  if (r === "webhook_error") return apiError(502, "webhook_error", "El webhook no aceptó el estado");
  return Response.json({ delivered: true });
}
