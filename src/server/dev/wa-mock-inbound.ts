import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { nextN } from "@/server/dev/wa-mock-state";

/**
 * Construye un payload real de Meta y lo entrega al webhook público por
 * loopback (127.0.0.1: mismo proceso, sin salir a la red). Se firma con el
 * META_APP_SECRET real si está configurado — así el self-test ejercita la
 * capa 2 de verdad.
 */
export async function deliverToWebhook(payload: unknown): Promise<Response> {
  const env = getEnv();
  const raw = JSON.stringify(payload);
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (env.META_APP_SECRET) {
    const sig = createHmac("sha256", env.META_APP_SECRET)
      .update(raw, "utf8")
      .digest("hex");
    headers["x-hub-signature-256"] = `sha256=${sig}`;
  }
  return fetch(url, { method: "POST", headers, body: raw });
}

/** 008 — Campos de adjunto que aceptan los payloads simulados. */
type MockMediaInput = {
  /** media id de Graph simulado (servible por wa-mock/media-file). */
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  location?: Record<string, unknown>;
};

const MOCK_BINARY_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

function applyMockContent(
  message: Record<string, unknown>,
  type: string,
  input: { text?: string } & MockMediaInput
): void {
  if (type === "text") {
    message.text = { body: input.text ?? "hola" };
  } else if (type === "location") {
    message.location = input.location ?? {
      latitude: 21.019,
      longitude: -101.257,
      name: "Oficina",
    };
  } else if (MOCK_BINARY_TYPES.has(type)) {
    const media: Record<string, unknown> = {
      id: input.mediaId ?? `mockmedia_${nextN()}`,
      mime_type:
        input.mimeType ?? (type === "audio" ? "audio/ogg" : "image/jpeg"),
    };
    if (input.caption) media.caption = input.caption;
    if (input.filename) media.filename = input.filename;
    message[type] = media;
  }
}

/** 016 — Campos para simular que el mensaje vino de un anuncio CTWA. */
type MockReferralInput = {
  /** Identificador del clic. Sin él no hay nada que reportarle a Meta. */
  ctwaClid?: string;
  adHeadline?: string;
  adSourceId?: string;
};

export function buildInboundPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** Teléfono del remitente. Omite y usa `fromUserId` para simular BSUID (003). */
  from?: string;
  /** BSUID del remitente — puede venir solo o junto a `from`. */
  fromUserId?: string;
  name?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
} & MockMediaInput &
  MockReferralInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? `wamid.mock.in.${nextN()}`,
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (input.from) message.from = input.from;
  if (input.fromUserId) message.from_user_id = input.fromUserId;
  applyMockContent(message, type, input);

  // 016 — El referral solo viaja cuando la conversación nació de un anuncio, y
  // normalmente solo en el primer mensaje. Se arma igual que el real para que
  // la ingesta no sepa que habla con un mock.
  if (input.ctwaClid || input.adHeadline || input.adSourceId) {
    message.referral = {
      source_type: "ad",
      source_id: input.adSourceId ?? "1200000000000",
      source_url: "https://fb.me/anuncio-de-prueba",
      headline: input.adHeadline ?? "Anuncio de prueba",
      body: "Escríbenos por WhatsApp",
      media_type: "image",
      ...(input.ctwaClid ? { ctwa_clid: input.ctwaClid } : {}),
    };
  }

  const contactEntry: Record<string, unknown> = {
    profile: { name: input.name ?? "Cliente" },
  };
  if (input.from) contactEntry.wa_id = input.from;
  if (input.fromUserId) contactEntry.user_id = input.fromUserId;

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              contacts: [contactEntry],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

/**
 * 008 — Payload de echo de coexistence (`smb_message_echoes`): un mensaje que
 * el dueño mandó A MANO desde la app de WhatsApp Business del teléfono.
 */
export function buildEchoPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** wa_id del LEAD destinatario. */
  to: string;
  /** Número del negocio (remitente del echo). */
  from?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
  /** Variante defensiva: entregar bajo la clave `messages` en vez de `message_echoes`. */
  useMessagesKey?: boolean;
} & MockMediaInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? `wamid.mock.echo.${nextN()}`,
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
    from: input.from ?? "5215500000000",
    to: input.to,
  };
  applyMockContent(message, type, input);

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              ...(input.useMessagesKey
                ? { messages: [message] }
                : { message_echoes: [message] }),
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  waMessageId: string;
  status: string;
  recipientId?: string;
  /** Meta adjunta `errors[]` en los `failed` (ej. 130472 del 2026-08-05). */
  errorCode?: number;
  errorMessage?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              statuses: [
                {
                  id: input.waMessageId,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: input.recipientId ?? "5215511111111",
                  ...(input.errorCode != null
                    ? {
                        errors: [
                          {
                            code: input.errorCode,
                            title: input.errorMessage ?? "Error de envío",
                            message: input.errorMessage ?? "Error de envío",
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildTemplateStatusPayload(input: {
  wabaId: string;
  name: string;
  language: string;
  /** Estado literal de Meta (027): APPROVED, REJECTED, PAUSED… */
  event: string;
  reason?: string;
  templateId?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: input.event,
              message_template_id: input.templateId ?? `tplmock_${nextN()}`,
              message_template_name: input.name,
              message_template_language: input.language,
              reason: input.reason ?? null,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Emite un estado (`sent`, `delivered`, `read`, `failed`) de un mensaje saliente por
 * el webhook, como lo haría Meta. Resuelve el número por el mensaje persistido
 * (el payload real lleva `metadata`). Devuelve `not_found` si el CRM aún no lo
 * persistió (el mock lo llama justo después de aceptar el envío: reintentar).
 */
export async function emitOutboundStatus(input: {
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: number;
  errorMessage?: string;
}): Promise<"ok" | "not_found" | "not_connected" | "webhook_error"> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.message.organizationId })
    .from(schema.message)
    .where(eq(schema.message.waMessageId, input.waMessageId))
    .limit(1);
  if (!rows[0]) return "not_found";
  const creds = await getCredentialsByOrg(rows[0].organizationId);
  if (!creds) return "not_connected";
  const res = await deliverToWebhook(
    buildStatusPayload({
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      waMessageId: input.waMessageId,
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    })
  );
  return res.ok ? "ok" : "webhook_error";
}

/**
 * 028 (ajuste 2026-09-17, FR-1315) — Meta reporta `sent` de una imagen por URL
 * poco después de aceptarla. El mock lo imita a los ~300 ms (y reintenta una vez
 * si el CRM todavía no persistió el mensaje) para que el motor ejercite la espera
 * real del orden (FR-1314) y no solo su tope.
 */
export function scheduleSentStatus(waMessageId: string, delayMs = 300): void {
  const intento = async (restantes: number): Promise<void> => {
    try {
      const r = await emitOutboundStatus({ waMessageId, status: "sent" });
      if (r === "not_found" && restantes > 0) setTimeout(() => void intento(restantes - 1), 500);
    } catch {
      // El mock nunca tumba nada: sin estado, el motor aplica su tope.
    }
  };
  setTimeout(() => void intento(1), delayMs);
}

