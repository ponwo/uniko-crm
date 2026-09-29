import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { partsInTz } from "@/lib/time/slots";
import { getSettings } from "@/server/agenda/settings";

/** 015 — Listado de citas para la UI, con la hora en la zona del negocio. */

export type BookingListItem = {
  id: string;
  kind: "session" | "block";
  status: "agendada" | "realizada" | "no_show" | "cancelada";
  source: "manual" | "ai";
  scheduledAtUtc: string;
  durationMinutes: number;
  date: string;
  time: string;
  weekday: string;
  contact: { id: string; name: string } | null;
  conversationId: string | null;
  /** Con qué conector nació la entrega de esta cita. */
  connector: string | null;
  meetingLink: string | null;
  /** El proveedor falló al crear la reunión: se puede reintentar. */
  linkPending: boolean;
  isTest: boolean;
  notes: string | null;
};

const LIST_COLUMNS = {
  booking: schema.booking,
  contactId: schema.contact.id,
  contactName: schema.contact.name,
};

function toListItem(
  r: {
    booking: typeof schema.booking.$inferSelect;
    contactId: string | null;
    contactName: string | null;
  },
  timezone: string
): BookingListItem {
  const scheduledAtUtc = r.booking.scheduledAt.toISOString();
  const parts = partsInTz(scheduledAtUtc, timezone);
  return {
    id: r.booking.id,
    kind: r.booking.kind,
    status: r.booking.status,
    source: r.booking.source,
    scheduledAtUtc,
    durationMinutes: r.booking.durationMinutes,
    date: parts.date,
    time: parts.time,
    weekday: parts.weekday,
    contact: r.contactId ? { id: r.contactId, name: r.contactName ?? "" } : null,
    conversationId: r.booking.conversationId,
    connector: r.booking.connector,
    meetingLink: r.booking.meetingLink,
    linkPending: r.booking.linkPending,
    isTest: r.booking.isTest,
    notes: r.booking.notes,
  };
}

export async function listBookings(
  organizationId: string
): Promise<BookingListItem[]> {
  const db = getDb();
  const settings = await getSettings(organizationId);

  const rows = await db
    .select(LIST_COLUMNS)
    .from(schema.booking)
    .leftJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .where(scoped(schema.booking.organizationId, organizationId))
    .orderBy(desc(schema.booking.scheduledAt))
    .limit(200);

  return rows.map((r) => toListItem(r, settings.timezone));
}

/** 030 — Las citas de un contacto, de esta organización y de nadie más (FR-1509). */
export async function listContactBookings(
  organizationId: string,
  contactId: string
): Promise<BookingListItem[]> {
  const db = getDb();
  const settings = await getSettings(organizationId);

  const rows = await db
    .select(LIST_COLUMNS)
    .from(schema.booking)
    .leftJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.contactId, contactId)
      )
    )
    .orderBy(desc(schema.booking.scheduledAt))
    .limit(50);

  return rows.map((r) => toListItem(r, settings.timezone));
}

/**
 * 030 — Las citas PRÓXIMAS, para la sección «Cita» del panel de la
 * conversación (FR-1502): citas (no bloqueos) agendadas que todavía no
 * terminan —una reunión en curso sigue a la vista, con su enlace—, de la más
 * cercana a la más lejana.
 *
 * PURA a propósito: el corte por tiempo se decide aquí, con el "ahora" que
 * pasa quien llama, y no en el `where`. El doble de base de los unitarios
 * ignora el `where`, así que un corte en SQL no lo vería ninguna prueba — y así
 * llegaron a producción dos fallos de la agenda (memoria
 * `fallos-que-solo-aparecen-con-el-tiempo`).
 */
export function upcomingBookings(
  items: BookingListItem[],
  now: Date
): BookingListItem[] {
  return items
    .filter(
      (b) =>
        b.kind === "session" &&
        b.status === "agendada" &&
        Date.parse(b.scheduledAtUtc) + b.durationMinutes * 60_000 > now.getTime()
    )
    .sort((a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc));
}
