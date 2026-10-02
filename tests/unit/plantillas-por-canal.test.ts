import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL_ORDER } from "@/lib/channels";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 031 — Las plantillas son de WhatsApp. Fuera de él, la ventana cerrada no
 * bloquea al operador: la respuesta sale como de agente humano y la
 * plataforma decide.
 */

// `vi.mock` sube por encima de los import: lo que usan sus fábricas también.
const { graphRequest, getCredentialsByOrg, sendInstagramText, sendMessengerText } =
  vi.hoisted(() => ({
    graphRequest: vi.fn(),
    getCredentialsByOrg: vi.fn(),
    sendInstagramText: vi.fn(),
    sendMessengerText: vi.fn(),
  }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return { ...original, getCredentialsByOrg };
});
vi.mock("@/server/instagram/send", () => ({ sendInstagramText }));
vi.mock("@/server/messenger/send", () => ({ sendMessengerText }));

vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByOrg: async () => ({
    organizationId: "org_1",
    status: "connected",
    source: "zernio",
  }),
  markInstagramReconnectRequired: vi.fn(),
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByOrg: async () => ({
    organizationId: "org_1",
    status: "connected",
    source: "zernio",
  }),
  markMessengerReconnectRequired: vi.fn(),
}));
vi.mock("@/server/channels/enabled", () => ({ isChannelEnabled: () => true }));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id", organizationId: "organizationId" },
    contact: { id: "id" },
    template: { id: "id", organizationId: "organizationId" },
    message: {},
  },
}));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-02T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

function conversationRow(channel: string, lastInboundAt: Date | null, isTest = false) {
  return {
    conversation: {
      id: "cv_1",
      organizationId: "org_1",
      channel,
      channelThreadRef: "zconv-1",
      isTest,
      lastInboundAt,
    },
    contact: {
      id: "ct_1",
      // Con teléfono también fuera de WhatsApp: hoy ningún camino se lo pone a
      // un contacto de Instagram, pero el guardia no puede depender de eso.
      phone: "5215511111111",
      waIdentity: `${channel === "whatsapp" ? "" : channel === "instagram" ? "ig:" : "fb:"}123`,
      waUserId: null,
    },
  };
}

describe("031 · la regla: solo WhatsApp exige plantilla", () => {
  it("WhatsApp con la ventana cerrada (o sin entrantes) exige plantilla; abierta, no", async () => {
    const { requiresTemplate } = await import("@/server/channels/capabilities");
    expect(requiresTemplate("whatsapp", ago(25 * 60 * 60 * 1000), now)).toBe(true);
    expect(requiresTemplate("whatsapp", null, now)).toBe(true);
    expect(requiresTemplate("whatsapp", ago(60 * 60 * 1000), now)).toBe(false);
  });

  it("Instagram y Messenger nunca la exigen, por vieja que sea la conversación", async () => {
    const { requiresTemplate } = await import("@/server/channels/capabilities");
    for (const ch of ["instagram", "messenger"] as const) {
      expect(requiresTemplate(ch, ago(2 * DAY), now)).toBe(false);
      expect(requiresTemplate(ch, ago(30 * DAY), now)).toBe(false);
      expect(requiresTemplate(ch, null, now)).toBe(false);
    }
  });

  it("todo canal del catálogo que no sea WhatsApp responde sin plantilla", async () => {
    const { usesTemplates } = await import("@/server/channels/capabilities");
    for (const ch of CHANNEL_ORDER) {
      expect(usesTemplates(ch)).toBe(ch === "whatsapp");
    }
  });

  it("el plazo del agente humano es de 7 días, y sin entrantes no hay plazo que explicar", async () => {
    const { humanAgentExpired } = await import("@/server/channels/capabilities");
    expect(humanAgentExpired(ago(6 * DAY), now)).toBe(false);
    expect(humanAgentExpired(ago(7 * DAY), now)).toBe(true);
    expect(humanAgentExpired(ago(10 * DAY), now)).toBe(true);
    expect(humanAgentExpired(null, now)).toBe(false);
  });
});

describe("031 · la Bandeja recibe la decisión hecha (ConversationDto)", () => {
  it("templateRequired sale de la misma regla que el envío", async () => {
    const { serializeConversation } = await import("@/server/inbox/queries");
    const base = {
      id: "cv_1",
      organizationId: "org_1",
      contactId: "ct_1",
      isTest: false,
      channelThreadRef: null,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contact = { id: "ct_1", name: "Ana", phone: null } as never;
    const viejo = new Date(Date.now() - 2 * DAY);

    const wa = serializeConversation({ ...base, channel: "whatsapp", lastInboundAt: viejo }, contact);
    expect(wa.windowOpen).toBe(false);
    expect(wa.templateRequired).toBe(true);

    for (const ch of ["instagram", "messenger"] as const) {
      const dto = serializeConversation({ ...base, channel: ch, lastInboundAt: viejo }, contact);
      expect(dto.windowOpen).toBe(false);
      expect(dto.templateRequired).toBe(false);
    }

    const abierta = serializeConversation(
      { ...base, channel: "whatsapp", lastInboundAt: new Date() },
      contact
    );
    expect(abierta.templateRequired).toBe(false);
  });
});

describe("031 · Contactos solo ofrece «Escribir primero» donde hay plantillas", () => {
  it("canWriteFirst sale de las capacidades del canal", async () => {
    const { serializeContact } = await import("@/server/contacts");
    const base = {
      id: "ct_1",
      organizationId: "org_1",
      waIdentity: "5215511111111",
      phone: "5215511111111",
      waUserId: null,
      name: "Ana",
      notes: null,
      ficha: null,
      source: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(serializeContact({ ...base, channel: "whatsapp" }).canWriteFirst).toBe(true);
    expect(serializeContact({ ...base, channel: "instagram", phone: null }).canWriteFirst).toBe(false);
    expect(serializeContact({ ...base, channel: "messenger", phone: null }).canWriteFirst).toBe(false);
  });
});

describe("031 · una plantilla fuera de WhatsApp se rechaza antes de tocarlo", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    getCredentialsByOrg.mockReset();
    selectRows.length = 0;
  });

  it("Instagram o Messenger → channel_without_templates (409), sin credenciales ni Graph", async () => {
    const { sendTemplate, templateErrorStatus, TemplateError } = await import(
      "@/server/whatsapp/templates"
    );
    for (const ch of ["instagram", "messenger"]) {
      selectRows.push([conversationRow(ch, ago(2 * DAY))]);
      const err = await sendTemplate({
        organizationId: "org_1",
        conversationId: "cv_1",
        templateId: "tpl_1",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as InstanceType<typeof TemplateError>).code).toBe("channel_without_templates");
      expect(templateErrorStatus(err as InstanceType<typeof TemplateError>)).toBe(409);
      expect((err as Error).message).toMatch(/plantillas son de WhatsApp/);
    }
    expect(getCredentialsByOrg).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("el sandbox del Laboratorio sigue antes que el canal", async () => {
    const { sendTemplate } = await import("@/server/whatsapp/templates");
    selectRows.push([conversationRow("instagram", ago(2 * DAY), true)]);
    await expect(
      sendTemplate({ organizationId: "org_1", conversationId: "cv_1", templateId: "tpl_1" })
    ).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("en WhatsApp sigue de largo hasta validar la plantilla", async () => {
    const { sendTemplate } = await import("@/server/whatsapp/templates");
    selectRows.push([conversationRow("whatsapp", ago(2 * DAY))], []);
    await expect(
      sendTemplate({ organizationId: "org_1", conversationId: "cv_1", templateId: "tpl_x" })
    ).rejects.toMatchObject({ code: "not_found", message: "Plantilla no encontrada" });
  });
});

describe("031 · el texto libre: WhatsApp igual que siempre, los demás sin bloqueo", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    sendInstagramText.mockReset();
    sendMessengerText.mockReset();
    selectRows.length = 0;
  });

  it("WhatsApp con la ventana cerrada sigue en window_closed, sin tocar Graph", async () => {
    const { sendText } = await import("@/server/inbox/send");
    selectRows.push([conversationRow("whatsapp", new Date(Date.now() - 2 * DAY))]);
    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" })
    ).rejects.toMatchObject({ code: "window_closed" });
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("pasados 7 días, el rechazo de la plataforma se explica en español y conserva el original", async () => {
    const { sendText } = await import("@/server/inbox/send");
    const cases = [
      { ch: "instagram", send: sendInstagramText, label: "Instagram" },
      { ch: "messenger", send: sendMessengerText, label: "Messenger" },
    ];
    for (const { ch, send, label } of cases) {
      send.mockRejectedValueOnce(
        new MetaApiError("(#10) This message is sent outside of allowed window.", { status: 400 })
      );
      selectRows.push([conversationRow(ch, new Date(Date.now() - 9 * DAY))]);
      const err = (await sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
      }).catch((e: unknown) => e)) as Error & { code?: string };
      expect(err.code).toBe("meta_error");
      expect(err.message).toMatch(new RegExp(`^${label} ya no acepta respuestas`));
      expect(err.message).toMatch(/más de 7 días/);
      expect(err.message).toContain("outside of allowed window");
      // Salió etiquetada: Uniko no bloqueó, decidió la plataforma.
      expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ humanAgentTag: true });
    }
  });

  it("dentro de los 7 días, un rechazo se deja tal cual: no se inventa la causa", async () => {
    const { sendText } = await import("@/server/inbox/send");
    sendInstagramText.mockRejectedValueOnce(
      new MetaApiError("Some other platform error", { status: 400 })
    );
    selectRows.push([conversationRow("instagram", new Date(Date.now() - 3 * DAY))]);
    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" })
    ).rejects.toMatchObject({ code: "meta_error", message: "Some other platform error" });
  });
});
