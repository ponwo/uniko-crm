import { dayIsoInTz, dayLabelInTz, timeInTz } from "@/lib/time/slots";
import type { AvailableSlot } from "@/server/agenda/availability";

/**
 * 015 — Reparto de huecos entre días distintos.
 *
 * Los N huecos más próximos casi siempre caen todos HOY, y entonces quien
 * conduce la conversación no tiene nada que ofrecer cuando el lead dice "¿y
 * el jueves?". Esto toma `perDay` por día hasta completar `limit`, de modo que
 * la oferta cubra varios días.
 *
 * El catálogo reservable es MÁS ANCHO que el menú que se muestra: se ofrecen
 * (y se registran) hasta `limit`, aunque el agente enseñe tres. Guardar solo lo
 * enseñado dejaba al agente sin alternativas legítimas que aceptar.
 */

export type SpreadSlot = AvailableSlot & {
  /** Día del slot en la zona del negocio (YYYY-MM-DD). */
  dayIso: string;
  /** El día EN PALABRAS: "hoy miércoles 5 de agosto". */
  dayLabel: string;
  /** Solo la hora: "10:00". */
  time: string;
};

export function spreadByDay(
  slots: AvailableSlot[],
  opts: { timezone: string; limit: number; perDay: number; now?: Date }
): SpreadSlot[] {
  const { timezone, limit, perDay } = opts;
  const now = opts.now ?? new Date();
  if (limit <= 0 || perDay <= 0) return [];

  const byDay = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const dayIso = dayIsoInTz(new Date(slot.startUtc), timezone);
    const bucket = byDay.get(dayIso);
    if (bucket) bucket.push(slot);
    else byDay.set(dayIso, [slot]);
  }

  // Los días ya vienen ordenados porque `slots` viene ordenado; el Map
  // conserva el orden de inserción.
  const out: SpreadSlot[] = [];
  for (const [dayIso, daySlots] of byDay) {
    for (const slot of daySlots.slice(0, perDay)) {
      if (out.length >= limit) return out;
      out.push({
        ...slot,
        dayIso,
        dayLabel: dayLabelInTz(slot.startUtc, timezone, now),
        time: timeInTz(slot.startUtc, timezone),
      });
    }
  }
  return out;
}

/** Los días (YYYY-MM-DD) que tienen algo que ofrecer. Los ausentes NO. */
export function daysWithAgenda(slots: SpreadSlot[]): string[] {
  return [...new Set(slots.map((s) => s.dayIso))];
}

/**
 * 015 (ajuste 2026-09-23) — El CATÁLOGO reservable del agente incluido: DENSO
 * en los días próximos, ralo en los siguientes.
 *
 * `spreadByDay` con `perDay: 3` reparte bien ENTRE días, pero deja casi vacío
 * el día de hoy: de catorce huecos libres registraba tres. Medido en vivo en
 * LanCo (2026-09-23) con un cliente real: pidió «para mañana a las 11am», las
 * 11:00 estaban libres pero no estaban en el catálogo, y el agente le contestó
 * que NO había disponibilidad. El cliente insistió y acabó agendando; otro se
 * habría ido.
 *
 * Denso donde la gente pide hora ("¿y a las 11?") y ralo donde pide día ("¿y
 * el viernes?"): las dos preguntas tienen respuesta legítima sin inflar el
 * prompt, porque el catálogo entero viaja al modelo con su instante exacto
 * (FR-023).
 */
export function catalogByDay(
  slots: AvailableSlot[],
  opts: {
    timezone: string;
    /** Días próximos de los que se registra TODO hueco libre. */
    denseDays: number;
    /** Cuántos por día a partir de ahí, para que "otro día" siga teniendo respuesta. */
    perDayAfter: number;
    /** Tope duro: lo que se registra también se le enseña al modelo. */
    limit: number;
    now?: Date;
  }
): SpreadSlot[] {
  const { timezone, denseDays, perDayAfter, limit } = opts;
  const now = opts.now ?? new Date();
  if (limit <= 0) return [];

  const byDay = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const dayIso = dayIsoInTz(new Date(slot.startUtc), timezone);
    const bucket = byDay.get(dayIso);
    if (bucket) bucket.push(slot);
    else byDay.set(dayIso, [slot]);
  }

  const out: SpreadSlot[] = [];
  let dayIndex = 0;
  for (const [dayIso, daySlots] of byDay) {
    const cuantos = dayIndex < denseDays ? daySlots.length : perDayAfter;
    dayIndex += 1;
    if (cuantos <= 0) continue;
    for (const slot of daySlots.slice(0, cuantos)) {
      if (out.length >= limit) return out;
      out.push({
        ...slot,
        dayIso,
        dayLabel: dayLabelInTz(slot.startUtc, timezone, now),
        time: timeInTz(slot.startUtc, timezone),
      });
    }
  }
  return out;
}

/**
 * 015 (ajuste 2026-09-26) — La franja del día que pidió el cliente.
 *
 * Medido en el Laboratorio de LanCo, con dos modelos distintos y el mismo
 * resultado: ante «¿me la cambias a la tarde del lunes?» el agente contestaba
 * «horarios disponibles el lunes POR LA TARDE» y enseñaba 09:00, 09:30 y
 * 10:00. El menú siempre daba los primeros del catálogo, y el modelo narraba
 * esa lista como si fuera lo pedido — una afirmación falsa, de la misma
 * familia que el «no hay disponibilidad» que arreglamos el 23.
 *
 * Se tolera la forma en que venga (`tarde`, `por la tarde`, `pm`…) en vez de
 * exigir un literal: la salida del modelo es impredecible y un acento de más
 * no puede costar el turno.
 *
 * OJO con «mañana»: en español es la franja Y el día siguiente. Quien decide
 * cuál es el modelo, que tiene el contexto; aquí solo se traduce lo que mande.
 */
export type Franja = "am" | "pm";

export function parseFranja(raw: string | null | undefined): Franja | undefined {
  const v = (raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!v) return undefined;
  // 035 — «en la noche» también es pedir lo último del día.
  if (/\b(tarde|noche|pm|vespertin\w*)\b/.test(v)) return "pm";
  if (/\b(manana|temprano|am|matutin\w*)\b/.test(v)) return "am";
  return undefined;
}

/** Antes del mediodía es mañana; de las 12:00 en adelante, tarde. */
export function enFranja(slot: { time: string }, franja: Franja): boolean {
  const hora = Number(slot.time.slice(0, 2));
  return franja === "am" ? hora < 12 : hora >= 12;
}

/** Cada hueco con su día y su hora en la zona del negocio, en el orden en que vienen. */
export function etiquetar(
  slots: AvailableSlot[],
  opts: { timezone: string; now?: Date }
): SpreadSlot[] {
  const now = opts.now ?? new Date();
  return slots.map((slot) => ({
    ...slot,
    dayIso: dayIsoInTz(new Date(slot.startUtc), opts.timezone),
    dayLabel: dayLabelInTz(slot.startUtc, opts.timezone, now),
    time: timeInTz(slot.startUtc, opts.timezone),
  }));
}

/**
 * 035 — `n` elementos REPARTIDOS a lo largo de la lista: el primero, el último
 * y los de en medio a la misma distancia.
 *
 * Decisión del dueño (2026-10-12): pedida la tarde, se enseñan cuatro que la
 * cubran entera —12:00, 14:00, 15:30, 17:30— y no los cuatro primeros, que con
 * huecos de media hora caen todos a la hora de comer. Si ninguno le queda, el
 * cliente pide su hora y está en la oferta igual.
 */
export function repartir<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return [...items];
  if (n === 1) return items.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const item = items[Math.round((i * (items.length - 1)) / (n - 1))];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * 035 — Los `n` huecos más cercanos a una hora pedida, en orden de reloj. A
 * igual distancia gana el más temprano.
 */
export function cercanosA(slots: SpreadSlot[], minutos: number, n: number): SpreadSlot[] {
  const deMinutos = (s: SpreadSlot) => {
    const [h, m] = s.time.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return [...slots]
    .sort(
      (a, b) =>
        Math.abs(deMinutos(a) - minutos) - Math.abs(deMinutos(b) - minutos) ||
        deMinutos(a) - deMinutos(b)
    )
    .slice(0, Math.max(0, n))
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}
