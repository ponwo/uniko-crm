import { describe, expect, it, vi } from "vitest";

/**
 * 030 — Las citas PRÓXIMAS de un contacto, para la sección «Cita» del panel de
 * la conversación (FR-1502).
 *
 * El corte por tiempo vive en JS (`upcomingBookings`) y no en el `where`: el
 * doble de base ignora el `where`, así que un corte en SQL sería invisible
 * aquí — y así llegaron a producción dos fallos de la agenda. Con el reloj en
 * la mano, una cita "de hace media hora" se lee sin esperar media hora.
 */

vi.mock("@/server/agenda/settings", () => ({
  getSettings: async () => ({ timezone: "America/Mexico_City" }),
}));

// Cualquier consulta a la base en estos casos sería un fallo: se hace estallar.
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("no debía tocar la base");
  },
  schema: { booking: {}, contact: { id: {}, name: {} } },
}));

const { upcomingBookings } = await import("@/server/agenda/queries");

type Cita = Parameters<typeof upcomingBookings>[0][number];

const AHORA = new Date("2026-09-29T21:00:00.000Z");

function cita(over: Partial<Cita>): Cita {
  return {
    id: "bk_1",
    kind: "session",
    status: "agendada",
    source: "manual",
    scheduledAtUtc: "2026-09-30T16:00:00.000Z",
    durationMinutes: 30,
    date: "",
    time: "",
    weekday: "",
    contact: { id: "ct_1", name: "Ana" },
    conversationId: "cv_1",
    connector: "enlace-fijo",
    meetingLink: null,
    linkPending: false,
    meetingMode: "virtual",
    location: null,
    isTest: false,
    notes: null,
    ...over,
  };
}

const ids = (items: Cita[]) => items.map((c) => c.id);

describe("030 — las citas próximas del contacto", () => {
  it("una que ya terminó queda fuera; una EN CURSO sigue a la vista, con su enlace", () => {
    const terminada = cita({ id: "terminada", scheduledAtUtc: "2026-09-29T20:00:00.000Z" });
    const enCurso = cita({ id: "en-curso", scheduledAtUtc: "2026-09-29T20:45:00.000Z" });
    expect(ids(upcomingBookings([terminada, enCurso], AHORA))).toEqual(["en-curso"]);
  });

  it("la que termina justo ahora ya no cuenta", () => {
    const justo = cita({ id: "justo", scheduledAtUtc: "2026-09-29T20:30:00.000Z" });
    expect(upcomingBookings([justo], AHORA)).toEqual([]);
  });

  it("la duración cuenta: una de 90 minutos que empezó hace una hora sigue en curso", () => {
    const larga = cita({
      id: "larga",
      scheduledAtUtc: "2026-09-29T20:00:00.000Z",
      durationMinutes: 90,
    });
    expect(ids(upcomingBookings([larga], AHORA))).toEqual(["larga"]);
  });

  it("canceladas, realizadas, no-show y bloqueos quedan fuera aunque sean futuros", () => {
    const futuras = [
      cita({ id: "cancelada", status: "cancelada" }),
      cita({ id: "realizada", status: "realizada" }),
      cita({ id: "no-show", status: "no_show" }),
      cita({ id: "bloqueo", kind: "block", contact: null }),
      cita({ id: "agendada" }),
    ];
    expect(ids(upcomingBookings(futuras, AHORA))).toEqual(["agendada"]);
  });

  it("de la más cercana a la más lejana, lleguen como lleguen", () => {
    const lejana = cita({ id: "lejana", scheduledAtUtc: "2026-10-05T16:00:00.000Z" });
    const cercana = cita({ id: "cercana", scheduledAtUtc: "2026-09-30T15:00:00.000Z" });
    const media = cita({ id: "media", scheduledAtUtc: "2026-10-01T16:00:00.000Z" });
    expect(ids(upcomingBookings([lejana, cercana, media], AHORA))).toEqual([
      "cercana",
      "media",
      "lejana",
    ]);
  });

  it("sin citas, lista vacía", () => {
    expect(upcomingBookings([], AHORA)).toEqual([]);
  });
});
