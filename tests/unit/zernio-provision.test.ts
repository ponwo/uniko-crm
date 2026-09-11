import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureUnikoWebhook,
  isUnikoAutomation,
  isUnikoCallbackUrl,
  resolveSharedSecret,
  unikoWebhookStatus,
  upsertCommentAutomation,
  webhookNeedsUpdate,
} from "@/server/zernio/provision";

// Las URLs de callback salen de la instancia; aquí se fijan.
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
  }),
}));

/**
 * 025 — Lo que Uniko da de alta en Zernio. Lo que se afirma aquí es lo que
 * se llevó la primera conexión real: que el webhook exista, que no se
 * duplique, y que los dos canales compartan secreto.
 */

const URLS = {
  instagram: "http://localhost:3000/api/webhooks/ig/placeholder-verify-token",
  messenger: "http://localhost:3000/api/webhooks/messenger/placeholder-verify-token",
};

type Call = { method: string; path: string; body: unknown };

describe("025 · reconocer lo nuestro en Zernio", () => {
  it("cualquiera de las dos URLs de callback es nuestra (un webhook sirve a los dos canales)", () => {
    expect(isUnikoCallbackUrl(URLS.instagram, URLS)).toBe(true);
    expect(isUnikoCallbackUrl(URLS.messenger + "/", URLS)).toBe(true);
    expect(isUnikoCallbackUrl("http://localhost:3000/api/webhooks/ig/otro-token", URLS)).toBe(false);
    expect(isUnikoCallbackUrl("https://otra-instancia.com/api/webhooks/ig/placeholder-verify-token", URLS)).toBe(false);
    expect(isUnikoCallbackUrl(undefined, URLS)).toBe(false);
  });

  it("un webhook ya registrado solo se toca si le falta algo", () => {
    const ok = { events: ["message.received", "comment.received"], secret: "s", isActive: true };
    expect(webhookNeedsUpdate(ok, "s")).toBe(false);
    expect(webhookNeedsUpdate({ ...ok, secret: "otro" }, "s")).toBe(true);
    expect(webhookNeedsUpdate({ ...ok, events: ["comment.received"] }, "s")).toBe(true);
    expect(webhookNeedsUpdate({ ...ok, isActive: false }, "s")).toBe(true);
  });

  it("la automatización es nuestra por cuenta y por nombre", () => {
    expect(isUnikoAutomation({ accountId: "a", name: "Uniko · comentario → DM (Instagram)" }, "a")).toBe(true);
    expect(isUnikoAutomation({ accountId: "b", name: "Uniko · comentario → DM (Instagram)" }, "a")).toBe(false);
    expect(isUnikoAutomation({ accountId: "a", name: "La del operador" }, "a")).toBe(false);
  });

  it("el secreto compartido: escrito > del otro canal > el propio > generado", () => {
    expect(resolveSharedSecret({ typed: "t", otherChannel: "o", thisChannel: "m" })).toEqual({ secret: "t", generated: false });
    expect(resolveSharedSecret({ typed: null, otherChannel: "o", thisChannel: "m" })).toEqual({ secret: "o", generated: false });
    expect(resolveSharedSecret({ typed: null, otherChannel: null, thisChannel: "m" })).toEqual({ secret: "m", generated: false });
    const gen = resolveSharedSecret({ typed: null, otherChannel: null, thisChannel: null });
    expect(gen.generated).toBe(true);
    expect(gen.secret).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe("025 · ensureUnikoWebhook contra la API (idempotente)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function zernio(hooks: unknown[]) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
        const method = init?.method ?? "GET";
        calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET" && path === "/webhooks/settings") {
          return new Response(JSON.stringify({ webhooks: hooks }), { status: 200 });
        }
        if (method === "POST" && path === "/webhooks/settings") {
          return new Response(JSON.stringify({ success: true, webhook: { _id: "nuevo" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      })
    );
    return calls;
  }

  it("sin webhook nuestro: lo crea con la URL del canal, el evento y el secreto", async () => {
    const calls = zernio([{ _id: "ajeno", url: "https://otro.com/hook", events: ["post.published"] }]);
    const r = await ensureUnikoWebhook({ token: "sk", channel: "instagram", secret: "s3cr3t" });
    expect(r).toMatchObject({ id: "nuevo", action: "created" });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      name: "Uniko",
      url: expect.stringMatching(/\/api\/webhooks\/ig\//),
      secret: "s3cr3t",
      events: ["message.received"],
      isActive: true,
    });
  });

  it("con uno apuntando a la OTRA URL nuestra: lo actualiza y conserva los eventos ajenos", async () => {
    const calls = zernio([{ _id: "h1", url: URLS.messenger, secret: "viejo", events: ["comment.received"], isActive: true }]);
    const r = await ensureUnikoWebhook({ token: "sk", channel: "instagram", secret: "nuevo" });
    expect(r).toMatchObject({ id: "h1", action: "updated" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ _id: "h1", secret: "nuevo", isActive: true });
    expect((put.body as { events: string[] }).events.sort()).toEqual(["comment.received", "message.received"]);
  });

  it("ya al día: no toca nada", async () => {
    const calls = zernio([{ _id: "h1", url: URLS.instagram, secret: "s", events: ["message.received"], isActive: true }]);
    const r = await ensureUnikoWebhook({ token: "sk", channel: "messenger", secret: "s" });
    expect(r.action).toBe("unchanged");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("el estado para la pantalla: registrado solo si existe, activo y con el evento", async () => {
    zernio([{ _id: "h1", url: URLS.instagram, events: ["message.received"], isActive: true }]);
    expect(await unikoWebhookStatus("sk")).toBe("registered");
    vi.unstubAllGlobals();
    zernio([{ _id: "h1", url: URLS.instagram, events: ["comment.received"], isActive: true }]);
    expect(await unikoWebhookStatus("sk")).toBe("missing");
    vi.unstubAllGlobals();
    zernio([]);
    expect(await unikoWebhookStatus("sk")).toBe("missing");
  });
});

describe("025 · upsertCommentAutomation (una por cuenta, apagar no borra)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function zernio(automations: unknown[]) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        if (path === "/comment-automations" && method === "GET") {
          return new Response(JSON.stringify({ automations }), { status: 200 });
        }
        if (path === "/accounts") {
          return new Response(
            JSON.stringify({ accounts: [{ _id: "acc", platform: "instagram", profileId: { _id: "prof" } }] }),
            { status: 200 }
          );
        }
        if (method === "POST") {
          return new Response(JSON.stringify({ automation: { id: "new", ...body } }), { status: 200 });
        }
        return new Response(JSON.stringify({ automation: body ?? {} }), { status: 200 });
      })
    );
    return calls;
  }

  it("sin automatización y encendida: la crea con el perfil de la cuenta y modo palabra", async () => {
    const calls = zernio([]);
    const r = await upsertCommentAutomation({
      token: "sk",
      channel: "instagram",
      accountId: "acc",
      automation: { enabled: true, keywords: ["info"], dmMessage: "Hola", commentReply: null },
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      profileId: "prof",
      accountId: "acc",
      trigger: "comment",
      matchMode: "word",
      typoTolerance: true,
      dmMessage: "Hola",
      commentReply: "",
      isActive: true,
      audience: { whenUnknown: "send" },
    });
    expect((post.body as { name: string }).name).toMatch(/^Uniko/);
    expect(r.enabled).toBe(true);
  });

  it("sin automatización y apagada: no crea nada", async () => {
    const calls = zernio([]);
    await upsertCommentAutomation({
      token: "sk",
      channel: "instagram",
      accountId: "acc",
      automation: { enabled: false, keywords: [], dmMessage: "Hola", commentReply: null },
    });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("con automatización: PATCH sobre la nuestra (apagar = isActive false), nunca POST", async () => {
    const calls = zernio([
      { id: "ajena", accountId: "acc", name: "Del operador", isActive: true },
      { id: "mia", accountId: "acc", name: "Uniko · comentario → DM (Instagram)", isActive: true, keywords: ["x"], dmMessage: "y" },
    ]);
    const r = await upsertCommentAutomation({
      token: "sk",
      channel: "instagram",
      accountId: "acc",
      automation: { enabled: false, keywords: ["info"], dmMessage: "Nuevo", commentReply: "Pub" },
    });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/comment-automations/mia");
    expect(patch.body).toMatchObject({ isActive: false, keywords: ["info"], dmMessage: "Nuevo", commentReply: "Pub" });
    expect(calls.some((c) => c.method === "POST" || c.method === "DELETE")).toBe(false);
    expect(r.enabled).toBe(false);
  });
});
