import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseZernioEvent,
  sendZernioMessage,
  zernioAccountRef,
} from "@/server/zernio";
import { resolveZernioSecret, zernioTargetChannel } from "@/server/zernio/dispatch";

/**
 * Lo que la doc de Zernio dice hoy (docs.zernio.com, cotejada al encender los
 * canales): `account.accountId` es el campo canónico y `account.id` queda por
 * compatibilidad; la respuesta al enviar es `{ data: { messageId } }`.
 */

const ACCOUNT = "665f1c2e8b3a4d0012345678";

function evento(account: Record<string, unknown>) {
  return {
    id: "evt-1",
    event: "message.received",
    message: { id: "m-1", conversationId: "c-1", direction: "incoming", text: "hola", sender: { id: "u-1" } },
    account,
  };
}

describe("Zernio · accountId canónico con `id` heredado", () => {
  it("lee `accountId` cuando viene, y cae a `id` en el formato anterior", () => {
    expect(zernioAccountRef(evento({ accountId: ACCOUNT, platform: "instagram" }))).toBe(ACCOUNT);
    expect(zernioAccountRef(evento({ id: ACCOUNT, platform: "instagram" }))).toBe(ACCOUNT);
    expect(zernioAccountRef(evento({ id: "viejo", accountId: ACCOUNT, platform: "instagram" }))).toBe(ACCOUNT);
    expect(zernioAccountRef(evento({ platform: "instagram" }))).toBeNull();
    expect(zernioAccountRef(null)).toBeNull();
  });

  it("el reparto por plataforma no depende de cuál de los dos ids venga", () => {
    expect(zernioTargetChannel(evento({ accountId: ACCOUNT, platform: "instagram" }))).toBe("instagram");
    expect(zernioTargetChannel(evento({ accountId: ACCOUNT, platform: "facebook" }))).toBe("messenger");
  });

  it("parseZernioEvent sigue exigiendo el bloque `account`", () => {
    expect(parseZernioEvent(JSON.stringify(evento({ accountId: ACCOUNT, platform: "instagram" })))).not.toBeNull();
    expect(parseZernioEvent(JSON.stringify({ object: "instagram", entry: [] }))).toBeNull();
    expect(parseZernioEvent("no es json")).toBeNull();
  });

  it("sin accountId no hay a quién buscarle el secreto (y no toca la base)", async () => {
    const r = await resolveZernioSecret(JSON.stringify(evento({ platform: "instagram" })));
    expect(r).toEqual({ secret: null, accountRef: null, channel: "instagram" });
  });
});

describe("Zernio · respuesta del envío", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respondiendo(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("guarda el messageId real de `data`, que es lo que la API devuelve", async () => {
    const fetchMock = respondiendo({ data: { messageId: "zm-42", conversationId: "c-1" } });
    const r = await sendZernioMessage({
      token: "sk_x",
      accountId: ACCOUNT,
      conversationId: "c-1",
      text: "hola",
      idempotencyKey: "msg_1",
    });
    expect(r.platformMessageId).toBe("zm-42");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/inbox\/conversations\/c-1\/messages$/);
    expect(JSON.parse(String(init.body))).toEqual({ accountId: ACCOUNT, message: "hola" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("msg_1");
  });

  it("fuera de la ventana sale con la etiqueta HUMAN_AGENT", async () => {
    const fetchMock = respondiendo({ data: { messageId: "zm-43" } });
    await sendZernioMessage({ token: "sk_x", accountId: ACCOUNT, conversationId: "c-1", text: "hola", humanAgentTag: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" });
  });

  it("las formas anteriores siguen leyéndose, y sin id hay uno sintético", async () => {
    respondiendo({ message: { id: "viejo-1" } });
    expect((await sendZernioMessage({ token: "sk_x", accountId: ACCOUNT, conversationId: "c-1", text: "a" })).platformMessageId).toBe("viejo-1");
    vi.unstubAllGlobals();
    respondiendo({});
    expect((await sendZernioMessage({ token: "sk_x", accountId: ACCOUNT, conversationId: "c-1", text: "a" })).platformMessageId).toMatch(/^zernio_\d+$/);
  });

  it("sin referencia de hilo no se intenta nada", async () => {
    const fetchMock = respondiendo({});
    await expect(
      sendZernioMessage({ token: "sk_x", accountId: ACCOUNT, conversationId: null, text: "a" })
    ).rejects.toThrow(/hilo/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
