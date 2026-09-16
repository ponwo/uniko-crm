import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState, type MediaMode } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * 026 — Modo del mock para las imágenes por link (foto del producto):
 * `ok` (acepta), `reject` (400 como Meta ante un link inválido) o `slow`
 * (tarda más que el límite del motor). `DELETE /outbox` lo devuelve a `ok`.
 *
 * 028 — `link` opcional: el modo aplica solo a las imágenes cuyo `image.link`
 * contenga esa subcadena; sin `link`, a todas (como antes). `DELETE` borra ambos.
 */
const MODES: MediaMode[] = ["ok", "reject", "slow"];
const bodySchema = z.object({
  mode: z.enum(["ok", "reject", "slow"]),
  link: z.string().min(1).max(200).optional(),
});

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const state = getWaMockState();
  return Response.json({ mode: state.mediaMode, link: state.mediaLink ?? null, modes: MODES });
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const state = getWaMockState();
  state.mediaMode = body.data.mode;
  state.mediaLink = body.data.link;
  return Response.json({ ok: true, mode: body.data.mode, link: body.data.link ?? null });
}

export function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  const state = getWaMockState();
  state.mediaMode = "ok";
  delete state.mediaLink;
  return Response.json({ ok: true, mode: "ok", link: null });
}
