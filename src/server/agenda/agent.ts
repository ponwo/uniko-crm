import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { catalogByDay, enFranja, parseFranja } from "@/server/agenda/spread";
import { getOffers, replaceOffers, type OfferedSlot } from "@/server/agenda/offers";
import {
  BookingError,
  createSessionBooking,
  rescheduleForConversation,
} from "@/server/agenda/service";

/**
 * 015 — Lo que el agente incluido puede hacer con la agenda.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de agendas: el
 * turno pide "ofrece" o "reserva" y recibe el texto que hay que mandar.
 *
 * Regla que atraviesa las dos operaciones: el modelo NO redacta horarios. Pide
 * ofrecer, y el motor pega las etiquetas reales. Si el modelo inventa un
 * instante al reservar, el motor lo rechaza y se re-ofrece — nunca se agenda
 * algo que el cliente no eligió.
 */

/**
 * Cuántos huecos se le enseñan al cliente en un mensaje.
 *
 * Cuatro desde el 2026-09-26 (decisión del dueño): con tres, pedir una franja
 * dejaba un menú demasiado pobre para elegir dentro de ella.
 */
const SHOWN = 4;
/**
 * El CATÁLOGO reservable (lo que el modelo puede aceptar) es mucho más ancho
 * que el menú: denso en los días próximos, ralo después. Ver `catalogByDay` —
 * el porqué está medido en vivo con un cliente real.
 */
const OFFERED_DENSE_DAYS = 2;
const OFFERED_PER_DAY_AFTER = 3;
const OFFERED_MAX = 40;

export type AgendaTurn = {
  /** Lo que hay que enviarle al cliente. */
  text: string;
  /** false ⇒ el motor no pudo; el turno sigue, sin agendar. */
  ok: boolean;
};

/**
 * Lo que el sistema ya ofreció en ESTA conversación, para que el prompt se lo
 * enseñe al modelo con su instante exacto (FR-023).
 *
 * Sin esto `book_slot` no puede acertar nunca: el modelo solo ve en el
 * historial etiquetas como «hoy jueves, 17 de septiembre a las 16:00» —sin
 * año ni zona— y el motor compara por epoch exacto a propósito. Medido en
 * LanCo el 2026-09-17 con el LLM real: ofrecía bien y después re-ofrecía en
 * bucle, porque cada `startUtc` que adivinaba era un instante no ofrecido.
 */
export async function offeredSlotsFor(input: {
  organizationId: string;
  conversationId: string;
}): Promise<OfferedSlot[]> {
  return getOffers(input.organizationId, input.conversationId);
}

/**
 * La cita activa que nació en una conversación, como HECHO para el juez del
 * Laboratorio (FR-024): «quedó agendada para jue 18 sep, 09:00» o nada. Las
 * de prueba cuentan igual — son justo las que el Laboratorio produce.
 */
export async function bookedInConversation(input: {
  organizationId: string;
  conversationId: string;
}): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ scheduledAt: schema.booking.scheduledAt })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        input.organizationId,
        and(
          eq(schema.booking.conversationId, input.conversationId),
          inArray(schema.booking.status, ["agendada", "realizada"])
        )
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const settings = await getSettings(input.organizationId);
  return labelInTz(row.scheduledAt.toISOString(), settings.timezone);
}

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
  /**
   * La parte del día que pidió el cliente («por la tarde», «temprano»), si
   * dijo alguna. Filtra lo que se ENSEÑA, nunca lo que se registra: el
   * catálogo reservable sigue ancho, porque el cliente puede acabar
   * aceptando otra hora.
   */
  franja?: string;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const now = new Date();
  const all = await computeAvailability(input.organizationId, {
    settings,
    now,
  });
  const spread = catalogByDay(all, {
    timezone: settings.timezone,
    denseDays: OFFERED_DENSE_DAYS,
    perDayAfter: OFFERED_PER_DAY_AFTER,
    limit: OFFERED_MAX,
    now,
  });

  if (spread.length === 0) {
    // Agenda llena no es un error: es una respuesta que el cliente entiende.
    return {
      ok: false,
      text:
        input.intro?.trim() ||
        "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.",
    };
  }

  // Se REGISTRA todo el catálogo, no solo lo que se enseña: si el cliente pide
  // otro día, el agente tiene alternativas legítimas que aceptar.
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    spread.map((s) => ({ startUtc: s.startUtc, label: s.label }))
  );

  /*
   * El MENÚ se filtra por la franja pedida; el catálogo de arriba no. Antes el
   * menú eran siempre los primeros del catálogo, y el modelo los narraba como
   * si fueran lo pedido: «horarios del lunes por la tarde» seguido de 09:00,
   * 09:30 y 10:00. Medido con dos modelos distintos, así que no era del
   * modelo: era que no se le daba otra cosa que enseñar.
   */
  const franja = parseFranja(input.franja);
  const deLaFranja = franja ? spread.filter((s) => enFranja(s, franja)) : [];
  const sinHuecosEnLaFranja = Boolean(franja) && deLaFranja.length === 0;
  const fuente = deLaFranja.length > 0 ? deLaFranja : spread;

  const shown = fuente.slice(0, SHOWN);
  const lista = shown.map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
  const intro = input.intro?.trim() || "Tengo estos horarios disponibles:";
  // Pidió una franja y no hay NADA en ella: se dice, en vez de enseñar otra
  // cosa como si fuera lo pedido. Es la mentira que esto viene a arreglar.
  const aclaracion = sinHuecosEnLaFranja
    ? `\n(Por ${franja === "pm" ? "la tarde" : "la mañana"} no me queda nada; estos son los que sí tengo.)`
    : "";
  // El menú son cuatro, el catálogo son decenas: si el cliente no lo sabe,
  // cree que eso es toda la agenda y se va. Decírselo cuesta una línea.
  const masOpciones =
    spread.length > shown.length
      ? "\nSi te acomoda mejor otra hora o algún otro día, dímelo y lo reviso."
      : "";
  return { ok: true, text: `${intro}${aclaracion}\n${lista}${masOpciones}` };
}

export async function bookSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
}): Promise<AgendaTurn> {
  try {
    const result = await createSessionBooking({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
      source: "ai",
      requireOffer: true,
    });

    const base =
      input.confirmation?.trim() || `¡Listo! Te agendé para ${result.label}.`;
    if (result.meetingLink) {
      return { ok: true, text: `${base}\nEnlace: ${result.meetingLink}` };
    }
    if (result.linkPending) {
      // La cita existe; el enlace no. No se promete lo que no se tiene.
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.`,
      };
    }
    return { ok: true, text: base };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // Se ocupó o el modelo inventó la hora: en ambos casos se re-ofrece con
    // datos reales en vez de discutir con el cliente.
    if (err.slots.length > 0) {
      const lista = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const disculpa =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${disculpa}\n${lista}` };
    }
    return {
      ok: false,
      text: "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}

/**
 * 015 (ajuste 2026-09-25) — Mover la cita de ESTA conversación.
 *
 * Medido en el Laboratorio de LanCo con el LLM real: ante «uy, a esa hora ya
 * no puedo, ¿me la cambias a la tarde?» el agente escalaba a un humano —
 * correctamente, porque cancelar es de humanos y el modelo lo extendió a
 * reprogramar—. Pero el motor SÍ sabe mover una cita (el cerebro externo lo
 * hace por `/api/bot/bookings`); al agente incluido simplemente no se le había
 * dado la acción. Y cambiar de hora es lo más común que pasa de verdad.
 *
 * Cancelar sigue SIN ser suya: borrar la cita de un cliente es irreversible y
 * esa decisión se queda en manos de una persona.
 *
 * Las garantías son las mismas que al reservar: el instante nuevo tiene que
 * haberse ofrecido en esta conversación (comparación por epoch exacto), y el
 * enlace de la reunión se conserva — el conector mueve el evento, no crea otro.
 */
export async function moveSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
}): Promise<AgendaTurn> {
  try {
    const result = await rescheduleForConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
    });

    const base =
      input.confirmation?.trim() || `¡Listo! La moví a ${result.label}.`;
    if (result.meetingLink) {
      return { ok: true, text: `${base}\nEnlace: ${result.meetingLink}` };
    }
    if (result.linkPending) {
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.`,
      };
    }
    return { ok: true, text: base };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // No hay cita que mover: no es un error del cliente, es que se adelantó.
    if (err.code === "not_found") {
      return {
        ok: false,
        text: "No encuentro una cita activa tuya que mover. ¿Quieres que te ofrezca horarios para agendar?",
      };
    }
    if (err.slots.length > 0) {
      const lista = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const disculpa =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${disculpa}\n${lista}` };
    }
    return {
      ok: false,
      text: "No pude moverla en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}
