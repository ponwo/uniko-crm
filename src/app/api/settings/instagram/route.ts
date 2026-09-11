import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getInstagramCredentialsByOrg,
  saveInstagramCredentials,
  tokenLast4,
} from "@/server/instagram/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { verifyZernioAccount, ZernioVerifyError } from "@/server/zernio";

export const dynamic = "force-dynamic";

/** 014 — Estado de la conexión de Instagram (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const creds = await getInstagramCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      igUserId: creds.igUserId,
      accountRef: creds.accountRef,
      username: creds.username,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]),
  /**
   * IG_ID del perfil. Obligatorio con app propia de Meta (por él enruta su
   * webhook); en modo Zernio no existe forma de conocerlo —su API expone
   * username y accountId, no el id de la plataforma— así que es opcional.
   */
  igUserId: z.string().trim().min(1).nullish(),
  accountRef: z.string().trim().min(1).nullish(),
  username: z.string().trim().nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el
 * wizard de WhatsApp: un token que no sirve no llega a la base. Solo el
 * propietario de la organización puede hacerlo.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar el perfil");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  if (data.source === "meta" && !data.igUserId) {
    return apiError(422, "invalid_body", "En modo Meta hace falta el IG_ID del perfil");
  }
  if (data.source === "zernio" && !data.accountRef) {
    return apiError(
      422,
      "invalid_body",
      "En modo Zernio hace falta el accountId de la cuenta conectada"
    );
  }

  const check = await verify(data);
  if (!check.ok) {
    return apiError(check.status, check.code, check.message);
  }

  // `ig_user_id` es NOT NULL desde la 014 (entonces solo se pensó en Meta).
  // En modo Zernio se rellena con el accountId: la ingesta de Meta descarta
  // cualquier fila que no sea `source: "meta"`, así que ese valor jamás
  // enruta nada, y un ObjectId de Zernio no puede coincidir con un IG_ID
  // numérico. Relajar la columna es una migración aparte (Constitución X).
  const igUserId = data.igUserId ?? data.accountRef;
  if (!igUserId) {
    return apiError(422, "invalid_body", "Falta el identificador del perfil");
  }

  await saveInstagramCredentials({
    organizationId: session.organizationId,
    source: data.source,
    igUserId,
    accountRef: data.accountRef ?? null,
    username: check.username ?? data.username ?? null,
    token: data.token,
    webhookSecret: data.webhookSecret ?? null,
  });

  return Response.json({ ok: true, username: check.username ?? null });
});

type Check =
  | { ok: true; username: string | null }
  | { ok: false; status: number; code: string; message: string };

async function verify(data: z.infer<typeof putSchema>): Promise<Check> {
  if (data.source === "zernio") {
    try {
      const account = await verifyZernioAccount({
        token: data.token,
        accountId: data.accountRef!,
        platform: "instagram",
      });
      return { ok: true, username: account.username };
    } catch (err) {
      if (err instanceof ZernioVerifyError) {
        return {
          ok: false,
          status: err.code === "platform_unavailable" ? 503 : 422,
          code: err.code,
          message: err.message,
        };
      }
      throw err;
    }
  }

  // Meta: el token debe ser de ESE perfil. Un token de otro guardaría
  // credenciales que reciben webhooks de uno y contestan por otro.
  const url = `${process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com"}/${
    process.env.META_GRAPH_API_VERSION ?? "v25.0"
  }/me?fields=id,username`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "platform_unavailable",
      message: "No se pudo contactar la plataforma; intenta de nuevo",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: "El token de Instagram no es válido o no tiene permiso de mensajes",
    };
  }

  const json = (await res.json().catch(() => null)) as {
    id?: string;
    username?: string;
  } | null;
  if (json?.id && json.id !== data.igUserId) {
    return {
      ok: false,
      status: 422,
      code: "id_mismatch",
      message: `El IG_ID del token es ${json.id}, no ${data.igUserId}`,
    };
  }
  return { ok: true, username: json?.username ?? null };
}
