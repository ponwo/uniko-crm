import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { serializeBotProfile } from "@/server/bot/profile";
import { conocimientoVigente } from "@/server/kb/vigencia";

export const dynamic = "force-dynamic";

/**
 * Perfil del agente + knowledge base para un cerebro externo.
 * GET /api/bot/profile → {profile, kb, resources}. Sin caché: cada consulta
 * refleja lo que el dueño dejó en la UI al momento (el TTL vive del lado del
 * bot, que es quien sabe cada cuánto le conviene releer).
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const db = getDb();
  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) {
    // Condición esperada (instancia sin perfil): el bot cae a su brief local.
    return apiError(404, "no_profile", "La instancia no tiene perfil de agente");
  }

  // 033 (FR-1811) — Solo lo vigente: un cerebro externo conduce conversaciones
  // igual que el agente de Uniko, y tiene que ver la misma verdad. La fecha de
  // vigencia no viaja: no necesita saber cuándo vence lo que ya no recibe, y
  // mandarla invitaría a reimplementar el filtro por su lado.
  const kb = await conocimientoVigente(organizationId);

  return Response.json(serializeBotProfile(profile, kb));
}
