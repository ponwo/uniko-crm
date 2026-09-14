import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 026 — Meta acepta la imagen por URL y solo después puede reportarla
 * `failed` (no pudo descargar la foto). El pie ERA la respuesta del agente:
 * al aplicar ese estado sale como texto, una sola vez, y un fallo del respaldo
 * jamás rompe el webhook (FR-1120).
 */

const sendText = vi.fn();
const publish = vi.fn();
vi.mock("@/server/inbox/send", () => ({ sendText }));
vi.mock("@/server/events/bus", () => ({ publish }));

const selectRows: unknown[][] = [];
const updates: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where"]) chain[m] = () => chain;
      chain.limit = () => Promise.resolve(selectRows.shift() ?? []);
      return chain;
    },
    update: () => ({
      set: (v: unknown) => ({
        where: () => {
          updates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  }),
  schema: {
    message: {
      id: "id",
      conversationId: "conversationId",
      status: "status",
      type: "type",
      text: "text",
      origin: "origin",
      organizationId: "organizationId",
      waMessageId: "waMessageId",
    },
  },
}));

const PIE = "Playera negra (PLY-NEG): 7 pieza — $199 MXN";

function fotoDelAgente(status = "pending") {
  return { id: "msg_1", conversationId: "cv_1", status, type: "image", text: PIE, origin: "ai" };
}

describe("026 — failed tardío de la foto ⇒ el pie sale como texto", () => {
  beforeEach(() => {
    sendText.mockReset();
    publish.mockReset();
    selectRows.length = 0;
    updates.length = 0;
  });

  it("imagen del agente con pie → failed: se manda el texto solo, generado por IA", async () => {
    selectRows.push([fotoDelAgente()]);
    sendText.mockResolvedValue({ messageId: "msg_2" });
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    await applyStatusUpdate("org_1", {
      id: "wamid.foto.1",
      status: "failed",
      errors: [{ code: 131053, message: "Media upload error" }],
    } as never);
    expect(updates[0]).toMatchObject({ status: "failed" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: PIE,
      aiGenerated: true,
    });
  });

  it("un failed repetido para el mismo mensaje no lo manda dos veces (estados monotónicos)", async () => {
    selectRows.push([fotoDelAgente("failed")]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    await applyStatusUpdate("org_1", { id: "wamid.foto.1", status: "failed" } as never);
    expect(updates).toEqual([]);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("delivered/read de la foto, o failed de un texto o de un adjunto del operador: sin respaldo", async () => {
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    selectRows.push([fotoDelAgente()]);
    await applyStatusUpdate("org_1", { id: "wamid.foto.1", status: "delivered" } as never);
    selectRows.push([{ ...fotoDelAgente(), type: "text" }]);
    await applyStatusUpdate("org_1", { id: "wamid.t.1", status: "failed" } as never);
    selectRows.push([{ ...fotoDelAgente(), origin: "operator" }]);
    await applyStatusUpdate("org_1", { id: "wamid.op.1", status: "failed" } as never);
    selectRows.push([{ ...fotoDelAgente(), text: null }]);
    await applyStatusUpdate("org_1", { id: "wamid.sinpie.1", status: "failed" } as never);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("si el respaldo también falla, el webhook no revienta (queda en el log)", async () => {
    selectRows.push([fotoDelAgente()]);
    sendText.mockRejectedValue(new Error("Meta no está disponible ahora"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    await expect(
      applyStatusUpdate("org_1", { id: "wamid.foto.1", status: "failed" } as never)
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[agente] foto"));
    errorSpy.mockRestore();
  });
});
