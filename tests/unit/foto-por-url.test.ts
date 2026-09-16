import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 026 — Foto del producto por URL (contrato §4 de MS-Stock, FR-1119..FR-1121; desde
 * la 028 el motor manda una por producto mostrado, FR-1305, pero cada envío es este).
 *
 * `sendImageLink` manda UN mensaje de imagen con `link` + `caption` y lo
 * persiste como asset sin archivo (`payload.url`) y mensaje `image` con el pie
 * como `text`; si Graph rechaza, no persiste nada (quien llama manda el texto
 * solo); y el sandbox del Laboratorio sigue siendo infranqueable. Todo con la
 * base y Graph falsos: aquí no hay red.
 */

const graphRequest = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
vi.mock("@/server/events/bus", () => ({ publish }));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => ({
    organizationId: "org_1",
    phoneNumberId: "PN1",
    token: "tok",
    wabaId: "waba",
    status: "connected",
  }),
  markReconnectRequired: vi.fn(),
}));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];
/** Cada `insert(...).values(v)`: la tabla (por identidad) y lo insertado. */
const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
const updated: unknown[] = [];

const schema = {
  conversation: { contactId: "contactId", id: "id" },
  contact: { id: "id" },
  message: { name: "message" },
  mediaAsset: { name: "media_asset" },
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        const row = { id: "id_x", createdAt: new Date(), waTimestamp: null, ...values };
        const p = Promise.resolve([row]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => {
          updated.push(v);
          return Promise.resolve();
        },
      }),
    }),
  }),
  schema,
}));

function conversationRow(isTest = false) {
  return [
    {
      conversation: {
        id: "cv_1",
        organizationId: "org_1",
        channel: "whatsapp",
        isTest,
        lastInboundAt: new Date(),
      },
      contact: { id: "ct_1", phone: "5215511111111", waIdentity: "525511111111" },
    },
  ];
}

const LINK = "https://img.stock.example/products/1/ply-neg.jpg";
const PIE = "Playera negra (PLY-NEG): 7 pieza — $199 MXN";

describe("026 — sendImageLink (foto por URL)", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    publish.mockReset();
    selectRows.length = 0;
    inserted.length = 0;
    updated.length = 0;
  });

  it("manda UN mensaje image con link + caption y lo persiste sin archivo", async () => {
    selectRows.push(conversationRow());
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.foto.1" }] });
    const { sendImageLink } = await import("@/server/inbox/send");

    const r = await sendImageLink({
      conversationId: "cv_1",
      organizationId: "org_1",
      link: LINK,
      caption: PIE,
      aiGenerated: true,
      signal: AbortSignal.timeout(5_000),
    });
    expect(r.messageId).toBeTruthy();

    // Ida a Graph: exactamente un POST /messages tipo image por link.
    expect(graphRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = graphRequest.mock.calls[0] as [string, { body: unknown; signal?: AbortSignal }];
    expect(path).toBe("PN1/messages");
    expect(opts.body).toEqual({
      messaging_product: "whatsapp",
      to: "525511111111",
      type: "image",
      image: { link: LINK, caption: PIE },
    });
    expect(opts.signal).toBeInstanceOf(AbortSignal);

    // Persistencia: asset image con la URL (sin storagePath) y mensaje image
    // con el pie como texto, del agente, pendiente de acuse.
    const asset = inserted.find((i) => i.table === schema.mediaAsset)?.values;
    expect(asset).toMatchObject({ kind: "image", payload: { url: LINK }, caption: PIE, fetchStatus: "available" });
    expect(asset?.storagePath).toBeUndefined();
    const message = inserted.find((i) => i.table === schema.message)?.values;
    expect(message).toMatchObject({
      type: "image",
      text: PIE,
      waMessageId: "wamid.foto.1",
      status: "pending",
      aiGenerated: true,
      origin: "ai",
      direction: "out",
    });
    expect(publish).toHaveBeenCalledWith("org_1", expect.objectContaining({ type: "message.new" }));
  });

  it("sin pie: la imagen va sola (WhatsApp rechaza caption vacío)", async () => {
    selectRows.push(conversationRow());
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.foto.2" }] });
    const { sendImageLink } = await import("@/server/inbox/send");
    await sendImageLink({ conversationId: "cv_1", organizationId: "org_1", link: LINK });
    const [, opts] = graphRequest.mock.calls[0] as [string, { body: { image: unknown } }];
    expect(opts.body.image).toEqual({ link: LINK });
    const message = inserted.find((i) => i.table === schema.message)?.values;
    expect(message).toMatchObject({ type: "image", text: null, origin: "operator" });
  });

  it("Graph rechaza → SendError y NADA se persiste (el hilo no enseña un fallo que el cliente no vio)", async () => {
    selectRows.push(conversationRow());
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(
      new MetaApiError("(#100) Param image['link'] is not a valid URL", { status: 400, code: 100 })
    );
    const { sendImageLink } = await import("@/server/inbox/send");
    await expect(
      sendImageLink({ conversationId: "cv_1", organizationId: "org_1", link: LINK, caption: PIE })
    ).rejects.toMatchObject({ code: "meta_error" });
    expect(inserted).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("la espera cortada (timeout) se traduce a meta_unavailable y tampoco persiste", async () => {
    selectRows.push(conversationRow());
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }));
    const { sendImageLink } = await import("@/server/inbox/send");
    await expect(
      sendImageLink({ conversationId: "cv_1", organizationId: "org_1", link: LINK, caption: PIE })
    ).rejects.toMatchObject({ code: "meta_unavailable" });
    expect(inserted).toEqual([]);
  });

  it("conversación is_test → sandbox_violation sin tocar Graph ni la base", async () => {
    selectRows.push(conversationRow(true));
    const { sendImageLink } = await import("@/server/inbox/send");
    await expect(
      sendImageLink({ conversationId: "cv_1", organizationId: "org_1", link: LINK, caption: PIE })
    ).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(graphRequest).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });
});
