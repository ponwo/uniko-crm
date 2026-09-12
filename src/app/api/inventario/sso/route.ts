import { headers } from "next/headers";
import { withAuth } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { inventarioDisabledResponse, inventarioEnabled } from "@/server/inventario/flag";
import { issueSsoUrl } from "@/server/inventario/sso";

export const dynamic = "force-dynamic";

/**
 * 026 — A donde apunta el botón "Inventario" (FR-1105, FR-1106).
 *
 * Con sesión de Uniko emite un pase nuevo y manda al navegador al portal de
 * MS-Stock; sin sesión, 401 y ningún pase; con el conector apagado, la ruta
 * no existe. Los rechazos del pase (caducó, ya se usó, secretos distintos) los
 * muestra MS-Stock con su "Volver a Uniko": aquí no hay pantalla que hacer.
 *
 * El nombre sale de la sesión de Better Auth (no de la membresía): es lo que
 * el portal mostrará como "<nombre> desde Uniko".
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!inventarioEnabled()) return inventarioDisabledResponse();
  const auth = await getAuth().api.getSession({ headers: await headers() });
  const name = auth?.user.name?.trim() || auth?.user.email || "Uniko";
  const next = new URL(req.url).searchParams.get("next") ?? undefined;
  const url = await issueSsoUrl({ userId: session.userId, name, next });
  // Nunca se registra la URL: lleva el pase.
  return Response.redirect(url, 302);
});
