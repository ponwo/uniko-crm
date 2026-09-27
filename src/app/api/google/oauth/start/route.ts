import { NextResponse } from "next/server";
import {
  findGoogleLink,
  linkCheckFor,
} from "@/server/agenda/connectors/google-link";
import {
  NONCE_COOKIE,
  NONCE_COOKIE_PATH,
  STATE_TTL_SECONDS,
  buildGoogleAuthUrl,
  googleAgencyConfig,
  googleLinkAvailable,
  newNonce,
  resultUrl,
  signOAuthState,
} from "@/server/agenda/connectors/google-oauth";

export const dynamic = "force-dynamic";

/**
 * 029 — Donde aterriza el link (directo o desde la página de lanco.cloud).
 * PÚBLICA: el titular del calendario no tiene sesión en Uniko (FR-1411).
 *
 * Valida el link ANTES de mandar a nadie a Google (FR-1412), ata la ida y
 * vuelta a este navegador con una cookie (FR-1414) y redirige a la
 * autorización con un `state` firmado que lleva el origen de la instancia.
 */
export async function GET(req: Request): Promise<Response> {
  // Sin agenda o sin la app de agencia, esta ruta no existe (FR-1401).
  if (!googleLinkAvailable()) return new Response(null, { status: 404 });

  const cfg = googleAgencyConfig();
  const now = new Date();
  const token = new URL(req.url).searchParams.get("t") ?? "";

  try {
    const check = linkCheckFor(await findGoogleLink(token), now);
    if (!check.ok) return finish(NextResponse.redirect(resultUrl(cfg.origin, check.motivo), 302));

    const nonce = newNonce();
    const state = await signOAuthState(
      {
        organizationId: check.link.organizationId,
        linkId: check.link.id,
        nonce,
        now,
      },
      cfg
    );
    const res = NextResponse.redirect(buildGoogleAuthUrl(state, cfg), 302);
    res.cookies.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      // Lax: viaja en la navegación de nivel superior con la que el relevo de
      // lanco.cloud (o Google) devuelve al titular a esta instancia.
      sameSite: "lax",
      secure: cfg.origin.startsWith("https://"),
      path: NONCE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    return finish(res);
  } catch (err) {
    // Nunca un 500 frente al titular: se registra (sin la llave) y se le dice
    // que reintente.
    console.error(
      "[google-link] no se pudo iniciar la autorización:",
      err instanceof Error ? err.message.slice(0, 200) : "error desconocido"
    );
    return finish(NextResponse.redirect(resultUrl(cfg.origin, "google_no_respondio"), 302));
  }
}

function finish(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
