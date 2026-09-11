import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseZernioEvent,
  sendZernioMessage,
  verifyZernioAccount,
  zernioAccountRef,
  ZernioVerifyError,
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

describe("Zernio · verifyZernioAccount: cada causa de fallo con su nombre", () => {
  afterEach(() => vi.unstubAllGlobals());

  const cuentas = {
    accounts: [
      { _id: ACCOUNT, platform: "instagram", username: "lanco.dmd", displayName: "LanCo" },
      { _id: "fb-1", platform: "facebook", username: null, displayName: "Página" },
    ],
  };

  function zernio(handlers: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
      const h = handlers[path];
      if (!h) throw new Error(`sin handler para ${path}`);
      return h();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const json = (body: unknown, status = 200) => () =>
    new Response(JSON.stringify(body), { status });

  it("llave válida + cuenta de la plataforma + Inbox contratado → devuelve el nombre", async () => {
    zernio({ "/accounts": json(cuentas), "/inbox/conversations": json({ data: [] }) });
    await expect(
      verifyZernioAccount({ token: "sk_x", accountId: ACCOUNT, platform: "instagram" })
    ).resolves.toEqual({ username: "lanco.dmd", displayName: "LanCo" });
  });

  it("llave válida pero el plan no incluye el Inbox → inbox_required (NO 'llave inválida')", async () => {
    // El 403 literal de Zernio, el que se llevó la primera conexión real.
    zernio({
      "/accounts": json(cuentas),
      "/inbox/conversations": json(
        { error: "Inbox addon required. Upgrade to access inbox features.", code: "INBOX_REQUIRED" },
        403
      ),
    });
    const err = await verifyZernioAccount({ token: "sk_x", accountId: ACCOUNT, platform: "instagram" }).catch((e) => e);
    expect(err).toBeInstanceOf(ZernioVerifyError);
    expect(err.code).toBe("inbox_required");
    expect(err.message).toMatch(/Inbox/);
  });

  it("la cuenta es de otra plataforma → platform_mismatch", async () => {
    zernio({ "/accounts": json(cuentas) });
    const err = await verifyZernioAccount({ token: "sk_x", accountId: "fb-1", platform: "instagram" }).catch((e) => e);
    expect(err.code).toBe("platform_mismatch");
  });

  it("el accountId no es de esa llave → account_not_found", async () => {
    zernio({ "/accounts": json(cuentas) });
    const err = await verifyZernioAccount({ token: "sk_x", accountId: "nope", platform: "facebook" }).catch((e) => e);
    expect(err.code).toBe("account_not_found");
  });

  it("llave rechazada → invalid_key; Zernio caído → platform_unavailable", async () => {
    zernio({ "/accounts": json({ error: { message: "Invalid API key" } }, 401) });
    expect((await verifyZernioAccount({ token: "sk_x", accountId: ACCOUNT, platform: "instagram" }).catch((e) => e)).code).toBe("invalid_key");
    vi.unstubAllGlobals();
    zernio({ "/accounts": json({ error: "boom" }, 502) });
    expect((await verifyZernioAccount({ token: "sk_x", accountId: ACCOUNT, platform: "instagram" }).catch((e) => e)).code).toBe("platform_unavailable");
  });
});
