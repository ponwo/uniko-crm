import { withAuth } from "@/lib/api";
import { clavePublicaDeLaOrganizacion } from "@/server/push/claves";
import { pushDisabledResponse, pushEnabled } from "@/server/push/flag";

export const dynamic = "force-dynamic";

/**
 * La clave pública de la instancia, que el navegador necesita para suscribirse.
 *
 * Genera el par la primera vez que alguien la pide (FR-515): encender la bandera
 * no obliga a coordinar ningún secreto con nadie.
 *
 * Devuelve **solo la pública**, por la ruta que existe justo para eso
 * (`clavePublicaDeLaOrganizacion`). La privada no pasa por aquí ni por descuido:
 * ni al cliente, ni a un log, ni a esta respuesta (FR-516).
 */
export const GET = withAuth(async (session) => {
  if (!pushEnabled()) return pushDisabledResponse();
  const publicKey = await clavePublicaDeLaOrganizacion(session.organizationId);
  return Response.json({ publicKey });
});
