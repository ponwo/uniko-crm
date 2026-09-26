import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 015 (ajuste 2026-09-26) — La «cita actual» solo cuenta si NO ha pasado.
 *
 * Encontrado en producción por el dueño (2026-09-25, 21:32). Un cliente
 * escribió «hola quisiera agendar una cita» y el agente contestó:
 *
 *   «ya tienes una cita agendada para mañana jueves 24 a las 10:00 am 😄
 *    ¿Quieres conservarla o prefieres que la movamos a otra hora?»
 *
 * Era viernes 25: esa cita había sido el día ANTERIOR. Sin filtro de fecha,
 * cualquier cita vieja convierte a un cliente que vuelve en un cliente al que
 * se le niega una cita nueva — y encima ofreciéndole mover algo que el motor
 * rechazaría, porque `rescheduleForConversation` sí filtra por fecha.
 *
 * El corte vive en JS y no en SQL para que esta prueba pueda existir: el mock
 * de la base ignora el `where`, así que un filtro en SQL sería invisible aquí.
 * Así fue como el fallo llegó a producción sin que ninguna prueba lo viera.
 */

const settings = {
  weeklyHours: {},
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo" as const,
  meetingLink: null,
};

vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => settings }));

let filas: { scheduledAt: Date }[] = [];

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(filas);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain() }),
  schema: { booking: {} },
}));

const { bookedInConversation } = await import("@/server/agenda/agent");

const AHORA = new Date("2026-09-25T21:32:00.000Z");
const entrada = {
  organizationId: "org_1",
  conversationId: "cv_1",
  now: AHORA,
};

beforeEach(() => {
  filas = [];
});

describe("015 — la cita actual del cliente", () => {
  it("una cita que YA PASÓ no cuenta: el cliente puede agendar de nuevo", () => {
    filas = [{ scheduledAt: new Date("2026-09-24T16:00:00.000Z") }];
    return expect(bookedInConversation(entrada)).resolves.toBeNull();
  });

  it("una cita futura sí cuenta, con su etiqueta", async () => {
    filas = [{ scheduledAt: new Date("2026-09-28T17:00:00.000Z") }];
    await expect(bookedInConversation(entrada)).resolves.toMatch(/28 sep/);
  });

  it("con una pasada y una futura, devuelve la FUTURA", async () => {
    filas = [
      { scheduledAt: new Date("2026-09-24T16:00:00.000Z") },
      { scheduledAt: new Date("2026-09-28T17:00:00.000Z") },
    ];
    await expect(bookedInConversation(entrada)).resolves.toMatch(/28 sep/);
  });

  it("una cita que empieza justo ahora todavía cuenta", async () => {
    filas = [{ scheduledAt: AHORA }];
    await expect(bookedInConversation(entrada)).resolves.not.toBeNull();
  });

  it("sin citas, no hay cita actual", () => {
    return expect(bookedInConversation(entrada)).resolves.toBeNull();
  });
});
