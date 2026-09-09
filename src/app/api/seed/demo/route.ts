import { withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { DemoNoVirgenError, seedDemo } from "@/server/seed/demo";
import { cuerpoDeRechazo, revisarDemo } from "@/server/seed/guardia";

export const dynamic = "force-dynamic";

/**
 * Qué se perdería si la demo se cargara ahora. Lo consume el estado vacío de la
 * bandeja para decidir si enseña el botón o la explicación (FR-703, FR-706).
 *
 * Llama a **la misma** función que la ejecución. Que el render tenga su propia
 * versión "parecida" de la comprobación es el fallo original de esta feature
 * repetido en otra capa, y AC-14 existe para que no vuelva.
 *
 * Aquí sí vale la conexión normal: de esta lectura no depende ningún borrado.
 */
export const GET = withAuth(async (session) => {
  return Response.json(await revisarDemo(getDb(), session.organizationId));
});

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
