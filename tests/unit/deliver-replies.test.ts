import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 028 — Entrega de un turno de varios mensajes (FR-1305, FR-1306): en serie y en
 * orden, uno por producto, reutilizando la regla de la 026 por mensaje; colapso a
 * UN solo texto cuando no hay foto enviable (productos sin foto o canal sin
 * imágenes); el Laboratorio persiste cada mensaje; la ventana cerrada detiene la
 * serie.
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
class SendError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}
vi.mock("@/server/inbox/send", () => ({ sendText, sendImageLink, SendError }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/push/avisar", () => ({ avisarDeEscalacion: vi.fn() }));

const inserts: { table: string; values: Record<string, unknown> }[] = [];
const updates: unknown[] = [];
/** Ajuste 2026-09-17: estados que devuelve `message.status` en cada sondeo (vacío ⇒ sin fila). */
const estados: string[] = [];
let estadoFijo: string | null = null;
vi.mock("@/lib/db", () => {
  const whereResult = {
    returning: () => Promise.resolve([{ isTest: false }]),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
  };
  const selectResult = () => {
    const status = estadoFijo ?? estados.shift();
    if (status) llamadas.push(`status:${status}`);
    return Promise.resolve(status ? [{ status }] : []);
  };
  return {
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: selectResult }) }) }),
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

const { deliverReplies } = await import("@/server/ai/pipeline");
type Conversation = Parameters<typeof deliverReplies>[0];

const conv = (over: Partial<Conversation> = {}) =>
  ({ id: "cv_1", organizationId: "org_1", channel: "whatsapp", isTest: false, ...over }) as Conversation;

const FOTO_A = "https://img.stock.example/a.jpg";
const FOTO_B = "https://img.stock.example/b.jpg";

beforeEach(() => {
  llamadas.length = 0;
  inserts.length = 0;
  updates.length = 0;
  estados.length = 0;
  estadoFijo = null;
  sendText.mockClear();
  sendImageLink.mockClear();
  vi.useRealTimers();
});

describe("028 — deliverReplies", () => {

  it("con fotos: un envío por mensaje, en orden; el sin foto va como texto en su lugar", async () => {
    await deliverReplies(conv(), [
      { text: "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN", imageUrl: FOTO_A },
      { text: "Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN", imageUrl: null },
      { text: "Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([
      `image:${FOTO_A}:Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN`,
      "text:Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN",
      `image:${FOTO_B}:Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN`,
    ]);
  });

  it("sin ninguna foto: UN solo texto con todas las líneas (idéntico a la 026)", async () => {
    await deliverReplies(conv(), [
      { text: "Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN", imageUrl: null },
      { text: "Pantalón negro (PAN-NG) talla 32: 1 pieza — $650 MXN", imageUrl: null },
    ]);
    expect(llamadas).toEqual([
      "text:Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN\nPantalón negro (PAN-NG) talla 32: 1 pieza — $650 MXN",
    ]);
  });

  it("canal sin imágenes salientes (messenger): UN solo texto aunque haya fotos", async () => {
    await deliverReplies(conv({ channel: "messenger" }), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual(["text:A\nB"]);
    expect(sendImageLink).not.toHaveBeenCalled();
  });

  it("una imagen rechazada: esa línea sale como texto, las demás con foto, mismo orden", async () => {
    sendImageLink.mockImplementationOnce(async () => {
      throw new SendError("meta_error", "(#100) Param image['link'] is not a valid URL");
    });
    await deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    // La primera imagen falla ⇒ su texto sale solo (sin reintentar la foto); la segunda sale con foto.
    expect(llamadas).toEqual(["text:A", `image:${FOTO_B}:B`]);
  });

  it("conversación de prueba (Laboratorio): cada mensaje se persiste con su imagen, sin tocar el canal", async () => {
    await deliverReplies(conv({ isTest: true }), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: null },
      { text: "C", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([]);
    const mensajes = inserts.filter((i) => i.table === "message");
    expect(mensajes.map((m) => [m.values.type, m.values.text])).toEqual([
      ["image", "A"],
      ["text", "B"],
      ["image", "C"],
    ]);
    const assets = inserts.filter((i) => i.table === "mediaAsset");
    expect(assets.map((a) => (a.values.payload as { url: string }).url)).toEqual([FOTO_A, FOTO_B]);
  });

  it("ventana cerrada en el primer mensaje: se escala y NO se manda el resto", async () => {
    sendImageLink.mockImplementationOnce(async () => {
      throw new SendError("window_closed");
    });
    await deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([]);
    expect(updates.some((u) => (u as { handoffReason?: string }).handoffReason === "ventana")).toBe(true);
  });
});

/* ---------- Ajuste 2026-09-17: orden de llegada (FR-1314) ---------- */

describe("028 — deliverReplies espera el `sent` de la foto anterior", () => {
  it("la segunda imagen sale solo cuando Meta reportó `sent` de la primera", async () => {
    estados.push("pending", "pending", "sent");
    await deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([
      `image:${FOTO_A}:A`,
      "status:pending",
      "status:pending",
      "status:sent",
      `image:${FOTO_B}:B`,
    ]);
  });

  it("si el estado no llega, el tope de 2 s manda el siguiente igual (ni antes ni nunca)", async () => {
    vi.useFakeTimers();
    estadoFijo = "pending";
    const done = deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(sendImageLink).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(sendImageLink).toHaveBeenCalledTimes(2);
    expect(llamadas.filter((l) => l === "status:pending").length).toBeGreaterThan(10);
  });

  it("tras un texto no se espera nada; tras la última foto tampoco", async () => {
    estados.push("sent");
    await deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: null },
      { text: "C", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([`image:${FOTO_A}:A`, "status:sent", "text:B", `image:${FOTO_B}:C`]);
  });

  it("conversación de prueba: sin sondeos (no hay estados que esperar)", async () => {
    estadoFijo = "pending";
    await deliverReplies(conv({ isTest: true }), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual([]);
    expect(inserts.filter((i) => i.table === "message")).toHaveLength(2);
  });

  it("una foto rechazada (salió como texto) no hace esperar al siguiente", async () => {
    estadoFijo = "pending";
    sendImageLink.mockImplementationOnce(async () => {
      throw new SendError("meta_error", "(#100) Param image['link'] is not a valid URL");
    });
    await deliverReplies(conv(), [
      { text: "A", imageUrl: FOTO_A },
      { text: "B", imageUrl: FOTO_B },
    ]);
    expect(llamadas).toEqual(["text:A", `image:${FOTO_B}:B`]);
  });
});
