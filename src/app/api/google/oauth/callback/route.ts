import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_COOKIE,
  CALENDAR_COOKIE_TTL_SECONDS,
  NONCE_COOKIE,
  NONCE_COOKIE_PATH,
  RESULT_PATH,
  completeGoogleOAuth,
  defaultCompleteDeps,
  googleAgencyConfig,
  googleLinkAvailable,
  resultUrl,
  type CompleteResult,
} from "@/server/agenda/connectors/google-oauth";

export const dynamic = "force-dynamic";

/**
 * 029 — La respuesta de Google, directa o reenviada por el relevo de
 * lanco.cloud. PÚBLICA, como el inicio.
 *
 * Siempre termina en la página de resultado con un motivo del catálogo
 * cerrado, y siempre borra la cookie del nonce. Toda la decisión vive en
 * `completeGoogleOAuth`; aquí solo se traduce a redirección y cookies.
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!googleLinkAvailable()) return new Response(null, { status: 404 });

  const cfg = googleAgencyConfig();
  const secure = cfg.origin.startsWith("https://");
  const cookieNonce = req.cookies.get(NONCE_COOKIE)?.value ?? null;

  let result: CompleteResult;
  try {
    result = await completeGoogleOAuth(
      new URL(req.url).searchParams,
      { cookieNonce, now: new Date() },
      defaultCompleteDeps()
    );
  } catch (err) {
    // Red de seguridad: nunca un 500 frente al titular, y nada guardado a
    // medias (lo que escribe es una transacción).
    console.error(
      "[google-link] el retorno de Google falló:",
      err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "error desconocido"
    );
    result = { motivo: "google_no_respondio" };
  }

  const res = NextResponse.redirect(resultUrl(cfg.origin, result.motivo), 302);
  res.cookies.set(NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: NONCE_COOKIE_PATH,
    maxAge: 0,
  });
  if (result.motivo === "ok" && result.calendario) {
    // El nombre del calendario NO va en la dirección (FR-1421): una cookie de
    // un solo propósito, solo para la página de resultado y por dos minutos.
    res.cookies.set(CALENDAR_COOKIE, result.calendario.slice(0, 200), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: RESULT_PATH,
      maxAge: CALENDAR_COOKIE_TTL_SECONDS,
    });
  }
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
