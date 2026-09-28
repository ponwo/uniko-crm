import { getEnv } from "@/lib/env";
import { mockGuard } from "@/lib/dev-guard";
import { relayTarget } from "@/server/dev/lanco-relay";

export const dynamic = "force-dynamic";

/**
 * 029 — El relevo de lanco.cloud de mentira, tras `mockGuard()` (404
 * incondicional en producción).
 *
 * Con `GOOGLE_OAUTH_REDIRECT_URI` apuntando aquí, el self-test recorre el mismo
 * camino que la flota: Google → relevo → instancia. La lista de la flota es el
 * host de la propia instancia. Responde 302 donde el sitio real hace
 * `location.replace` (el arnés no ejecuta JavaScript).
 *
 * `_state` / `_reset`: cuántas veces reenvió y cuántas se negó — el arnés lo
 * usa para comprobar que una cita NO pasa por aquí (SC-004).
 */

type Ctx = { params: Promise<{ path?: string[] }> };

type RelayState = { relays: number; refused: number };
const globalForRelay = globalThis as unknown as { __lancoRelayMock?: RelayState };

function relayState(): RelayState {
  if (!globalForRelay.__lancoRelayMock) {
    globalForRelay.__lancoRelayMock = { relays: 0, refused: 0 };
  }
  return globalForRelay.__lancoRelayMock;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = (path ?? []).join("/");

  if (route === "_state") return Response.json(relayState());
  if (route !== "") return new Response(null, { status: 404 });

  const decision = relayTarget(new URL(req.url).search, [
    new URL(getEnv().APP_BASE_URL).host,
  ]);
  const state = relayState();
  if (!decision.ok) {
    state.refused += 1;
    return Response.json({ error: "relevo_rechazado", reason: decision.reason }, { status: 400 });
  }
  state.relays += 1;
  return Response.redirect(decision.target, 302);
}

export async function POST(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if ((path ?? []).join("/") !== "_reset") return new Response(null, { status: 404 });
  globalForRelay.__lancoRelayMock = { relays: 0, refused: 0 };
  return Response.json({ ok: true });
}
