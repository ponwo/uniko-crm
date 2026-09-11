import { mockGuard } from "@/lib/dev-guard";
import {
  nextZernioMessageId,
  nextZernioObjectId,
  resetZernioMock,
  ZERNIO_MOCK_ACCOUNTS,
  zernioMockState,
  zernioTokenIsBad,
  zernioTokenLacksInbox,
  type ZernioMockAutomation,
  type ZernioMockWebhook,
} from "@/server/dev/zernio-mock-state";

export const dynamic = "force-dynamic";

/**
 * 017/025 — Zernio de mentira para el self-test. Tras `mockGuard()`: 404
 * incondicional en producción, indistinguible de una ruta inexistente.
 *
 * Imita lo que Uniko usa de esa API —listar cuentas y conversaciones (que es
 * como se valida la conexión), responder en una, y dar de alta webhooks y
 * automatizaciones comentario→DM— y expone `_sent`, `_state` y `_reset` para
 * que el arnés pueda afirmar sobre lo que recibió.
 */

type Ctx = { params: Promise<{ path: string[] }> };

function unauthorized(): Response {
  return Response.json(
    { error: { message: "Invalid API key" } },
    { status: 401 }
  );
}

/** La respuesta literal de Zernio cuando el plan no incluye el Inbox. */
function inboxRequired(): Response {
  return Response.json(
    {
      error: "Inbox addon required. Upgrade to access inbox features.",
      code: "INBOX_REQUIRED",
      trialAvailable: false,
    },
    { status: 403 }
  );
}

function badRequest(message: string): Response {
  return Response.json({ error: message, code: "bad_request" }, { status: 400 });
}

async function json(req: Request): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");
  const state = zernioMockState();

  if (route === "_sent") return Response.json({ sent: state.sent });
  if (route === "_state") {
    return Response.json({ webhooks: state.webhooks, automations: state.automations });
  }

  const auth = req.headers.get("authorization");
  if (zernioTokenIsBad(auth)) return unauthorized();

  // GET /accounts → con qué cuentas puede hablar esta llave.
  if (route === "accounts") {
    return Response.json({ accounts: ZERNIO_MOCK_ACCOUNTS });
  }
  // GET /inbox/conversations → la prueba de que el Inbox está contratado.
  if (route === "inbox/conversations") {
    if (zernioTokenLacksInbox(auth)) return inboxRequired();
    return Response.json({ data: [], hasMore: false });
  }
  if (route === "webhooks/settings") {
    return Response.json({ webhooks: state.webhooks });
  }
  if (route === "comment-automations") {
    return Response.json({ success: true, automations: state.automations });
  }
  if (path[0] === "comment-automations" && path.length === 2) {
    const a = state.automations.find((x) => x.id === path[1]);
    return a
      ? Response.json({ success: true, automation: a, logs: [] })
      : Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({});
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");
  const state = zernioMockState();

  if (route === "_reset") {
    resetZernioMock();
    return Response.json({ ok: true });
  }
  const auth = req.headers.get("authorization");
  if (zernioTokenIsBad(auth)) return unauthorized();

  // POST /webhooks/settings → alta de un webhook (la forma real de Zernio).
  if (route === "webhooks/settings") {
    const body = await json(req);
    if (!body.url || !body.name || !Array.isArray(body.events)) {
      return badRequest("name, url and events are required");
    }
    const hook: ZernioMockWebhook = {
      _id: nextZernioObjectId(),
      name: String(body.name),
      url: String(body.url),
      secret: String(body.secret ?? ""),
      events: (body.events as unknown[]).map(String),
      isActive: body.isActive !== false,
      failureCount: 0,
    };
    state.webhooks.push(hook);
    return Response.json({ success: true, webhook: hook });
  }

  // POST /comment-automations → alta de una automatización comentario→DM.
  if (route === "comment-automations") {
    const body = await json(req);
    if (!body.profileId || !body.accountId || !body.name || !body.dmMessage) {
      return badRequest("profileId, accountId, name and dmMessage are required");
    }
    const account = ZERNIO_MOCK_ACCOUNTS.find((a) => a._id === body.accountId);
    if (!account) return badRequest("unknown accountId");
    const automation: ZernioMockAutomation = {
      id: nextZernioObjectId(),
      name: String(body.name),
      profileId: String(body.profileId),
      accountId: String(body.accountId),
      platform: account.platform,
      trigger: String(body.trigger ?? "comment"),
      keywords: Array.isArray(body.keywords) ? (body.keywords as unknown[]).map(String) : [],
      matchMode: String(body.matchMode ?? "contains"),
      typoTolerance: body.typoTolerance === true,
      dmMessage: String(body.dmMessage),
      commentReply: String(body.commentReply ?? ""),
      isActive: body.isActive !== false,
      stats: { triggered: 0, dmsSent: 0, dmsFailed: 0 },
    };
    state.automations.push(automation);
    return Response.json({ success: true, automation });
  }

  if (zernioTokenLacksInbox(auth)) return inboxRequired();

  // POST /inbox/conversations/{id}/messages
  if (
    path.length === 4 &&
    path[0] === "inbox" &&
    path[1] === "conversations" &&
    path[3] === "messages"
  ) {
    const body = await json(req);
    const id = nextZernioMessageId();
    state.sent.push({
      n: state.seq,
      conversationId: decodeURIComponent(path[2]!),
      accountId: body.accountId ? String(body.accountId) : null,
      message: String(body.message ?? ""),
      ...(body.messagingType ? { messagingType: String(body.messagingType) } : {}),
      ...(body.messageTag ? { messageTag: String(body.messageTag) } : {}),
      idempotencyKey: req.headers.get("idempotency-key"),
      at: new Date().toISOString(),
    });
    // La forma real de la API: `{ data: { messageId, conversationId } }`.
    return Response.json({
      data: { messageId: id, conversationId: decodeURIComponent(path[2]!) },
    });
  }

  return Response.json({});
}

/** PUT /webhooks/settings con `_id` → actualiza ese webhook. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  if (path.join("/") === "webhooks/settings") {
    const body = await json(req);
    const hook = zernioMockState().webhooks.find((h) => h._id === body._id);
    if (!hook) return Response.json({ error: "not found" }, { status: 404 });
    if (body.url !== undefined) hook.url = String(body.url);
    if (body.name !== undefined) hook.name = String(body.name);
    if (body.secret !== undefined) hook.secret = String(body.secret);
    if (Array.isArray(body.events)) hook.events = (body.events as unknown[]).map(String);
    if (body.isActive !== undefined) hook.isActive = body.isActive !== false;
    return Response.json({ success: true, webhook: hook });
  }
  return Response.json({});
}

/** PATCH /comment-automations/{id} → actualiza esa automatización. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  if (path[0] === "comment-automations" && path.length === 2) {
    const a = zernioMockState().automations.find((x) => x.id === path[1]);
    if (!a) return Response.json({ error: "not found" }, { status: 404 });
    const body = await json(req);
    if (Array.isArray(body.keywords)) a.keywords = (body.keywords as unknown[]).map(String);
    if (body.matchMode !== undefined) a.matchMode = String(body.matchMode);
    if (body.typoTolerance !== undefined) a.typoTolerance = body.typoTolerance === true;
    if (body.dmMessage !== undefined) a.dmMessage = String(body.dmMessage);
    if (body.commentReply !== undefined) a.commentReply = String(body.commentReply);
    if (body.isActive !== undefined) a.isActive = body.isActive !== false;
    if (body.name !== undefined) a.name = String(body.name);
    return Response.json({ success: true, automation: a });
  }
  return Response.json({});
}

/** DELETE /webhooks/settings?id= y DELETE /comment-automations/{id}. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();
  const state = zernioMockState();

  if (path.join("/") === "webhooks/settings") {
    const id = new URL(req.url).searchParams.get("id");
    state.webhooks = state.webhooks.filter((h) => h._id !== id);
    return Response.json({ success: true });
  }
  if (path[0] === "comment-automations" && path.length === 2) {
    state.automations = state.automations.filter((a) => a.id !== path[1]);
    return Response.json({ success: true });
  }
  return Response.json({});
}
