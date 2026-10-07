import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { kbCreateSchema } from "@/server/kb/esquemas";
import { conEstado, conocimientoCompleto, hoyDelNegocio } from "@/server/kb/vigencia";

export const dynamic = "force-dynamic";

/**
 * 033 — La pantalla ve TODO su conocimiento, también lo vencido, cada entrada
 * con su estado (vigente / por vencer / vencida) y el «hoy» con que se calculó.
 * El estado lo decide el servidor: en el navegador dependería del reloj y la
 * zona del dispositivo del dueño, y vería algo distinto de lo que aplica el
 * agente.
 */
export const GET = withAuth(async (session) => {
  const { hoy, entradas } = await conocimientoCompleto(session.organizationId);
  return Response.json({ entries: entradas, hoy });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, kbCreateSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const inserted = await db
    .insert(schema.kbEntry)
    .values({
      id: newId("kbEntry"),
      organizationId: session.organizationId,
      kind: body.data.kind,
      question: body.data.kind === "qa" ? body.data.question : null,
      answer: body.data.kind === "qa" ? body.data.answer : null,
      content: body.data.kind === "block" ? body.data.content : null,
      validUntil: body.data.validUntil ?? null,
    })
    .returning();
  if (!inserted[0]) return apiError(500, "internal", "No se pudo crear");
  const hoy = await hoyDelNegocio(session.organizationId);
  return Response.json({ entry: conEstado(inserted[0], hoy) }, { status: 201 });
});
