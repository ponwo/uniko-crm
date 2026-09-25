import { mockGuard } from "@/lib/dev-guard";
import { aiMockSnapshot, resetAiMock } from "@/server/dev/ai-mock-state";

export const dynamic = "force-dynamic";

/**
 * 015 (ajuste 2026-09-23) — El estado del ai-mock: qué modelo pidió cada turno.
 *
 * Va en un catch-all y no en una carpeta `_state/` porque en el App Router una
 * carpeta que empieza con `_` es PRIVADA y no genera ruta — la primera versión
 * respondía 404 por eso. Los demás mocks (zoom, google, stock) ya resuelven su
 * `_state` así.
 *
 * Los turnos siguen atendiéndose en las rutas explícitas (`v1/chat/completions`
 * y `chat/completions`): un segmento estático gana al catch-all.
 */
type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (path.join("/") !== "_state") return new Response(null, { status: 404 });
  return Response.json(aiMockSnapshot());
}

export async function POST(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (path.join("/") !== "_state") return new Response(null, { status: 404 });
  resetAiMock();
  return Response.json({ ok: true });
}
