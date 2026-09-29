import { apiError, withAuth } from "@/lib/api";
import {
  googleLinkStatus,
  issueGoogleLink,
  revokeGoogleLinks,
} from "@/server/agenda/connectors/google-link";
import {
  buildGoogleLinkUrl,
  googleAgencyConfig,
  googleLinkAvailable,
} from "@/server/agenda/connectors/google-oauth";

export const dynamic = "force-dynamic";

/**
 * 029 — El link de conexión de Google (modelo agencia), del lado del operador.
 *
 * Sin agenda o sin la app de agencia configurada, esta superficie no existe
 * (404, FR-1401): la pantalla usa ese 404 para no mostrar la sección.
 *
 * Generar y revocar son del DUEÑO (FR-1405): el link es una llave que se
 * comparte fuera y deja a quien la tenga recibir las citas en su calendario.
 */

function notOwner(): Response {
  return apiError(403, "forbidden", "Solo el dueño de la cuenta puede generar o revocar el link");
}

export const GET = withAuth(async (session) => {
  if (!googleLinkAvailable()) return new Response(null, { status: 404 });
  const { pending, usedAt } = await googleLinkStatus(session.organizationId, new Date());
  return Response.json({
    canManage: session.role === "owner",
    // Nunca el link: solo que existe y cuándo vence (FR-1408).
    pending: pending
      ? {
          createdAt: pending.createdAt.toISOString(),
          expiresAt: pending.expiresAt.toISOString(),
        }
      : null,
    // Cuándo se usó el más reciente: con él quedó conectado Google (FR-1429).
    usedAt: usedAt?.toISOString() ?? null,
  });
});

export const POST = withAuth(async (session) => {
  if (!googleLinkAvailable()) return new Response(null, { status: 404 });
  if (session.role !== "owner") return notOwner();

  const { token, expiresAt } = await issueGoogleLink({
    organizationId: session.organizationId,
    userId: session.userId,
    now: new Date(),
  });
  // La ÚNICA vez que el link completo sale de la instancia.
  return Response.json(
    {
      url: buildGoogleLinkUrl(token, googleAgencyConfig()),
      expiresAt: expiresAt.toISOString(),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
});

export const DELETE = withAuth(async (session) => {
  if (!googleLinkAvailable()) return new Response(null, { status: 404 });
  if (session.role !== "owner") return notOwner();
  const revoked = await revokeGoogleLinks(session.organizationId, new Date());
  return Response.json({ ok: true, revoked });
});
