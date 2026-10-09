import { apiError, withAuth } from "@/lib/api";
import {
  atribucionDisabledResponse,
  atribucionEnabled,
} from "@/server/attribution/flag";
import { datasetFromMeta } from "@/server/attribution/settings";

export const dynamic = "force-dynamic";

/**
 * 016 — «Obtener de Meta»: el dataset de la cuenta de WhatsApp conectada.
 *
 * POST y no GET porque Meta lo crea si la cuenta aún no tiene uno. No guarda
 * nada en el CRM: devuelve el ID para que la pantalla lo coloque y el negocio
 * lo confirme con «Guardar».
 */
export const POST = withAuth(async (session) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();
  const result = await datasetFromMeta(session.organizationId);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json({
    datasetId: result.datasetId,
    displayPhoneNumber: result.displayPhoneNumber,
  });
});
