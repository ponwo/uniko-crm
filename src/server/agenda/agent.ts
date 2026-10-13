import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { labelInTz, todayInTz } from "@/lib/time/slots";
import { computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { conducirOferta, entradaDelModelo, MENU } from "@/server/agenda/conduccion";
import { parseDia, parseHora } from "@/server/agenda/pedido";
import { parseFranja } from "@/server/agenda/spread";
import { getOffers, replaceOffers, type OfferedSlot } from "@/server/agenda/offers";
import {
  BookingError,
  createSessionBooking,
  rescheduleForConversation,
  type BookingResult,
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
 * Cuántos huecos se le enseñan al cliente en un mensaje: los mismos que en el
 * menú del conductor (035), también al re-ofrecer tras un horario ocupado.
 */
const SHOWN = MENU;

/**
 * Lo que el motor pega debajo de la confirmación: el enlace de una cita
 * virtual, o la dirección de una presencial. Lo pega el código y no el modelo
 * por la misma regla que los horarios — el modelo no redacta datos.
 */
function withDelivery(base: string, result: BookingResult): string {
  if (result.meetingLink) return `${base}\nEnlace: ${result.meetingLink}`;
  // La cita existe; el enlace no. No se promete lo que no se tiene.
  if (result.linkPending) {
    return `${base}\nEn un momento te comparto el enlace por aquí.`;
  }
  if (result.location) return `${base}\nTe esperamos en: ${result.location}`;
  return base;
}
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
 * La cita **próxima** que nació en una conversación, como HECHO para el juez
 * del Laboratorio (FR-024) y para el agente (FR-032). Las de prueba cuentan
 * igual — son justo las que el Laboratorio produce.
 *
 * SOLO cuenta si todavía no ha pasado. Encontrado en producción por el dueño
 * (2026-09-25, 21:32): un cliente escribió «quisiera agendar una cita» y el
 * agente contestó «ya tienes una cita agendada para mañana jueves 24 a las
 * 10:00» — esa cita había sido el día ANTERIOR. Sin filtro de fecha, cualquier
 * cita vieja convertía a un cliente que vuelve en un cliente al que se le
 * niega una cita nueva.
 *
 * Y era, además, una contradicción interna: `rescheduleForConversation` —la
 * que movería esa cita— sí filtra por fecha, así que el agente ofrecía mover
 * algo que el motor iba a rechazar con «no hay cita activa que mover». Las dos
 * consultas tienen que ver lo mismo.
 *
 * El corte por fecha se hace en JS y no en SQL a propósito: así se puede
 * probar. El mock de la base de los tests ignora el `where`, de modo que un
 * filtro en SQL sería invisible para cualquier prueba — que es exactamente
 * cómo este fallo llegó a producción.
 */
export async function bookedInConversation(input: {
  organizationId: string;
  conversationId: string;
  now?: Date;
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
          // `realizada` queda fuera por definición: ya ocurrió.
          eq(schema.booking.status, "agendada")
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(20);

  const now = input.now ?? new Date();
  const proxima = rows.find((r) => r.scheduledAt.getTime() >= now.getTime());
  if (!proxima) return null;
  const settings = await getSettings(input.organizationId);
  return labelInTz(proxima.scheduledAt.toISOString(), settings.timezone);
}

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
  /**
   * 035 — Lo que el cliente ya dijo de su cita, en sus palabras, tal como lo
   * mande el modelo: el día («jueves», «mañana», «15 de octubre»), la franja
   * («por la tarde») y la hora («a las 4»). Lo traduce el motor; lo que no
   * entienda cuenta como no dicho y se vuelve a preguntar.
   */
  dia?: string;
  franja?: string;
  hora?: string;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const now = new Date();
  const libres = await computeAvailability(input.organizationId, {
    settings,
    now,
  });

  const plan = conducirOferta(
    libres,
    {
      dia: parseDia(input.dia, todayInTz(now, settings.timezone)),
      franja: parseFranja(input.franja),
      hora: parseHora(input.hora),
    },
    {
      settings,
      now,
      catalogo: {
        denseDays: OFFERED_DENSE_DAYS,
        perDayAfter: OFFERED_PER_DAY_AFTER,
        limit: OFFERED_MAX,
      },
    }
  );

  if (plan.paso === "agenda_llena") return { ok: false, text: plan.text };

  // La oferta vigente se REEMPLAZA en cada paso: es lo único que el modelo
  // puede reservar en el turno siguiente (ver `Conduccion.registrar`).
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    plan.registrar.map((s) => ({ startUtc: s.startUtc, label: s.label }))
  );

  const entrada = entradaDelModelo(input.intro);
  return { ok: true, text: entrada ? `${entrada} ${plan.text}` : plan.text };
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
    return { ok: true, text: withDelivery(base, result) };
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
    return { ok: true, text: withDelivery(base, result) };
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
