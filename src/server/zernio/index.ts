import { createHmac, timingSafeEqual } from "node:crypto";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 017 — Transporte de Zernio, compartido por los canales que lo usan.
 *
 * Zernio es una API unificada: UNA cuenta y UNA llave entregan los mensajes de
 * todas las plataformas conectadas (Instagram, Facebook/Messenger, X…) por el
 * mismo webhook, y se responde por el mismo endpoint de conversaciones. Lo que
 * distingue el canal es `account.platform`, y lo que enruta a la organización
 * es `account.id`.
 *
 * Esto vive aparte de cada canal a propósito: la verificación de la firma es
 * un control de seguridad, y dos implementaciones del mismo control son dos
 * sitios donde equivocarse. El canal decide QUÉ plataforma acepta; este módulo
 * resuelve CÓMO se habla con Zernio.
 */

export const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";

/** Cabeceras con las que Zernio firma sus entregas (la segunda es heredada). */
const SIGNATURE_HEADERS = ["x-zernio-signature", "x-late-signature"] as const;

export function zernioSignatureFrom(headers: Headers): string | null {
  for (const h of SIGNATURE_HEADERS) {
    const value = headers.get(h);
    if (value) return value;
  }
  return null;
}

/**
 * Firma de Zernio: HMAC-SHA256 en hex del cuerpo CRUDO, con el secreto de esa
 * cuenta. Sin secreto configurado la capa queda desactivada y protege solo el
 * segmento secreto de la URL — mismo trato que da el webhook de WhatsApp a
 * `META_APP_SECRET`.
 */
export function isValidZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string | null
): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** El evento de Zernio, en lo que a Uniko le importa. */
export type ZernioEvent = {
  id?: string;
  event?: string;
  message?: {
    /**
     * Id de Zernio, NO el de la plataforma (ese viene en
     * `platformMessageId`). Es el que dedupe: se mantiene entre reentregas
     * del mismo mensaje, que es justo lo que hay que colapsar.
     */
    id?: string;
    platformMessageId?: string;
    /**
     * Identificador OPACO del hilo. La propia API dice «format not to be
     * assumed»: su endpoint de respuesta lo acepta verbatim, ya venga del
     * listado o de aquí. No se parsea ni se compara con el de la plataforma.
     */
    conversationId?: string;
    direction?: string;
    text?: string | null;
    /** Cuándo lo mandó la persona, ISO-8601. Ver `zernioSentAtSeconds`. */
    sentAt?: string;
    attachments?: { type?: string; url?: string }[];
    sender?: { id?: string; name?: string | null; username?: string | null };
  };
  /**
   * `accountId` es el campo canónico desde que Zernio lo unificó en todos
   * sus eventos; `id` se mantiene por compatibilidad con el mismo valor.
   * Ver `zernioAccountRef`.
   */
  account?: { id?: string; accountId?: string; platform?: string };
};

/** El accountId que enruta a la organización, lea la forma que lea Zernio. */
export function zernioAccountRef(evt: ZernioEvent | null | undefined): string | null {
  return evt?.account?.accountId ?? evt?.account?.id ?? null;
}

/**
 * Hora del mensaje en segundos, la que trae el evento y no la de llegada.
 *
 * Importa porque `lastInboundAt` es lo que abre la ventana de 24 h: sellar con
 * la hora de ingesta haría que una reentrega tardía —Zernio reintenta con
 * backoff de hasta 24 h, y su panel permite reenviar a mano— pareciera un
 * mensaje recién llegado, y el CRM ofrecería escribir libre por una ventana
 * que en realidad ya se cerró. El envío lo rechazaría la plataforma, y el
 * operador no tendría forma de entender por qué.
 *
 * Sin `sentAt` utilizable se cae a la hora actual: es lo que había antes y
 * nunca es peor.
 */
export function zernioSentAtSeconds(sentAt: string | undefined): string {
  const ms = sentAt ? Date.parse(sentAt) : NaN;
  return String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000));
}

/** Lee el cuerpo crudo como evento de Zernio; null si no lo es. */
export function parseZernioEvent(rawBody: string): ZernioEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const evt = parsed as ZernioEvent;
    // Un payload de Meta trae `object`; uno de Zernio trae `account`. Sin
    // `account` no hay a quién enrutar, así que no es un evento utilizable.
    return evt.account ? evt : null;
  } catch {
    return null;
  }
}

/** `true` si el cuerpo es un webhook de Meta (y por tanto NO de Zernio). */
export function looksLikeMetaPayload(payload: unknown, object: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: string }).object === object
  );
}

export type ZernioSendResult = { platformMessageId: string };

/**
 * Responde en una conversación de Zernio.
 *
 * `accountId` va en el cuerpo aunque la conversación ya lo implique (lo exige
 * la API). `Idempotency-Key` evita que un reintento mande el mensaje dos
 * veces: la llave natural es el id que Uniko ya generó para ese envío.
 */
export async function sendZernioMessage(input: {
  token: string;
  accountId: string | null;
  conversationId: string | null;
  text: string;
  /** Fuera de la ventana de 24 h, la única etiqueta admitida. */
  humanAgentTag?: boolean;
  idempotencyKey?: string;
}): Promise<ZernioSendResult> {
  if (!input.conversationId) {
    throw new MetaApiError(
      "La conversación no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }

  const body: Record<string, unknown> = {
    accountId: input.accountId,
    message: input.text,
  };
  if (input.humanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  const res = await zernioFetch(
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      method: "POST",
      token: input.token,
      body,
      ...(input.idempotencyKey
        ? { headers: { "Idempotency-Key": input.idempotencyKey } }
        : {}),
    }
  );

  // La API responde `{ data: { messageId } }`; las otras dos formas son las
  // que asumió la 017 antes de cotejar la doc, y no cuesta seguir leyéndolas.
  const r = res as {
    data?: { messageId?: string };
    message?: { id?: string };
    id?: string;
  } | null;
  const id = r?.data?.messageId ?? r?.message?.id ?? r?.id ?? `zernio_${Date.now()}`;
  return { platformMessageId: String(id) };
}

/**
 * Por qué NO se puede conectar, con nombre. Antes todo fallo de Zernio se
 * traducía a "la API key no es válida", y la primera conexión real se estrelló
 * con una llave perfectamente válida: la cuenta no tenía contratado el Inbox
 * de Zernio (403 `INBOX_REQUIRED`), y el operador se pasó el rato revisando
 * la llave. Cada causa tiene su mensaje, y la que es de compra lo dice.
 */
export class ZernioVerifyError extends Error {
  code:
    | "invalid_key"
    | "account_not_found"
    | "platform_mismatch"
    | "inbox_required"
    | "platform_unavailable";
  constructor(code: ZernioVerifyError["code"], message: string) {
    super(message);
    this.name = "ZernioVerifyError";
    this.code = code;
  }
}

/** Plataforma de Zernio que corresponde a cada canal de Uniko. */
export const ZERNIO_PLATFORM = { instagram: "instagram", messenger: "facebook" } as const;

export type ZernioAccount = {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string | null;
  displayName?: string | null;
  isActive?: boolean;
  /** Perfil de Zernio al que pertenece: string o el objeto entero. */
  profileId?: string | { _id?: string; name?: string } | null;
};

/** Las cuentas de una llave, en la forma que devuelva la API. */
export async function listZernioAccounts(token: string): Promise<ZernioAccount[]> {
  const res = (await zernioFetch("/accounts", { token })) as
    | { accounts?: ZernioAccount[]; data?: ZernioAccount[] }
    | ZernioAccount[]
    | null;
  return Array.isArray(res) ? res : (res?.accounts ?? res?.data ?? []);
}

export function zernioProfileId(account: ZernioAccount): string | null {
  const p = account.profileId;
  if (!p) return null;
  return typeof p === "string" ? p : (p._id ?? null);
}

/**
 * Comprueba, ANTES de guardar, que la conexión puede funcionar:
 *
 * 1. La llave sirve y el `accountId` es una de sus cuentas, de la plataforma
 *    del canal. Se lee de `/accounts`, que NO exige el addon de Inbox: así se
 *    distingue "llave mala" de "cuenta equivocada" de "falta el Inbox".
 * 2. El Inbox está contratado: `/inbox/conversations` es lo que usan el
 *    webhook `message.received` y la respuesta, y sin él no entra ni sale
 *    nada. Zernio responde 403 `INBOX_REQUIRED`.
 *
 * Devuelve el nombre visible de la cuenta para enseñarlo en la pantalla.
 */
export async function verifyZernioAccount(input: {
  token: string;
  accountId: string;
  platform: (typeof ZERNIO_PLATFORM)[keyof typeof ZERNIO_PLATFORM];
}): Promise<{ username: string | null; displayName: string | null }> {
  let accounts: ZernioAccount[];
  try {
    accounts = await listZernioAccounts(input.token);
  } catch (err) {
    throw translateVerify(err, "La API key de Zernio no es válida");
  }

  const account = accounts.find(
    (a) => (a._id ?? a.id) === input.accountId
  );
  if (!account) {
    throw new ZernioVerifyError(
      "account_not_found",
      `Esa API key no tiene ninguna cuenta con accountId ${input.accountId}: cópialo del panel de Zernio (Accounts)`
    );
  }
  const platform = (account.platform ?? "").toLowerCase();
  if (platform !== input.platform) {
    throw new ZernioVerifyError(
      "platform_mismatch",
      `La cuenta ${input.accountId} es de ${platform || "otra plataforma"}, no de ${input.platform}`
    );
  }

  try {
    await zernioFetch(
      `/inbox/conversations?limit=1&accountId=${encodeURIComponent(input.accountId)}`,
      { token: input.token }
    );
  } catch (err) {
    throw translateVerify(err, "La API key de Zernio no tiene acceso a la bandeja");
  }

  return {
    username: account.username?.trim() || null,
    displayName: account.displayName?.trim() || null,
  };
}

function translateVerify(err: unknown, invalidMessage: string): ZernioVerifyError {
  if (err instanceof MetaApiError) {
    if (err.status === 0 || err.status >= 500) {
      return new ZernioVerifyError(
        "platform_unavailable",
        "No se pudo contactar a Zernio; intenta de nuevo"
      );
    }
    const code = (err.details as { code?: string } | null)?.code;
    if (err.status === 403 && code === "INBOX_REQUIRED") {
      return new ZernioVerifyError(
        "inbox_required",
        "La API key es válida, pero tu plan de Zernio no incluye la bandeja (Inbox): actívala en Zernio → Billing y vuelve a probar"
      );
    }
    return new ZernioVerifyError("invalid_key", invalidMessage);
  }
  return new ZernioVerifyError(
    "platform_unavailable",
    "No se pudo contactar a Zernio; intenta de nuevo"
  );
}

/** Comprueba que la llave sirve (se usa antes de guardar una conexión). */
export async function verifyZernioToken(token: string): Promise<void> {
  await zernioFetch("/inbox/conversations?limit=1", { token });
}

/**
 * Traduce los fallos de Zernio al MetaApiError que el resto del CRM ya sabe
 * interpretar — incluido `isAuthError`, que distingue una llave muerta de un
 * hipo transitorio y costó un incidente aprender.
 */
export async function zernioFetch(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    token: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Zernio", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en los detalles
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } | string } | null;
    const message =
      typeof err?.error === "string"
        ? err.error
        : (err?.error?.message ?? `HTTP ${res.status}`);
    throw new MetaApiError(message, {
      status: res.status,
      details: json ?? text,
    });
  }
  return json;
}
