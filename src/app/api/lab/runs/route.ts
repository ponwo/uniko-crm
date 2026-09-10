import { desc } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { RunConflictError, startRun } from "@/server/lab/runner";
import { sonComparables } from "@/server/lab/conjunto";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);

    const hayDelta =
      run.status === "done" && run.score !== null && prev?.score != null;

    /*
     * 021 Entrega 3 (FR-626, FR-616) — un delta entre exámenes distintos no
     * significa nada, y presentarlo sin aviso es la forma más barata de mentir
     * con un número.
     *
     * Está medido, no es teoría: la Entrega 2 llevó a LanCo de 42 a 75 sin que
     * su agente cambiara —cambió la rúbrica, y entre corridas también los
     * guiones que se ejecutaron— y la pantalla lo presentó como mejora.
     *
     * El delta se sigue devolviendo: esconderlo dejaría al dueño sin el dato.
     * Lo que se añade es si vale compararlo, y por qué no cuando no.
     */
    const comparacion = hayDelta && prev ? sonComparables(run, prev) : null;

    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta: hayDelta ? run.score! - prev!.score! : null,
      /** null si no hay con qué comparar; si no, si el delta significa algo. */
      comparable: comparacion ? comparacion.comparables : null,
      /** `examen` | `rubrica` | `sin_registro` cuando no son comparables. */
      motivoNoComparable: comparacion?.motivo ?? null,
    };
  });
  return Response.json({ runs: withDelta, aiConfigured: isAiConfigured() });
});

export const POST = withAuth(async (session) => {
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }
  try {
    const runId = await startRun(session.organizationId);
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso; espera a que termine"
      );
    }
    throw err;
  }
});
