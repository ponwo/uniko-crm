import { apiError, withAuth } from "@/lib/api";
import {
  syncTemplates,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Sincroniza plantillas por Graph API (pull). Vía universal para el modo
 * agencia: los webhooks de plantillas no siguen el override de callback
 * (limitación de Meta documentada en el README).
 *
 * 027 — Espejo en tres direcciones: `updated` se mantiene en la raíz por
 * compatibilidad con lo que ya consumía la pantalla; `imported` y `missing`
 * son las dos direcciones nuevas.
 */
export const POST = withAuth(async (session) => {
  try {
    const resumen = await syncTemplates(session.organizationId);
    return Response.json({ ok: true, ...resumen });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
