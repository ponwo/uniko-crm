import { mockGuard } from "@/lib/dev-guard";
import {
  nextZernioMessageId,
  resetZernioMock,
  ZERNIO_MOCK_ACCOUNTS,
  zernioMockState,
  zernioTokenIsBad,
  zernioTokenLacksInbox,
} from "@/server/dev/zernio-mock-state";

export const dynamic = "force-dynamic";

/**
 * 017 — Zernio de mentira para el self-test. Tras `mockGuard()`: 404
 * incondicional en producción, indistinguible de una ruta inexistente.
 *
 * Imita lo único que Uniko usa de esa API —listar cuentas y conversaciones
 * (que es como se valida la conexión) y responder en una— y expone `_sent` y
 * `_reset` para que el arnés pueda afirmar sobre lo que recibió.
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

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "_sent") {
    return Response.json({ sent: zernioMockState().sent });
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
  return Response.json({});
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;

  if (path.join("/") === "_reset") {
    resetZernioMock();
    return Response.json({ ok: true });
  }
  const auth = req.headers.get("authorization");
  if (zernioTokenIsBad(auth)) return unauthorized();
  if (zernioTokenLacksInbox(auth)) return inboxRequired();

  // POST /inbox/conversations/{id}/messages
  if (
    path.length === 4 &&
    path[0] === "inbox" &&
    path[1] === "conversations" &&
    path[3] === "messages"
  ) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = zernioMockState();
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
