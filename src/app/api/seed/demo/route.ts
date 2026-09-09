import { withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { DemoNoVirgenError, seedDemo } from "@/server/seed/demo";
import { cuerpoDeRechazo } from "@/server/seed/guardia";

export const dynamic = "force-dynamic";

/**
 * Carga el negocio demo (FR-075), sólo sobre una organización **virgen**.
 *
 * La comprobación NO se hace aquí: vive dentro de `seedDemo()`, en la misma
 * transacción que borra (FR-704). Hacerla aquí serían dos viajes, y una entrada
 * de conocimiento creada entre medias la destruiría una comprobación que nunca
 * la vio.
 *
 * Por eso esta ruta sólo traduce: si el seed se niega, su hallazgo se convierte
 * en un 409 **con el detalle de qué se perdería** (FR-705).
 */
export const POST = withAuth(async (session) => {
  try {
    const result = await seedDemo(getDb(), session.organizationId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DemoNoVirgenError) {
      return Response.json(cuerpoDeRechazo(err.revision), { status: 409 });
    }
    throw err;
  }
});
