import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 015 (modalidad, 2026-09-30) — Citas virtuales o presenciales.
 *
 * Es una decisión del NEGOCIO, no de cada cita: en Ajustes → Agenda elige
 * «En línea» o «Presencial». Lo que se fija aquí es lo que el cliente recibe y
 * lo que llega al proveedor:
 *  - presencial jamás manda un enlace — ni el de Meet ni la sala fija — y
 *    nunca promete uno («en un momento te comparto el enlace»);
 *  - con Google, el evento se crea igual (sin Meet): es donde el dueño mira
 *    su día;
 *  - la cita copia la modalidad y la dirección con las que nació.
 */

const SLOT = "2026-08-05T15:00:00.000Z";

type Settings = {
  weeklyHours: Record<string, { start: string; end: string }[]>;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
  connector: "enlace-fijo" | "zoom" | "google";
  meetingLink: string | null;
  meetingMode: "virtual" | "presencial";
  location: string | null;
};

const BASE: Settings = {
  weeklyHours: { wed: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "google",
  meetingLink: null,
  meetingMode: "virtual",
  location: null,
};

let settings: Settings = { ...BASE };

const createMeeting = vi.fn(
  async (req: { video?: boolean }): Promise<{ externalId: string | null; joinUrl: string | null }> => ({
    externalId: "evt_1",
    joinUrl: req.video === false ? null : "https://meet.google.test/abc",
  })
);
const bindConnector = vi.fn(async () => ({
  id: settings.connector,
  createMeeting,
  updateMeeting: async () => {},
  deleteMeeting: async () => {},
  testConnection: async () => ({ ok: true }),
}));

vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => settings }));
vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 09:00" }),
  computeAvailability: async () => [],
}));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }],
    replaceOffers: async () => {},
    clearOffers: async () => {},
  };
});
vi.mock("@/server/agenda/connectors", () => ({
  bindConnector,
  markConnectorAuthError: async () => {},
}));
vi.mock("@/server/leads/stage-history", () => ({
  moveLeadToStage: async () => ({ ok: true }),
}));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));

const selectRows: unknown[][] = [];
let lastInsert: Record<string, unknown> | null = null;
/** La fila viva: el insert la crea y cada `update` la va cambiando. */
let row: Record<string, unknown> = {};

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectRows.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          lastInsert = v;
          row = {
            ...v,
            scheduledAt: new Date(SLOT),
            externalRef: null,
            meetingLink: null,
            linkPending: false,
          };
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            row = { ...row, ...v };
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  }),
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
  },
}));

/** Una conversación REAL (no del Laboratorio) con su contacto y sin lead. */
function conversacionReal() {
  selectRows.push([{ contactId: "ct_1", isTest: false }]);
  selectRows.push([{ name: "Ana" }]);
  selectRows.push([]);
}

async function reservar() {
  const { createSessionBooking } = await import("@/server/agenda/service");
  conversacionReal();
  return createSessionBooking({
    organizationId: "org_1",
    conversationId: "cv_1",
    startUtc: SLOT,
    source: "ai",
    requireOffer: true,
  });
}

const DIRECCION = "Av. Juárez 10, Centro, CDMX";

describe("la modalidad de la cita", () => {
  beforeEach(() => {
    settings = { ...BASE };
    selectRows.length = 0;
    lastInsert = null;
    row = {};
    createMeeting.mockClear();
    bindConnector.mockClear();
  });

  it("EN LÍNEA (default): Google crea Meet y la cita lleva su enlace", async () => {
    const result = await reservar();

    expect(createMeeting).toHaveBeenCalledOnce();
    expect(createMeeting.mock.calls[0]![0]).toMatchObject({ video: true });
    expect(lastInsert).toMatchObject({ meetingMode: "virtual", location: null });
    expect(result.meetingLink).toBe("https://meet.google.test/abc");
    expect(result.location).toBeNull();
  });

  it("PRESENCIAL con Google: el evento se crea SIN Meet y con la dirección", async () => {
    settings = { ...BASE, meetingMode: "presencial", location: DIRECCION };
    const result = await reservar();

    expect(createMeeting).toHaveBeenCalledOnce();
    expect(createMeeting.mock.calls[0]![0]).toMatchObject({
      video: false,
      location: DIRECCION,
    });
    expect(lastInsert).toMatchObject({ meetingMode: "presencial", location: DIRECCION });
    expect(result.meetingLink).toBeNull();
    expect(result.linkPending).toBe(false);
    expect(result.location).toBe(DIRECCION);
  });

  it("PRESENCIAL con enlace fijo: ni se llama al conector, aunque haya sala", async () => {
    settings = {
      ...BASE,
      connector: "enlace-fijo",
      meetingLink: "https://meet.ejemplo.com/sala",
      meetingMode: "presencial",
      location: DIRECCION,
    };
    const result = await reservar();

    expect(bindConnector).not.toHaveBeenCalled();
    expect(result.meetingLink).toBeNull();
    expect(result.linkPending).toBe(false);
    expect(result.location).toBe(DIRECCION);
  });

  it("PRESENCIAL y Google caído: la cita queda, SIN prometer un enlace", async () => {
    // `linkPending` es lo que hace decir «en un momento te comparto el
    // enlace»; a un cliente que viene al local no se le debe ninguno.
    settings = { ...BASE, meetingMode: "presencial", location: DIRECCION };
    createMeeting.mockRejectedValueOnce(new Error("Google respondió 503"));
    const result = await reservar();

    expect(result.booking.id).toBe(lastInsert?.id);
    expect(result.linkPending).toBe(false);
    expect(result.meetingLink).toBeNull();
  });

  it("EN LÍNEA y Google caído: sigue quedando pendiente de reintentar", async () => {
    createMeeting.mockRejectedValueOnce(new Error("Google respondió 503"));
    const result = await reservar();
    expect(result.linkPending).toBe(true);
  });

  it("la dirección guardada NO viaja en una cita en línea", async () => {
    // Se conserva en la configuración por si el negocio vuelve a presencial,
    // pero no se copia a una cita virtual.
    settings = { ...BASE, meetingMode: "virtual", location: DIRECCION };
    await reservar();
    expect(lastInsert).toMatchObject({ meetingMode: "virtual", location: null });
  });
});

describe("lo que el agente le escribe al cliente", () => {
  beforeEach(() => {
    settings = { ...BASE };
    selectRows.length = 0;
    row = {};
    createMeeting.mockClear();
    bindConnector.mockClear();
  });

  async function confirmar() {
    const { bookSlot } = await import("@/server/agenda/agent");
    conversacionReal();
    return bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
    });
  }

  it("presencial: la dirección, y ni una palabra de enlace", async () => {
    settings = { ...BASE, meetingMode: "presencial", location: DIRECCION };
    const turn = await confirmar();

    expect(turn.ok).toBe(true);
    expect(turn.text).toContain(`Te esperamos en: ${DIRECCION}`);
    expect(turn.text.toLowerCase()).not.toContain("enlace");
  });

  it("presencial sin dirección: solo la confirmación", async () => {
    settings = { ...BASE, meetingMode: "presencial", location: null };
    const turn = await confirmar();

    expect(turn.text).toBe("¡Listo! Te agendé para mié 5 ago, 09:00.");
  });

  it("en línea: el enlace, como siempre", async () => {
    const turn = await confirmar();
    expect(turn.text).toContain("Enlace: https://meet.google.test/abc");
  });
});
