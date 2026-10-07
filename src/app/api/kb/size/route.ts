import { withAuth } from "@/lib/api";
import { renderKb } from "@/server/ai/prompts";
import { conocimientoVigente } from "@/server/kb/vigencia";

export const dynamic = "force-dynamic";

/**
 * Tamaño estimado del knowledge base (FR-020). v1 inyecta el KB completo al
 * prompt; umbral de aviso heurístico: ~24.000 caracteres (≈6k tokens).
 *
 * 033 (FR-1835) — Cuenta solo lo VIGENTE: el presupuesto es lo que se envía, y
 * una entrada vencida deja de enviarse en cuanto vence.
 */
const WARN_CHARS = 24_000;

export const GET = withAuth(async (session) => {
  const entries = await conocimientoVigente(session.organizationId);
  const chars = renderKb(entries).length;
  return Response.json({
    chars,
    warnAt: WARN_CHARS,
    warning: chars >= WARN_CHARS,
  });
});
