import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { pushDisabledResponse, pushEnabled } from "@/server/push/flag";

export const dynamic = "force-dynamic";

/**
 * Alta y baja de un dispositivo que quiere recibir avisos.
 *
 * **Por usuario y por dispositivo** (FR-511): la suscripción se guarda con el
 * `user_id` de quien la crea, aunque hoy se avise a todo el equipo. Así, el día
 * que haga falta "avisar solo a estos", es añadir un filtro y no rehacer nada.
 *
 * **Idempotente por `endpoint`** (Principio IV): el navegador devuelve el mismo
 * endpoint para el mismo teléfono, así que volver a activar los avisos ahí no
 * crea una segunda fila.
 */

const altaSchema = z.object({
  /** Lo que devuelve `pushManager.subscribe()`. Es la identidad del dispositivo. */
  endpoint: z.string().url().min(10),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!pushEnabled()) return pushDisabledResponse();

  const body = await parseBody(req, altaSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const existente = await db
    .select({ id: schema.pushSubscription.id })
    .from(schema.pushSubscription)
    .where(eq(schema.pushSubscription.endpoint, body.data.endpoint))
    .limit(1);

  if (existente[0]) {
    // Mismo teléfono, otra vez. Se reasigna al usuario actual por si cambió de
    // manos, y se acabó: no hay segunda fila que crear.
    await db
      .update(schema.pushSubscription)
      .set({
        userId: session.userId,
        organizationId: session.organizationId,
      })
      .where(eq(schema.pushSubscription.id, existente[0].id));
    return Response.json({ ok: true, id: existente[0].id, nueva: false });
  }

  const id = newId("pushSubscription");
  await db.insert(schema.pushSubscription).values({
    id,
    organizationId: session.organizationId,
    userId: session.userId,
    endpoint: body.data.endpoint,
  });
  return Response.json({ ok: true, id, nueva: true });
});

const bajaSchema = z.object({ endpoint: z.string().url().min(10) });

export const DELETE = withAuth(async (session, req: Request) => {
  if (!pushEnabled()) return pushDisabledResponse();

  const body = await parseBody(req, bajaSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const borradas = await db
    .delete(schema.pushSubscription)
    .where(
      and(
        eq(schema.pushSubscription.endpoint, body.data.endpoint),
        // Nadie da de baja el teléfono de otra organización.
        eq(schema.pushSubscription.organizationId, session.organizationId)
      )
    )
    .returning({ id: schema.pushSubscription.id });

  // Borrar algo que ya no está no es un error: la baja es idempotente.
  return Response.json({ ok: true, borradas: borradas.length });
});

/** La clave pública de la instancia, para suscribirse desde el navegador. */
export async function GET() {
  if (!pushEnabled()) return pushDisabledResponse();
  return apiError(405, "method_not_allowed", "Usa /api/push/clave-publica");
}
