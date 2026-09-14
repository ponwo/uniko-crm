import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { describeSendError } from "@/lib/meta/send-errors";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import type { WebhookStatus } from "@/server/inbox/webhook";

/** Orden monotónico de estados: nunca degradar (un delivered tardío no pisa read). */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export function isUpgrade(current: string, next: string): boolean {
  if (next === "failed") return current !== "failed";
  const c = STATUS_RANK[current];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

export async function applyStatusUpdate(
  organizationId: string,
  status: WebhookStatus
): Promise<void> {
  const next = status.status;
  if (!(next in STATUS_RANK) && next !== "failed") return; // estado desconocido

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
      type: schema.message.type,
      text: schema.message.text,
      origin: schema.message.origin,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.waMessageId, status.id)
      )
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) return;
  if (!isUpgrade(msg.status, next)) return;

  const failure = status.errors?.[0];
  const error =
    next === "failed"
      ? describeSendError(failure?.code, failure?.message ?? failure?.title)
      : null;

  await db
    .update(schema.message)
    .set({ status: next as MessageStatus, error })
    .where(eq(schema.message.id, msg.id));

  publish(organizationId, {
    type: "message.status",
    data: {
      conversationId: msg.conversationId,
      messageId: msg.id,
      status: next,
      // Sin esto el operador ve el triángulo de fallo pero nunca el motivo.
      error,
    },
  });

  // 026 — Foto del producto: Meta acepta la imagen por URL y solo después
  // puede descubrir que no pudo descargarla; el cliente se quedaría sin el
  // pie, que ES la respuesta del agente. Al aplicar ese `failed`, el texto
  // sale solo, una vez: los estados son monotónicos, así que un webhook
  // repetido no lo manda dos veces (FR-1120). Un fallo aquí no rompe el webhook.
  if (next === "failed" && msg.origin === "ai" && msg.type === "image" && msg.text) {
    try {
      await sendText({
        conversationId: msg.conversationId,
        organizationId,
        text: msg.text,
        aiGenerated: true,
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      console.error(`[agente] foto: Meta la reportó failed y el texto de respaldo tampoco salió (${motivo})`);
    }
  }
}
