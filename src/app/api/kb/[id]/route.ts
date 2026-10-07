import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { kbPatchSchema } from "@/server/kb/esquemas";
import { conEstado, hoyDelNegocio } from "@/server/kb/vigencia";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita el texto o la vigencia de una entrada (033: `validUntil` ausente = no
 * tocarla, fecha = ponerla o moverla, `null` = permanente; ver `kbPatchSchema`).
 * Un campo que no viene no se toca: Drizzle omite del `set` lo que es
 * `undefined`.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, kbPatchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.kbEntry)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Entrada no encontrada");
  const hoy = await hoyDelNegocio(session.organizationId);
  return Response.json({ entry: conEstado(updated[0], hoy) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!deleted[0]) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ deleted: true });
});
