import { asc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { etiquetasDe } from "@/server/lab/escenarios";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        session.organizationId,
        eq(schema.agentTestRun.id, id)
      )
    )
    .limit(1);
  const run = runs[0];
  if (!run) return apiError(404, "not_found", "Corrida no encontrada");

  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, id))
    .orderBy(asc(schema.agentTestCase.createdAt));

  /*
   * 021 Entrega 3 (FR-632) — las etiquetas se resuelven SIN filtrar por
   * `enabled`: borrar un escenario lo quita del futuro, no del pasado. Un
   * reporte de hace un mes tiene que seguir nombrando lo que se corrió, no
   * enseñar un identificador crudo.
   */
  const etiquetas = await etiquetasDe(session.organizationId);

  return Response.json({
    run: {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    cases: cases.map((c) => ({
      id: c.id,
      persona: c.persona,
      personaLabel: etiquetas[c.persona] ?? c.persona,
      status: c.status,
      veredicto: c.veredicto,
      hallazgos: c.hallazgos ?? [],
      transcript: c.transcript ?? [],
    })),
  });
});
