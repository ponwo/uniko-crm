import { mockGuard } from "@/lib/dev-guard";
import { GOOGLE_SCOPE } from "@/server/agenda/connectors/google";
import {
  MOCK_DECISIONS,
  MOCK_FOREIGN_CALENDAR,
  googleMockSnapshot,
  googleMockState,
  issueMockAuthCode,
  mockRefreshTokenIsBad,
  resetGoogleMock,
  type MockDecision,
} from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/**
 * 015 — Google de mentira para el self-test, tras `mockGuard()` (404
 * incondicional en producción).
 *
 * Cubre lo que el conector usa: refrescar el token, crear/leer/mover/borrar un
 * evento y leer el calendario. Y reproduce la asincronía de la conferencia:
 * al crear NO hay enlace de Meet, y aparece en una lectura posterior.
 *
 * 029 — Y la autorización de la conexión por link: `GET auth` hace de pantalla
 * de consentimiento (decide `mock_decision`) y `/token` canjea el código.
 *
 * Cada acceso lleva su permiso, como en Google: el de la conexión manual es
 * `calendar.events` (la guía) y el de la conexión por link,
 * `calendar.events.owned`, que no alcanza calendarios ajenos.
 */

type Ctx = { params: Promise<{ path: string[] }> };

/** Acceso con `calendar.events`: el de la conexión manual. */
const TOKEN = "google-token-de-mentira";
/**
 * Acceso con `calendar.events.owned`: el que sale del canje por link y de
 * renovar sus refresh tokens (`ref-oauth-*`).
 */
const TOKEN_OWNED = "google-token-owned-de-mentira";

function oauthError(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status });
}

/**
 * 029 — Canje de un código de autorización, con las reglas de Google: un solo
 * uso, y el `client_id` y el `redirect_uri` tienen que ser los de la
 * autorización.
 */
function exchangeCode(params: URLSearchParams): Response {
  const state = googleMockState();
  state.exchanges += 1;
  const code = params.get("code") ?? "";
  const issued = state.authCodes.get(code);
  if (!issued || issued.used) {
    return oauthError(400, "invalid_grant", "Bad Request");
  }
  issued.used = true;
  if (!params.get("client_secret") || params.get("client_id") !== issued.clientId) {
    return oauthError(401, "invalid_client", "Unauthorized");
  }
  if (params.get("redirect_uri") !== issued.redirectUri) {
    return oauthError(400, "redirect_uri_mismatch", "Bad Request");
  }
  if (issued.decision === "exchange_down") {
    return new Response("Service Unavailable", { status: 503 });
  }
  const n = code.replace("mock-code-", "");
  return Response.json({
    access_token: TOKEN_OWNED,
    expires_in: 3599,
    token_type: "Bearer",
    scope: issued.decision === "partial" ? "openid" : GOOGLE_SCOPE,
    // Termina distinto de `-invalid`: el refresco posterior lo acepta.
    ...(issued.decision === "no_refresh" ? {} : { refresh_token: `ref-oauth-${n}` }),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "token") {
    const body = await req.text();
    const params = new URLSearchParams(body);
    if (params.get("grant_type") === "authorization_code") {
      return exchangeCode(params);
    }
    if (mockRefreshTokenIsBad(body)) {
      return Response.json(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        { status: 400 }
      );
    }
    // El refresh token conserva el permiso con el que se concedió.
    const deLink = params.get("refresh_token")?.startsWith("ref-oauth-") ?? false;
    return Response.json({ access_token: deLink ? TOKEN_OWNED : TOKEN, expires_in: 3600 });
  }

  if (route === "_reset") {
    resetGoogleMock();
    return Response.json({ ok: true });
  }

  // POST /calendars/{id}/events
  if (path[0] === "calendars" && path[2] === "events" && path.length === 3) {
    const unauthorized = requireToken(req);
    if (unauthorized) return unauthorized;
    const ajeno = foreignCalendar(req, path);
    if (ajeno) return ajeno;

    const body = (await req.json().catch(() => ({}))) as {
      summary?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
    };
    const state = googleMockState();
    const id = `evt_${state.nextId++}`;
    state.events.set(id, {
      id,
      summary: body.summary ?? "",
      start: body.start?.dateTime ?? "",
      end: body.end?.dateTime ?? "",
      reads: 0,
      meetLink: null,
      updates: 0,
    });
    // Sin enlace todavía: la conferencia se está creando. Es el
    // comportamiento real de Google y por eso el conector re-lee.
    return Response.json({
      id,
      summary: body.summary,
      conferenceData: { createRequest: { status: { statusCode: "pending" } } },
    });
  }

  return new Response(null, { status: 404 });
}

/**
 * 029 — La "pantalla de consentimiento". Valida lo que Google exige y responde
 * al `redirect_uri` como Google: con `code` o con `error`, siempre con el
 * `state` intacto.
 */
function authorize(req: Request): Response {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const state = params.state;
  if (!clientId || !redirectUri || !state || params.response_type !== "code" || !params.scope) {
    return oauthError(400, "invalid_request", "Faltan parámetros de la autorización");
  }
  const mock = googleMockState();
  mock.authorizations += 1;
  mock.lastAuthorization = params;

  const raw = params.mock_decision ?? "approve";
  const decision: MockDecision = (MOCK_DECISIONS as readonly string[]).includes(raw)
    ? (raw as MockDecision)
    : "approve";

  const back = new URL(redirectUri);
  if (decision === "deny" || decision === "policy") {
    back.searchParams.set("error", decision === "deny" ? "access_denied" : "admin_policy_enforced");
  } else {
    back.searchParams.set("code", issueMockAuthCode({ clientId, redirectUri, decision }));
    back.searchParams.set("scope", decision === "partial" ? "openid" : GOOGLE_SCOPE);
  }
  back.searchParams.set("state", state);
  return Response.redirect(back.toString(), 302);
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;

  if (path.join("/") === "_state") return Response.json(googleMockSnapshot());
  if (path.join("/") === "auth") return authorize(req);

  const unauthorized = requireToken(req);
  if (unauthorized) return unauthorized;

  // GET /calendars/{id} — como Google con un permiso de eventos
  // (`calendar.events` o `.owned`): ninguno autoriza calendars.get (403). Fue
  // el fallo real de «Probar» el 2026-09-17; el mock lo reproduce para que no
  // vuelva.
  if (path[0] === "calendars" && path.length === 2) {
    return Response.json(
      {
        error: {
          code: 403,
          message: "Request had insufficient authentication scopes.",
          status: "PERMISSION_DENIED",
        },
      },
      { status: 403 }
    );
  }

  const ajeno = foreignCalendar(req, path);
  if (ajeno) return ajeno;

  // GET /calendars/{id}/events — la prueba de conexión (events.list, que sí
  // aceptan los dos permisos de eventos); `summary` es el título del calendario.
  if (path[0] === "calendars" && path[2] === "events" && path.length === 3) {
    return Response.json({
      kind: "calendar#events",
      summary: "Calendario de prueba",
      items: [],
    });
  }

  // GET /calendars/{id}/events/{eventId}
  const event = eventFrom(path);
  if (!event) return new Response(null, { status: 404 });

  const state = googleMockState();
  event.reads += 1;
  if (!event.meetLink && event.reads > state.conferenceDelayReads) {
    event.meetLink = `https://meet.google.mock/${event.id}`;
  }

  return Response.json({
    id: event.id,
    summary: event.summary,
    conferenceData: event.meetLink
      ? {
          createRequest: { status: { statusCode: "success" } },
          entryPoints: [{ entryPointType: "video", uri: event.meetLink }],
        }
      : { createRequest: { status: { statusCode: "pending" } } },
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const unauthorized = requireToken(req);
  if (unauthorized) return unauthorized;

  const { path } = await ctx.params;
  const ajeno = foreignCalendar(req, path);
  if (ajeno) return ajeno;
  const event = eventFrom(path);
  if (!event) return new Response(null, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };
  if (body.start?.dateTime) event.start = body.start.dateTime;
  if (body.end?.dateTime) event.end = body.end.dateTime;
  event.updates += 1;
  // El evento se movió: su enlace de Meet es el mismo.
  return Response.json({ id: event.id });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const unauthorized = requireToken(req);
  if (unauthorized) return unauthorized;

  const { path } = await ctx.params;
  const ajeno = foreignCalendar(req, path);
  if (ajeno) return ajeno;
  const event = eventFrom(path);
  if (!event) return new Response(null, { status: 404 });

  const state = googleMockState();
  state.events.delete(event.id);
  state.deleted.push(event.id);
  return new Response(null, { status: 204 });
}

function eventFrom(path: string[]) {
  if (path[0] !== "calendars" || path[2] !== "events" || !path[3]) return null;
  return googleMockState().events.get(path[3]) ?? null;
}

function requireToken(req: Request): Response | null {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${TOKEN}` || auth === `Bearer ${TOKEN_OWNED}`) return null;
  return Response.json(
    { error: { code: 401, message: "Invalid Credentials" } },
    { status: 401 }
  );
}

/**
 * 029 (permiso owned) — Con `calendar.events.owned`, los eventos de un
 * calendario que la cuenta no posee están fuera del permiso: 403, como Google.
 */
function foreignCalendar(req: Request, path: string[]): Response | null {
  if (req.headers.get("authorization") !== `Bearer ${TOKEN_OWNED}`) return null;
  if (path[0] !== "calendars" || !path[1]) return null;
  if (decodeURIComponent(path[1]) !== MOCK_FOREIGN_CALENDAR) return null;
  return Response.json(
    {
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
      },
    },
    { status: 403 }
  );
}
