import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState, type MediaMode } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * 026 — Modo del mock para las imágenes por link (foto del producto):
 * `ok` (acepta), `reject` (400 como Meta ante un link inválido) o `slow`
 * (tarda más que el límite del motor). `DELETE /outbox` lo devuelve a `ok`.
 */
const MODES: MediaMode[] = ["ok", "reject", "slow"];
const bodySchema = z.object({ mode: z.enum(["ok", "reject", "slow"]) });

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ mode: getWaMockState().mediaMode, modes: MODES });
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  getWaMockState().mediaMode = body.data.mode;
  return Response.json({ ok: true, mode: body.data.mode });
}

export function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  getWaMockState().mediaMode = "ok";
  return Response.json({ ok: true, mode: "ok" });
}
