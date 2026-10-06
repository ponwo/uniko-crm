import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * 032 — Entrega del catálogo PDF (FR-1703, FR-1705..FR-1707): UN documento por URL
 * en WhatsApp; si Meta lo rechaza o no lo acepta a tiempo, o el canal no envía
 * documentos, un texto con el pie y el enlace; la ventana cerrada escala como
 * cualquier envío del agente; el Laboratorio persiste el documento sin tocar la API.
 */

const llamadas: string[] = [];
const sendText = vi.fn(async (input: { text: string }) => {
  llamadas.push(`text:${input.text}`);
  return { messageId: "m" };
});
const sendImageLink = vi.fn(async (input: { link: string; caption?: string }) => {
  llamadas.push(`image:${input.link}:${input.caption ?? ""}`);
  return { messageId: "m" };
});
const sendDocumentLink = vi.fn(
  async (input: { link: string; filename: string; caption?: string; signal?: AbortSignal }) => {
    llamadas.push(`document:${input.link}:${input.filename}:${input.caption ?? ""}`);
    return { messageId: "m_doc" };
  }
);
class SendError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}
vi.mock("@/server/inbox/send", () => ({ sendText, sendImageLink, sendDocumentLink, SendError }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/push/avisar", () => ({ avisarDeEscalacion: vi.fn() }));

const inserts: { table: string; values: Record<string, unknown> }[] = [];
const updates: unknown[] = [];
vi.mock("@/lib/db", () => {
  const whereResult = {
    returning: () => Promise.resolve([{ isTest: false }]),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
  };
  return {
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: (table: { name: string }) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table: table.name, values });
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (v: unknown) => {
          updates.push(v);
          return { where: () => whereResult };
        },
      }),
    }),
    schema: {
      mediaAsset: { name: "mediaAsset" },
      message: { name: "message" },
      conversation: { name: "conversation", id: "id" },
      lead: { name: "lead", id: "id" },
    },
  };
});

const { deliverCatalog } = await import("@/server/ai/pipeline");
type Conversation = Parameters<typeof deliverCatalog>[0];

const conv = (over: Partial<Conversation> = {}) =>
  ({ id: "cv_1", organizationId: "org_1", channel: "whatsapp", isTest: false, ...over }) as Conversation;

const URL_PDF = "https://img.stock.example/catalog/ab12.pdf";
const NOMBRE = "Catálogo Otoño 2026.pdf";
const PIE = "¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio";
const RESPALDO = `${PIE}\n${URL_PDF}`;
const TURNO = {
  ok: true as const,
  document: { url: URL_PDF, filename: NOMBRE, caption: PIE },
  fallbackText: RESPALDO,
};

beforeEach(() => {
  llamadas.length = 0;
  inserts.length = 0;
  updates.length = 0;
  sendText.mockClear();
  sendImageLink.mockClear();
  sendDocumentLink.mockClear();
});

let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("032 — deliverCatalog", () => {
  it("WhatsApp: UN documento por URL con su nombre y su pie, con tope de espera; ningún texto", async () => {
    await deliverCatalog(conv(), TURNO);
    expect(llamadas).toEqual([`document:${URL_PDF}:${NOMBRE}:${PIE}`]);
    expect(sendDocumentLink).toHaveBeenCalledTimes(1);
    expect(sendDocumentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "cv_1",
        organizationId: "org_1",
        link: URL_PDF,
        filename: NOMBRE,
        caption: PIE,
        aiGenerated: true,
        signal: expect.any(AbortSignal),
      })
    );
    expect(sendText).not.toHaveBeenCalled();
  });

  it("Meta rechaza el documento: sale el texto con el pie y el enlace, una vez (sin reintentar)", async () => {
    sendDocumentLink.mockImplementationOnce(async () => {
      throw new SendError("meta_error", "(#100) Param document['link'] is not a valid URL");
    });
    await deliverCatalog(conv(), TURNO);
    expect(llamadas).toEqual([`text:${RESPALDO}`]);
    expect(sendDocumentLink).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[agente] catálogo: no se pudo enviar el documento")
    );
  });

  it("Meta no lo acepta a tiempo: el mismo respaldo", async () => {
    sendDocumentLink.mockImplementationOnce(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await deliverCatalog(conv(), TURNO);
    expect(llamadas).toEqual([`text:${RESPALDO}`]);
  });

  it("canal sin documentos (Instagram, Messenger): el texto con el enlace, sin intentar el documento", async () => {
    for (const channel of ["instagram", "messenger"] as const) {
      llamadas.length = 0;
      await deliverCatalog(conv({ channel }), TURNO);
      expect(llamadas, channel).toEqual([`text:${RESPALDO}`]);
    }
    expect(sendDocumentLink).not.toHaveBeenCalled();
  });

  it("ventana de 24 h cerrada: se escala a humano y no sale el respaldo", async () => {
    sendDocumentLink.mockImplementationOnce(async () => {
      throw new SendError("window_closed");
    });
    await deliverCatalog(conv(), TURNO);
    expect(llamadas).toEqual([]);
    expect(updates.some((u) => (u as { handoffReason?: string }).handoffReason === "ventana")).toBe(true);
  });

  it("Laboratorio: el documento se persiste como lo vería el cliente, sin tocar el canal", async () => {
    await deliverCatalog(conv({ isTest: true }), TURNO);
    expect(llamadas).toEqual([]);
    expect(sendDocumentLink).not.toHaveBeenCalled();
    const asset = inserts.find((i) => i.table === "mediaAsset");
    expect(asset?.values).toMatchObject({
      organizationId: "org_1",
      kind: "document",
      fileName: NOMBRE,
      caption: PIE,
      payload: { url: URL_PDF },
      fetchStatus: "available",
    });
    const mensajes = inserts.filter((i) => i.table === "message");
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.values).toMatchObject({
      organizationId: "org_1",
      conversationId: "cv_1",
      direction: "out",
      type: "document",
      text: PIE,
      status: "sent",
      aiGenerated: true,
      origin: "ai",
      mediaAssetId: asset?.values.id,
    });
  });
});
