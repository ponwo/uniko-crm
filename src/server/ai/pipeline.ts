import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendImageLink, sendText } from "@/server/inbox/send";
import { capabilitiesFor } from "@/server/channels/capabilities";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { avisarDeEscalacion } from "@/server/push/avisar";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agendaEnabled, modelForTurn } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { nowLabelInTz } from "@/lib/time/slots";
import { withDayMarkers } from "@/server/ai/history";
import {
  bookedInConversation,
  bookSlot,
  moveSlot,
  offerSlots,
  offeredSlotsFor,
} from "@/server/agenda/agent";
import { inventarioEnabled } from "@/server/inventario/flag";
import { checkStockTurn, type StockMessage } from "@/server/inventario/agent";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  if (!isAiConfigured()) return;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const agenda = agendaEnabled();
  const inventario = inventarioEnabled();
  // 015 (FR-023) — Lo ya ofrecido viaja al prompt con su instante exacto: es
  // lo único que le permite al modelo reservar sin adivinar el ISO.
  const offeredSlots = agenda
    ? await offeredSlotsFor({ organizationId, conversationId })
    : [];
  // 015 (ajuste 2026-09-25) — Y si ya tiene cita, el agente tiene que saberlo:
  // si no, al pedir otra hora reserva una SEGUNDA en vez de mover la suya.
  const citaActual = agenda
    ? await bookedInConversation({ organizationId, conversationId })
    : null;
  /*
   * 015 (ajuste 2026-09-26) — En qué día vive el agente.
   *
   * Encontrado en producción: una conversación retomada dos días después
   * arrastraba «tu cita quedó agendada para mañana jueves», y el agente lo
   * repitió como vigente. En el hilo que ve el modelo no hay ninguna marca de
   * tiempo, y en su prompt tampoco había fecha: el «mañana» de hace dos días
   * seguía pareciendo mañana.
   *
   * La zona horaria es la de la agenda, así que esto solo se hace con la
   * bandera encendida. Si alguna vez hace falta sin agenda, lo que toca no es
   * leer aquí la tabla del módulo: es darle a la organización una zona horaria
   * propia.
   */
  const ahoraDate = new Date();
  const tz = agenda ? (await getSettings(organizationId)).timezone : null;
  const ahora = tz ? nowLabelInTz(ahoraDate, tz) : null;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        agenda,
        offeredSlots,
        citaActual,
        ahora,
        inventario,
      }),
    },
    ...(() => {
      const hilo = history
        .filter((m) => m.text)
        .map((m) => ({
          role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
          content: m.text!,
          at: m.createdAt,
        }));
      // Con la agenda apagada no hay zona horaria del negocio de dónde tirar,
      // así que el hilo va tal cual, como siempre.
      return tz
        ? withDayMarkers(hilo, { timezone: tz, now: ahoraDate })
        : hilo.map((m) => ({ role: m.role, content: m.content }));
    })(),
  ];

  // 015 (ajuste 2026-09-23) — Con `AGENDA_MODEL` definido, los turnos en los
  // que el cliente está eligiendo horario los conduce ese modelo; el resto de
  // la conversación sigue con el de siempre. Sin la variable, nada cambia.
  const result = await chatJson(
    agentActionSchema({ agenda, inventario }),
    messages,
    { model: modelForTurn({ agenda, ofrecidos: offeredSlots.length }) }
  );
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if (
    action.action === "offer_slots" ||
    action.action === "book_slot" ||
    action.action === "move_slot"
  ) {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      try {
        const turn =
          action.action === "offer_slots"
            ? await offerSlots({
                organizationId,
                conversationId,
                intro: action.reply,
                franja: action.franja,
              })
            : action.action === "move_slot"
              ? await moveSlot({
                  organizationId,
                  conversationId,
                  startUtc: action.startUtc,
                  confirmation: action.reply,
                })
              : await bookSlot({
                  organizationId,
                  conversationId,
                  startUtc: action.startUtc,
                  confirmation: action.reply,
                });
        await deliverReply(conversation, turn.text);
        if (turn.ok) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      } catch (err) {
        console.error(`[agente] el motor de agenda falló: ${err}`);
        action = degradeAction(action);
      }
    }
  }

  // 026 — Inventario. El sistema pega existencia y precio reales; si MS-Stock
  // no responde, el turno degrada (el agente contesta sin inventario), nunca
  // se tumba ni le cuenta al cliente que "el sistema falló" (FR-1112). Las
  // conversaciones de prueba consultan igual: es solo lectura (FR-1113).
  if (action.action === "check_stock") {
    if (!inventario) {
      action = degradeAction(action);
    } else {
      const turn = await checkStockTurn({
        query: action.query,
        size: action.size,
        intro: action.reply,
      });
      if (turn.ok) {
        await deliverReplies(conversation, turn.messages);
        publish(organizationId, {
          type: "conversation.updated",
          data: { conversation: { id: conversationId } },
        });
        return;
      }
      action = degradeAction(action);
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Límite de WhatsApp para el pie de una imagen. */
const CAPTION_MAX = 1024;
/** Cuánto se espera a Meta por la foto antes de mandar el texto solo. */
const PHOTO_TIMEOUT_MS = 5_000;
/**
 * 028 (ajuste 2026-09-17, FR-1314) — Meta entrega cada imagen por URL cuando termina
 * de descargarla, así que dos fotos seguidas pueden llegar invertidas. Antes del
 * siguiente mensaje se espera a que la foto anterior deje de estar `pending`
 * (`sent` por el webhook de estados), con este tope para que un estado que no llega
 * nunca detenga la respuesta.
 */
const PHOTO_ORDER_WAIT_MS = 2_000;
const PHOTO_ORDER_POLL_MS = 100;

/**
 * Entrega la respuesta: envío real o persistencia sandbox (is_test).
 *
 * 026 — Con `imageUrl` (foto del producto, contrato §4 de MS-Stock) el texto
 * viaja como pie de UN mensaje de imagen por URL; si la foto no puede salir
 * —canal sin imágenes, Meta la rechaza o no responde a tiempo— el texto sale
 * solo (FR-1119 —la parte "una sola imagen" derogada por FR-1305 de la 028—,
 * FR-1120). Un pie más largo de lo que WhatsApp admite va como
 * texto aparte y la foto sin pie: nunca se recorta lo que el agente dijo.
 */
async function deliverReply(
  conversation: Conversation,
  text: string,
  opts: { imageUrl?: string | null } = {}
): Promise<{ ok: boolean; photoMessageId: string | null }> {
  const imageUrl = opts.imageUrl ?? null;
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text, imageUrl);
    return { ok: true, photoMessageId: null };
  }
  const photo =
    imageUrl && capabilitiesFor(conversation.channel).outboundMedia ? imageUrl : null;
  const asCaption = photo !== null && text.length <= CAPTION_MAX;
  try {
    if (asCaption) {
      const sent = await sendPhoto(conversation, photo, text);
      if (sent) return { ok: true, photoMessageId: sent };
    }
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
    const tail = photo && !asCaption ? await sendPhoto(conversation, photo, undefined) : null;
    return { ok: true, photoMessageId: tail };
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return { ok: false, photoMessageId: null };
    }
    throw err;
  }
}

/**
 * 028 — Entrega un turno de varios mensajes (uno por producto mostrado, FR-1305):
 * en serie y en orden, cada uno con la regla de la 026 (`deliverReply`: pie si
 * cabe, texto + foto si no, texto solo si la foto falla o tarda). Si ningún
 * mensaje tiene foto enviable —todas `null`, o el canal no manda imágenes y no es
 * conversación de prueba— todo el turno sale como UN solo texto, exactamente como
 * antes de la 028 (FR-1306). La ventana cerrada (ya escalada por `deliverReply`)
 * detiene la serie: los siguientes tampoco saldrían. Exportada solo para su test.
 */
export async function deliverReplies(
  conversation: Conversation,
  messages: StockMessage[]
): Promise<void> {
  const pending = messages.filter((m) => m.text);
  if (pending.length === 0) return;
  const caps = capabilitiesFor(conversation.channel);
  const canSendPhotos = conversation.isTest || caps.outboundMedia;
  if (!canSendPhotos || !pending.some((m) => m.imageUrl)) {
    await deliverReply(conversation, pending.map((m) => m.text).join("\n"));
    return;
  }
  const waitForOrder = !conversation.isTest && caps.deliveryReceipts;
  for (const [i, m] of pending.entries()) {
    const { ok, photoMessageId } = await deliverReply(conversation, m.text, { imageUrl: m.imageUrl });
    if (!ok) return;
    // FR-1314: solo entre un mensaje CON foto y el siguiente; tras un texto, o si la
    // foto salió como texto, no hay nada que esperar. El Laboratorio no tiene estados.
    if (waitForOrder && photoMessageId && i < pending.length - 1) {
      await waitUntilSent(photoMessageId);
    }
  }
}

/** Sondea `message.status` hasta que deje de ser `pending` o venza el tope (FR-1314). */
async function waitUntilSent(messageId: string): Promise<void> {
  const db = getDb();
  const deadline = Date.now() + PHOTO_ORDER_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ status: schema.message.status })
      .from(schema.message)
      .where(eq(schema.message.id, messageId))
      .limit(1);
    if (!rows[0] || rows[0].status !== "pending") return;
    await new Promise((r) => setTimeout(r, PHOTO_ORDER_POLL_MS));
  }
}

/**
 * El id del mensaje ⇒ la foto salió (con su pie, si lo llevaba). Cualquier fallo de
 * la foto se registra y devuelve null para que el texto salga solo; la única
 * excepción que sube es la ventana cerrada, que tampoco dejaría pasar el texto.
 */
async function sendPhoto(
  conversation: Conversation,
  link: string,
  caption: string | undefined
): Promise<string | null> {
  try {
    const { messageId } = await sendImageLink({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      link,
      caption,
      aiGenerated: true,
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    return messageId;
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") throw err;
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`[agente] foto: no se pudo enviar la imagen (${motivo}); sale solo el texto`);
    return null;
  }
}

/**
 * Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). Con
 * foto, se persiste como el envío real la dejaría (asset con la URL y el
 * texto como pie), para que el Laboratorio enseñe lo mismo que vería el cliente.
 */
async function persistTestOutbound(
  conversation: Conversation,
  text: string,
  imageUrl: string | null = null
): Promise<void> {
  const db = getDb();
  let mediaAssetId: string | null = null;
  if (imageUrl) {
    mediaAssetId = newId("mediaAsset");
    await db.insert(schema.mediaAsset).values({
      id: mediaAssetId,
      organizationId: conversation.organizationId,
      kind: "image",
      caption: text || null,
      payload: { url: imageUrl },
      fetchStatus: "available",
    });
  }
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: mediaAssetId ? "image" : "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
    mediaAssetId,
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });

  /*
   * 020 — El aviso fuera de la app, para quien no la tiene delante.
   *
   * Va DESPUÉS de que la escalación esté guardada y publicada, y **no se
   * espera**: el handoff no puede depender de que un servicio de terceros
   * conteste (FR-504). `avisarDeEscalacion` nunca lanza, y corta por `is_test`
   * en su primera línea — el Laboratorio escala por aquí mismo.
   */
  void avisarDeEscalacion({
    conversationId,
    organizationId,
    esConversacionDePrueba: updated[0].isTest,
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
