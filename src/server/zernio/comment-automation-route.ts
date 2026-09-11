import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { getZernioConnection } from "@/server/zernio/connection";
import {
  readCommentAutomation,
  upsertCommentAutomation,
  type ZernioChannel,
} from "@/server/zernio/provision";

/**
 * 025 — `GET/PUT /api/settings/<canal>/comment-automation`.
 *
 * Un solo handler para los dos canales: la automatización comentario→DM es
 * de Zernio, no del canal; lo único que cambia es qué cuenta conectada se
 * gestiona. Cada `route.ts` lo instancia con su canal.
 *
 * Sin canal encendido no existe (404, ADR-001). Con conexión Meta directa
 * responde `available: false`: la automatización es una capacidad de Zernio.
 */

const putSchema = z.object({
  enabled: z.boolean(),
  keywords: z
    .array(z.string().trim().min(1).max(60))
    .max(30)
    .transform((ks) => Array.from(new Set(ks.map((k) => k.toLowerCase())))),
  dmMessage: z.string().trim().min(1).max(1000),
  commentReply: z.string().trim().max(500).nullish(),
});

export function commentAutomationHandlers(channel: ZernioChannel) {
  const GET = withAuth(async (session) => {
    if (!isChannelEnabled(channel)) return channelDisabledResponse();
    const conn = await getZernioConnection(session.organizationId, channel);
    if (!conn) return Response.json({ available: false, automation: null });
    try {
      const automation = await readCommentAutomation({
        token: conn.token,
        accountId: conn.accountRef,
      });
      return Response.json({ available: true, automation });
    } catch (err) {
      return zernioFailure(err);
    }
  });

  const PUT = withAuth(async (session, req: Request) => {
    if (!isChannelEnabled(channel)) return channelDisabledResponse();
    if (session.role !== "owner") {
      return apiError(403, "forbidden", "Solo el propietario puede cambiar la automatización");
    }
    const conn = await getZernioConnection(session.organizationId, channel);
    if (!conn) {
      return apiError(
        409,
        "not_zernio",
        "La automatización comentario→DM solo existe con el canal conectado por Zernio"
      );
    }
    const body = await parseBody(req, putSchema);
    if (!body.ok) return body.response;

    try {
      const automation = await upsertCommentAutomation({
        token: conn.token,
        channel,
        accountId: conn.accountRef,
        automation: {
          enabled: body.data.enabled,
          keywords: body.data.keywords,
          dmMessage: body.data.dmMessage,
          commentReply: body.data.commentReply || null,
        },
      });
      return Response.json({ ok: true, automation });
    } catch (err) {
      return zernioFailure(err);
    }
  });

  return { GET, PUT };
}

/** Zernio caído o rechazando: se dice tal cual, nunca un 500 sin explicación. */
function zernioFailure(err: unknown): Response {
  if (err instanceof MetaApiError) {
    if (err.status === 0 || err.status >= 500) {
      return apiError(503, "platform_unavailable", "No se pudo contactar a Zernio; intenta de nuevo");
    }
    return apiError(422, "zernio_rejected", `Zernio rechazó la operación: ${err.message}`);
  }
  return apiError(
    503,
    "platform_unavailable",
    err instanceof Error ? err.message : "No se pudo contactar a Zernio; intenta de nuevo"
  );
}
