import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  contarEscenariosPropios,
  crearEscenarios,
  escenariosPropios,
} from "@/server/lab/escenarios";
import { MAX_ESCENARIOS_PROPIOS } from "@/server/lab/guion";

export const dynamic = "force-dynamic";

/** Los escenarios propios de la organización (FR-624). */
export const GET = withAuth(async (session) => {
  const escenarios = await escenariosPropios(session.organizationId);
  return Response.json({
    escenarios,
    max: MAX_ESCENARIOS_PROPIOS,
    usados: await contarEscenariosPropios(session.organizationId),
  });
});

/**
 * Confirma propuestas revisadas por el dueño (FR-622, FR-623).
 *
 * Aquí llega el texto FINAL: el dueño pudo editarlo o descartar las que no
 * servían. Nada se persistió antes de este punto — es lo que hace cierta la
 * promesa de que revisa antes de que exista.
 */
const cuerpoSchema = z.object({
  escenarios: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional().default(""),
        script: z.array(z.string().trim().min(1).max(500)).min(2).max(5),
      })
    )
    .min(1)
    .max(MAX_ESCENARIOS_PROPIOS),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpoSchema);
  if (!body.ok) return body.response;

  const r = await crearEscenarios(
    session.organizationId,
    body.data.escenarios.map((e) => ({ ...e, description: e.description ?? "" }))
  );
  if (!r.ok) {
    // El fallo dice QUÉ regla se rompió y en cuál, no "datos inválidos".
    return apiError(422, "escenario_invalido", r.fallo.mensaje);
  }
  return Response.json({ ok: true, creados: r.creados }, { status: 201 });
});
