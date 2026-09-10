import { apiError, withAuth } from "@/lib/api";
import { generarEscenarios } from "@/server/lab/generar";

export const dynamic = "force-dynamic";

/**
 * Genera PROPUESTAS desde el conocimiento del negocio (FR-620..FR-622).
 *
 * No persiste nada: devuelve borradores para que el dueño los revise. La
 * escritura ocurre en `POST /api/lab/scenarios`, con el texto que él confirme.
 */
export const POST = withAuth(async (session) => {
  const r = await generarEscenarios(session.organizationId);
  if (!r.ok) {
    /*
     * 409 y no 500: no es un fallo del servidor, es que falta algo del lado del
     * negocio —proveedor sin configurar o conocimiento vacío— o el proveedor
     * devolvió basura. El `motivo` distingue cuál, porque uno se arregla
     * configurando y otro reintentando.
     */
    return apiError(409, r.motivo, r.detalle);
  }
  return Response.json({
    propuestas: r.propuestas,
    descartados: r.descartados,
    conocimientoRecortado: r.conocimientoRecortado,
  });
});
