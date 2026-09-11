import { randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import type { Channel } from "@/lib/channels";
import {
  listZernioAccounts,
  zernioFetch,
  zernioProfileId,
  ZERNIO_PLATFORM,
} from "@/server/zernio";

/**
 * 025 — Lo que Uniko da de alta EN Zernio con la llave del negocio.
 *
 * Hasta la 017 Uniko enseñaba la URL del webhook y dejaba el alta al operador,
 * en otro panel. La primera conexión real (2026-09-10) se quedó ahí: pantalla
 * en "guardada", cero mensajes, y `{"webhooks": []}` del lado de Zernio. La
 * llave que ya guardamos cifrada puede registrar el webhook ella sola, así que
 * lo hace al guardar; y como el dueño atiende los comentarios con la
 * automatización comentario→DM nativa de Zernio (spec 014 los deja fuera de
 * la bandeja), la pantalla del canal también la gestiona.
 *
 * Todo esto es conector opcional (Constitución II): si Zernio falla, la
 * conexión se guarda igual y el resultado dice qué quedó pendiente. Nada del
 * core depende de que el alta funcione.
 */

/** Lo único que Uniko ingiere: los demás eventos son ruido que descarta. */
export const UNIKO_WEBHOOK_EVENTS = ["message.received"] as const;

/** Nombre con el que Uniko marca lo suyo en Zernio, para reconocerlo después. */
export const UNIKO_MARK = "Uniko";

/** Canales que hablan con Zernio, en el orden del catálogo. */
export const ZERNIO_CHANNELS = ["instagram", "messenger"] as const satisfies readonly Channel[];
export type ZernioChannel = (typeof ZERNIO_CHANNELS)[number];

const WEBHOOK_PATH: Record<ZernioChannel, string> = {
  instagram: "ig",
  messenger: "messenger",
};

/** La URL de callback de cada canal en ESTA instancia. */
export function unikoCallbackUrls(): Record<ZernioChannel, string> {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return {
    instagram: `${base}/api/webhooks/${WEBHOOK_PATH.instagram}/${env.META_WEBHOOK_VERIFY_TOKEN}`,
    messenger: `${base}/api/webhooks/${WEBHOOK_PATH.messenger}/${env.META_WEBHOOK_VERIFY_TOKEN}`,
  };
}

/**
 * ¿Este webhook de Zernio apunta a esta instancia? Cualquiera de las dos URLs
 * vale: Zernio entrega todas las plataformas por un endpoint y Uniko reparte
 * (`dispatch.ts`), así que un webhook ya registrado para Messenger sirve
 * también para Instagram y no hay que crear otro.
 */
export function isUnikoCallbackUrl(url: string | undefined, urls: Record<ZernioChannel, string>): boolean {
  if (!url) return false;
  const clean = url.trim().replace(/\/$/, "");
  return Object.values(urls).some((u) => u === clean);
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * El secreto que firma las entregas es UNO por endpoint en Zernio, y como los
 * dos canales comparten endpoint, comparten secreto. Orden: lo que escribió
 * el operador; lo que ya tenga el otro canal; lo que ya tenía este; uno nuevo.
 */
export function resolveSharedSecret(input: {
  typed: string | null;
  otherChannel: string | null;
  thisChannel: string | null;
}): { secret: string; generated: boolean } {
  const existing = input.typed || input.otherChannel || input.thisChannel;
  if (existing) return { secret: existing, generated: false };
  return { secret: generateWebhookSecret(), generated: true };
}

export type ZernioWebhook = {
  _id?: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  isActive?: boolean;
};

export async function listZernioWebhooks(token: string): Promise<ZernioWebhook[]> {
  const res = (await zernioFetch("/webhooks/settings", { token })) as
    | { webhooks?: ZernioWebhook[] }
    | null;
  return res?.webhooks ?? [];
}

/** Qué le falta a un webhook ya registrado para servirle a Uniko. */
export function webhookNeedsUpdate(hook: ZernioWebhook, secret: string): boolean {
  const events = new Set(hook.events ?? []);
  const missingEvent = UNIKO_WEBHOOK_EVENTS.some((e) => !events.has(e));
  return missingEvent || hook.secret !== secret || hook.isActive === false;
}

export type EnsureWebhookResult = {
  id: string | null;
  action: "created" | "updated" | "unchanged";
  url: string;
};

/**
 * Registra el webhook de Uniko en Zernio, o actualiza el que ya apunte aquí.
 * Idempotente: dos guardados seguidos no crean dos webhooks. Conserva los
 * eventos que ya tuviera (el operador puede haber sumado `comment.received`
 * u otros para sus propias cosas): solo garantiza los de Uniko.
 */
export async function ensureUnikoWebhook(input: {
  token: string;
  channel: ZernioChannel;
  secret: string;
}): Promise<EnsureWebhookResult> {
  const urls = unikoCallbackUrls();
  const url = urls[input.channel];
  const existing = (await listZernioWebhooks(input.token)).find((h) =>
    isUnikoCallbackUrl(h.url, urls)
  );

  if (existing?._id) {
    if (!webhookNeedsUpdate(existing, input.secret)) {
      return { id: existing._id, action: "unchanged", url: existing.url ?? url };
    }
    const events = Array.from(new Set([...(existing.events ?? []), ...UNIKO_WEBHOOK_EVENTS]));
    await zernioFetch("/webhooks/settings", {
      method: "PUT",
      token: input.token,
      body: { _id: existing._id, secret: input.secret, events, isActive: true },
    });
    return { id: existing._id, action: "updated", url: existing.url ?? url };
  }

  const res = (await zernioFetch("/webhooks/settings", {
    method: "POST",
    token: input.token,
    body: {
      name: UNIKO_MARK,
      url,
      secret: input.secret,
      events: [...UNIKO_WEBHOOK_EVENTS],
      isActive: true,
    },
  })) as { webhook?: { _id?: string } } | null;
  return { id: res?.webhook?._id ?? null, action: "created", url };
}

export type WebhookStatus = "registered" | "missing";

/** ¿Hay un webhook activo en Zernio apuntando a esta instancia? */
export async function unikoWebhookStatus(token: string): Promise<WebhookStatus> {
  const urls = unikoCallbackUrls();
  const hooks = await listZernioWebhooks(token);
  const ours = hooks.find((h) => isUnikoCallbackUrl(h.url, urls));
  if (!ours || ours.isActive === false) return "missing";
  const events = new Set(ours.events ?? []);
  return UNIKO_WEBHOOK_EVENTS.every((e) => events.has(e)) ? "registered" : "missing";
}

/* ---------------- comentario → DM ---------------- */

export type CommentAutomation = {
  enabled: boolean;
  keywords: string[];
  dmMessage: string;
  commentReply: string | null;
  stats?: { triggered?: number; dmsSent?: number; dmsFailed?: number } | null;
};

type ZernioAutomation = {
  id?: string;
  name?: string;
  accountId?: string;
  keywords?: string[];
  dmMessage?: string;
  commentReply?: string | null;
  isActive?: boolean;
  stats?: CommentAutomation["stats"];
};

/** Nombre con el que Uniko crea la automatización; por él la reconoce. */
export function unikoAutomationName(channel: ZernioChannel): string {
  return `${UNIKO_MARK} · comentario → DM (${channel === "instagram" ? "Instagram" : "Facebook"})`;
}

export function isUnikoAutomation(a: ZernioAutomation, accountId: string): boolean {
  return a.accountId === accountId && (a.name ?? "").startsWith(UNIKO_MARK);
}

function toCommentAutomation(a: ZernioAutomation): CommentAutomation {
  return {
    enabled: a.isActive !== false,
    keywords: a.keywords ?? [],
    dmMessage: a.dmMessage ?? "",
    commentReply: a.commentReply?.trim() || null,
    stats: a.stats ?? null,
  };
}

async function findUnikoAutomation(
  token: string,
  accountId: string
): Promise<ZernioAutomation | null> {
  const res = (await zernioFetch("/comment-automations", { token })) as
    | { automations?: ZernioAutomation[] }
    | null;
  return (res?.automations ?? []).find((a) => isUnikoAutomation(a, accountId)) ?? null;
}

export async function readCommentAutomation(input: {
  token: string;
  accountId: string;
}): Promise<CommentAutomation | null> {
  const a = await findUnikoAutomation(input.token, input.accountId);
  return a ? toCommentAutomation(a) : null;
}

/**
 * Crea o actualiza la automatización de esa cuenta. Apagar es `isActive:
 * false`, no borrar: así se conservan las estadísticas y un encendido
 * posterior no vuelve a empezar de cero. Modo `word` con tolerancia a errores:
 * "informacion" sin acento debe disparar igual, y "app" no debe disparar en
 * "happy".
 */
export async function upsertCommentAutomation(input: {
  token: string;
  channel: ZernioChannel;
  accountId: string;
  automation: Omit<CommentAutomation, "stats">;
}): Promise<CommentAutomation> {
  const { token, accountId, automation } = input;
  const settings = {
    keywords: automation.keywords,
    matchMode: "word",
    typoTolerance: true,
    dmMessage: automation.dmMessage,
    commentReply: automation.commentReply ?? "",
    isActive: automation.enabled,
  };

  const existing = await findUnikoAutomation(token, accountId);
  if (existing?.id) {
    const res = (await zernioFetch(`/comment-automations/${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      token,
      body: settings,
    })) as { automation?: ZernioAutomation } | null;
    return toCommentAutomation({ ...existing, ...(res?.automation ?? settings) });
  }

  // Sin automatización y apagada: no hay nada que crear.
  if (!automation.enabled) return { ...automation, stats: null };

  const account = (await listZernioAccounts(token)).find(
    (a) => (a._id ?? a.id) === accountId
  );
  const profileId = account ? zernioProfileId(account) : null;
  if (!profileId) {
    throw new Error("Zernio no devolvió el perfil de la cuenta; no se puede crear la automatización");
  }

  const res = (await zernioFetch("/comment-automations", {
    method: "POST",
    token,
    body: {
      profileId,
      accountId,
      trigger: "comment",
      name: unikoAutomationName(input.channel),
      ...settings,
      // Instagram no revela si quien comenta te sigue; `send` es el único
      // valor que no deja mudo al negocio.
      audience: { followerStatus: "any", whenUnknown: "send" },
    },
  })) as { automation?: ZernioAutomation } | null;
  return toCommentAutomation(res?.automation ?? { ...settings, accountId });
}

/** La plataforma de Zernio que corresponde al canal (para el error de la pantalla). */
export function zernioPlatformFor(channel: ZernioChannel): string {
  return ZERNIO_PLATFORM[channel];
}
