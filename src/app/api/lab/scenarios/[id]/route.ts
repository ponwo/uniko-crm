import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { borrarEscenario, editarEscenario } from "@/server/lab/escenarios";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cambiosSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  script: z.array(z.string().trim().min(1).max(500)).min(2).max(5).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cambiosSchema);
  if (!body.ok) return body.response;

  const r = await editarEscenario(session.organizationId, id, body.data);
  if (!r.ok) {
    if (r.motivo === "no_encontrado") {
      return apiError(404, "not_found", r.mensaje);
    }
    return apiError(422, "escenario_invalido", r.mensaje);
  }
  return Response.json({ ok: true });
});

/**
 * Borrado LÓGICO (FR-632): quita el escenario del futuro, no del pasado. El
 * reporte de una corrida vieja tiene que seguir nombrándolo. Idempotente.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  await borrarEscenario(session.organizationId, id);
  return Response.json({ ok: true });
});
