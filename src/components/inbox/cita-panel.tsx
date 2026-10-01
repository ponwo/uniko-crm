"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 030 — La cita del contacto, desde la conversación.
 *
 * Agendar, mover y cancelar con las reglas del motor de la 015, las mismas que
 * en Citas: solo huecos libres (los que ofrecería el agente) y el candado anti
 * doble-reserva. La cita queda ligada a la conversación, así que el agente la
 * ve como CITA ACTUAL y la mueve si el cliente pide otra hora (FR-1504).
 *
 * No le avisa nada al contacto (FR-1506, decisión del dueño): el operador le
 * escribe lo que quiera. Por eso cada confirmación lo recuerda.
 *
 * Solo existe con la agenda encendida: la consulta responde 404 si no, y
 * entonces la sección no se pinta (FR-1501).
 */

type Booking = {
  id: string;
  source: "manual" | "ai";
  scheduledAtUtc: string;
  durationMinutes: number;
  date: string;
  time: string;
  weekday: string;
  meetingLink: string | null;
  linkPending: boolean;
  eventPending: boolean;
  meetingMode: "virtual" | "presencial";
  location: string | null;
  isTest: boolean;
  notes: string | null;
};

type Slot = {
  startUtc: string;
  dayIso: string;
  dayLabel: string;
  time: string;
  label: string;
};

type Picker = { mode: "new" } | { mode: "move"; bookingId: string };

/** "Hoy · mar 29 sep": cabe en un chip del panel; la etiqueta larga no. */
function dayChip(s: Slot): string {
  const prefijo = s.dayLabel.startsWith("hoy")
    ? "Hoy · "
    : s.dayLabel.startsWith("mañana")
      ? "Mañana · "
      : "";
  return `${prefijo}${s.label.split(",")[0] ?? s.dayIso}`;
}

const chip = (on: boolean) =>
  cn(
    "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12.5px] font-semibold transition-colors disabled:opacity-50",
    on
      ? "border-brand bg-brand text-brand-fg"
      : "border-border-strong bg-background text-text-2 hover:border-text-3"
  );

export function CitaPanel({
  contactId,
  conversationId,
  refreshKey = 0,
}: {
  contactId: string;
  conversationId: string;
  /** Sube con cada evento SSE relevante de la bandeja, `booking.updated` incluido. */
  refreshKey?: number;
}) {
  // null = cargando, o la agenda está apagada (404): no se pinta nada.
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // El panel no se desmonta al cambiar de conversación: una respuesta del
  // contacto anterior que llega tarde no debe pintarse en el nuevo.
  const contactoActual = useRef(contactId);
  contactoActual.current = contactId;

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/bookings?contactId=${encodeURIComponent(contactId)}`
    ).catch(() => null);
    if (contactoActual.current !== contactId) return;
    // 404 = agenda apagada: la sección no existe. Otro fallo (un corte de red)
    // no la hace desaparecer: se queda lo último que se vio.
    if (res?.status === 404) {
      setBookings(null);
      return;
    }
    if (!res?.ok) return;
    const data = (await res.json()) as { bookings: Booking[] };
    if (contactoActual.current !== contactId) return;
    setBookings(data.bookings);
  }, [contactId]);

  useEffect(() => {
    setBookings(null);
    setPicker(null);
    setConfirmCancel(null);
    setMessage(null);
    void load();
  }, [load]);

  // En vivo (FR-1507): la IA agendó, o se movió o canceló desde Citas.
  const keyVista = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === keyVista.current) return;
    keyVista.current = refreshKey;
    void load();
  }, [refreshKey, load]);

  async function loadSlots() {
    setSlots(null);
    const res = await fetch("/api/calendar/availability").catch(() => null);
    const data = res?.ok ? ((await res.json()) as { slots: Slot[] }) : { slots: [] };
    setSlots(data.slots);
    setDay((d) => (d && data.slots.some((s) => s.dayIso === d) ? d : (data.slots[0]?.dayIso ?? null)));
  }

  function openPicker(p: Picker) {
    setPicker(p);
    setChosen(null);
    setNote("");
    setMessage(null);
    setConfirmCancel(null);
    setDay(null);
    void loadSlots();
  }

  async function confirm() {
    if (!picker || !chosen) return;
    setBusy(true);
    setMessage(null);
    const res =
      picker.mode === "new"
        ? await fetch("/api/bookings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "session",
              contactId,
              conversationId,
              startUtc: chosen,
              notes: note.trim() || null,
            }),
          }).catch(() => null)
        : await fetch(`/api/bookings/${picker.bookingId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "reschedule", startUtc: chosen }),
          }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      // FR-1508: alguien lo tomó entre verlo y confirmarlo.
      if (data?.error?.code === "slot_taken") {
        setMessage({ kind: "error", text: "Ese horario ya no está disponible: elige otro." });
        setChosen(null);
        void loadSlots();
        return;
      }
      setMessage({
        kind: "error",
        text:
          data?.error?.message ??
          (picker.mode === "new" ? "No se pudo agendar la cita." : "No se pudo mover la cita."),
      });
      return;
    }

    setPicker(null);
    setMessage({
      kind: "ok",
      text:
        picker.mode === "new"
          ? "Cita agendada. Al contacto no le llega aviso."
          : "Cita movida. Al contacto no le llega aviso.",
    });
    await load();
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    }).catch(() => null);
    setBusy(false);
    setConfirmCancel(null);
    if (!res?.ok) {
      setMessage({ kind: "error", text: "No se pudo cancelar la cita." });
      return;
    }
    setMessage({ kind: "ok", text: "Cita cancelada. Al contacto no le llega aviso." });
    await load();
  }

  if (!bookings) return null;

  const dias = (slots ?? []).filter(
    (s, i, all) => all.findIndex((x) => x.dayIso === s.dayIso) === i
  );

  return (
    <section className="border-b p-4">
      <p className="kicker mb-2">Cita</p>

      {bookings.length === 0 && !picker && (
        <p className="mb-2 text-xs text-text-3">Sin cita próxima.</p>
      )}

      {bookings.length > 0 && (
        <ul className="mb-2 space-y-2">
          {bookings.map((b) => (
            <li key={b.id} className="space-y-1.5 rounded-md border bg-subtle p-3">
              <p className="text-[13px] font-semibold">
                {b.weekday} {b.date} · {b.time}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
                <span>{b.durationMinutes} min</span>
                <Badge variant="secondary">{b.source === "ai" ? "Agendó la IA" : "Manual"}</Badge>
                {b.isTest && <Badge variant="secondary">Prueba</Badge>}
                {b.meetingMode === "presencial" && (
                  <Badge variant="secondary">Presencial</Badge>
                )}
              </div>
              {b.location && <p className="text-xs text-text-2">{b.location}</p>}
              {b.meetingLink ? (
                <a
                  href={b.meetingLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-xs text-brand-text hover:underline"
                >
                  Enlace de la reunión
                </a>
              ) : (
                b.linkPending && (
                  <p className="text-xs text-text-3">
                    Sin enlace: el proveedor no respondió.{" "}
                    <Link href="/bookings" className="text-brand-text hover:underline">
                      Reintentar en Citas
                    </Link>
                  </p>
                )
              )}
              {b.eventPending && (
                <p className="text-xs text-text-3">
                  No quedó en tu calendario: Google no respondió.{" "}
                  <Link href="/bookings" className="text-brand-text hover:underline">
                    Reintentar en Citas
                  </Link>
                </p>
              )}
              {b.notes && <p className="text-xs text-text-2">{b.notes}</p>}

              {confirmCancel === b.id ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-text-2">
                    ¿Cancelar esta cita? Se borra la reunión.
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void cancel(b.id)}
                  >
                    Sí, cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmCancel(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => openPicker({ mode: "move", bookingId: b.id })}
                  >
                    Mover
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPicker(null);
                      setMessage(null);
                      setConfirmCancel(b.id);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {picker ? (
        <div className="space-y-2.5 rounded-md border p-3">
          <p className="text-xs font-semibold">
            {picker.mode === "new" ? "Agendar cita" : "Mover la cita"}
          </p>
          {slots === null ? (
            <p className="text-xs text-text-3">Buscando huecos libres…</p>
          ) : slots.length === 0 ? (
            <p className="text-xs text-text-3">
              No hay huecos libres. Revisa el horario en{" "}
              <Link href="/settings/calendar" className="text-brand-text hover:underline">
                Ajustes → Agenda
              </Link>
              .
            </p>
          ) : (
            <>
              <div role="group" aria-label="Día" className="flex flex-wrap gap-1.5">
                {dias.map((d) => (
                  <button
                    key={d.dayIso}
                    type="button"
                    aria-pressed={day === d.dayIso}
                    disabled={busy}
                    onClick={() => {
                      setDay(d.dayIso);
                      setChosen(null);
                    }}
                    className={chip(day === d.dayIso)}
                  >
                    {dayChip(d)}
                  </button>
                ))}
              </div>
              <div role="group" aria-label="Hora" className="flex flex-wrap gap-1.5">
                {slots
                  .filter((s) => s.dayIso === day)
                  .map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      aria-pressed={chosen === s.startUtc}
                      disabled={busy}
                      onClick={() => setChosen(s.startUtc)}
                      className={chip(chosen === s.startUtc)}
                    >
                      {s.time}
                    </button>
                  ))}
              </div>
              {picker.mode === "new" && (
                <Textarea
                  rows={2}
                  placeholder="Nota (opcional)"
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !chosen} onClick={() => void confirm()}>
              {picker.mode === "new" ? "Agendar" : "Mover aquí"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicker(null)}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openPicker({ mode: "new" })}
          disabled={busy}
        >
          {bookings.length > 0 ? "Agendar otra" : "Agendar cita"}
        </Button>
      )}

      {message && (
        <p
          className={cn(
            "mt-2 text-xs",
            message.kind === "ok" ? "text-brand-text" : "text-destructive"
          )}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
