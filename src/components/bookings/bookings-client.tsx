"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/components/use-events";
import { cn } from "@/lib/utils";

/** 015 — Citas: lo agendado por el operador y por la IA, con sus acciones. */

type Booking = {
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
  connector: string | null;
  meetingLink: string | null;
  linkPending: boolean;
  isTest: boolean;
  notes: string | null;
};

type Slot = { startUtc: string; label: string };

const STATUS_LABEL: Record<Booking["status"], string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  no_show: "No asistió",
  cancelada: "Cancelada",
};

type StatusFilter = Booking["status"] | "all";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "agendada", label: "Agendadas" },
  { id: "realizada", label: "Realizadas" },
  { id: "no_show", label: "No asistió" },
  { id: "cancelada", label: "Canceladas" },
  { id: "all", label: "Todas" },
];

export function BookingsClient() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  // Arranca en lo accionable: con todo mezclado, las canceladas y las ya
  // atendidas tapaban las que siguen pendientes.
  const [filter, setFilter] = useState<StatusFilter>("agendada");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [blockStart, setBlockStart] = useState("");
  const [blockMinutes, setBlockMinutes] = useState(60);

  useEffect(() => {
    void refresh();
  }, []);

  // La agenda cambia también cuando agenda la IA: SSE mantiene la vista viva.
  // Y tras un hueco de conexión hay que recargar: una cita creada o movida
  // mientras no llegaban eventos no aparecería nunca sola.
  useEvents({
    onBookingUpdated: () => void refresh(),
    onReconnect: () => void refresh(),
  });

  async function refresh() {
    const [list, avail] = await Promise.all([
      fetch("/api/bookings").catch(() => null),
      fetch("/api/calendar/availability").catch(() => null),
    ]);
    if (list?.ok) {
      const data = (await list.json()) as { bookings: Booking[] };
      setBookings(data.bookings);
    } else {
      setBookings([]);
    }
    if (avail?.ok) {
      const data = (await avail.json()) as { slots: Slot[] };
      setSlots(data.slots.slice(0, 12));
    }
  }

  async function act(id: string, body: unknown) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo completar la acción");
      return;
    }
    setRescheduling(null);
    await refresh();
  }

  async function createBlock() {
    if (!blockStart) return;
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "block",
        // El input datetime-local da hora local del navegador.
        startUtc: new Date(blockStart).toISOString(),
        durationMinutes: blockMinutes,
      }),
    }).catch(() => null);
    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo bloquear ese rango");
      return;
    }
    setBlockStart("");
    await refresh();
  }

  if (!bookings) return <p className="text-sm text-text-3">Cargando…</p>;

  const countOf = (f: StatusFilter) =>
    f === "all" ? bookings.length : bookings.filter((b) => b.status === f).length;
  const visible =
    filter === "all" ? bookings : bookings.filter((b) => b.status === filter);
  const filterLabel = FILTERS.find((f) => f.id === filter)?.label ?? "";

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Bloquear un rango</h3>
        <p className="text-sm text-text-3">
          Para compromisos que viven fuera del CRM: ese tiempo deja de
          ofrecerse.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="block-start">Inicio</Label>
            <Input
              id="block-start"
              type="datetime-local"
              value={blockStart}
              onChange={(e) => setBlockStart(e.target.value)}
              className="w-56"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-min">Minutos</Label>
            <Input
              id="block-min"
              type="number"
              min={10}
              max={480}
              value={blockMinutes}
              onChange={(e) => setBlockMinutes(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button
            variant="secondary"
            onClick={createBlock}
            disabled={!blockStart}
          >
            Bloquear
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Citas</h3>
        {bookings.length === 0 ? (
          <p className="text-sm text-text-3">
            Todavía no hay nada agendado. Configura tu horario en Ajustes →
            Agenda para empezar a recibir citas.
          </p>
        ) : (
          <div
            role="group"
            aria-label="Filtrar citas por estado"
            className="flex flex-wrap items-center gap-1.5"
          >
            {FILTERS.map((f) => {
              const on = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12.5px] font-semibold transition-colors",
                    on
                      ? "border-brand bg-brand text-brand-fg"
                      : "border-border-strong bg-background text-text-2 hover:border-text-3"
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px]",
                      on ? "bg-brand-veil" : "bg-secondary text-text-3"
                    )}
                  >
                    {countOf(f.id)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {bookings.length > 0 && visible.length === 0 && (
          <p className="text-sm text-text-3">
            No hay citas en «{filterLabel}».
          </p>
        )}
        <ul className={cn("divide-y rounded-md border", visible.length === 0 && "hidden")}>
          {visible.map((b) => (
            <li key={b.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {b.weekday} {b.date} · {b.time}
                </span>
                <span className="text-xs text-text-3">
                  {b.durationMinutes} min
                </span>
                <Badge
                  variant={b.status === "cancelada" ? "secondary" : "default"}
                >
                  {STATUS_LABEL[b.status]}
                </Badge>
                {b.kind === "block" ? (
                  <Badge variant="secondary">Bloqueo</Badge>
                ) : (
                  <Badge variant="secondary">
                    {b.source === "ai" ? "Agendó la IA" : "Manual"}
                  </Badge>
                )}
                {b.isTest && <Badge variant="secondary">Prueba</Badge>}
                {b.linkPending && b.status !== "cancelada" && (
                  <Badge variant="secondary">Sin enlace</Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-text-3">
                {b.contact && <span>{b.contact.name}</span>}
                {b.meetingLink && (
                  <a
                    href={b.meetingLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-text hover:underline"
                  >
                    Enlace de la reunión
                  </a>
                )}
                {b.notes && <span>{b.notes}</span>}
              </div>

              {/* El proveedor falló al crear la reunión. La cita existe; lo
                  único que falta es el enlace, y se reintenta desde aquí — sin
                  esto, un hipo del proveedor sería una pérdida silenciosa. */}
              {b.linkPending && b.status !== "cancelada" && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm bg-subtle p-2">
                  <span className="text-sm text-text-2">
                    Esta cita quedó sin enlace: el proveedor no respondió.
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, { action: "retry_link" })}
                  >
                    Reintentar enlace
                  </Button>
                </div>
              )}

              {b.status === "agendada" && (
                <div className="flex flex-wrap gap-2">
                  {/* Un bloqueo no se "realiza" ni tiene quien falte: solo se
                      mueve o se quita. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() =>
                      setRescheduling((r) => (r === b.id ? null : b.id))
                    }
                  >
                    Reprogramar
                  </Button>
                  {b.kind === "session" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === b.id}
                        onClick={() =>
                          act(b.id, { action: "status", status: "realizada" })
                        }
                      >
                        Realizada
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === b.id}
                        onClick={() =>
                          act(b.id, { action: "status", status: "no_show" })
                        }
                      >
                        No asistió
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, { action: "cancel" })}
                  >
                    {b.kind === "block" ? "Quitar bloqueo" : "Cancelar"}
                  </Button>
                </div>
              )}

              {rescheduling === b.id && (
                <div className="space-y-1 rounded-sm bg-subtle p-2">
                  {slots.length === 0 && (
                    <p className="text-sm text-text-3">
                      No hay huecos libres para mover esta cita.
                    </p>
                  )}
                  {slots.map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      disabled={busy === b.id}
                      onClick={() =>
                        act(b.id, {
                          action: "reschedule",
                          startUtc: s.startUtc,
                        })
                      }
                      className="block w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
