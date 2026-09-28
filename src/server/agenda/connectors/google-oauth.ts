import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";
import type { Motivo } from "@/lib/google-link-motivos";
import { agendaEnabled } from "@/server/agenda/flag";
import { upsertSettings } from "@/server/agenda/settings";
import {
  GOOGLE_SCOPE,
  exchangeAuthorizationCode,
  googleConnector,
  grantCoversCalendar,
} from "@/server/agenda/connectors/google";
import {
  getGoogleCalendarId,
  type GoogleCreds,
  type GoogleCredentialsInput,
} from "@/server/agenda/connectors/google-credentials";
import {
  consumeLinkAndSaveCredentials,
  getGoogleLink,
  linkState,
  type ConsumeResult,
  type LinkRow,
} from "@/server/agenda/connectors/google-link";
import {
  ConnectorError,
  type TestConnectionResult,
} from "@/server/agenda/connectors/types";

/**
 * 029 — Conexión de Google por link, el flujo OAuth (modelo agencia, ADR-004).
 *
 * El recorrido del titular, que no tiene sesión en Uniko:
 *
 *   link ─▶ (lanco.cloud: aterrizaje) ─▶ START ─▶ Google ─▶ (lanco.cloud:
 *   relevo) ─▶ CALLBACK ─▶ /conectar-google
 *
 * START valida el link, ata el flujo a ESTE navegador con una cookie y manda a
 * Google un `state` firmado que lleva el origen de la instancia — el relevo de
 * lanco.cloud lo lee sin clave para saber a dónde reenviar. CALLBACK canjea el
 * `code` con el cliente OAuth de ESTA instancia (nadie más tiene su secreto),
 * comprueba permiso y refresh token, prueba la conexión y solo entonces, en
 * una transacción, consume el link y guarda. lanco.cloud no guarda nada y no
 * vuelve a participar: la instancia conectada habla con Google directo.
 */

export const START_PATH = "/api/google/oauth/start";
export const CALLBACK_PATH = "/api/google/oauth/callback";
export const RESULT_PATH = "/conectar-google";

/** Cookie que ata la ida y vuelta al navegador que la empezó (FR-1414). */
export const NONCE_COOKIE = "uniko_google_oauth";
export const NONCE_COOKIE_PATH = "/api/google/oauth";
/** Cookie de un solo propósito: el nombre del calendario para la página de resultado (FR-1421). */
export const CALENDAR_COOKIE = "uniko_google_conectado";

export const STATE_TTL_SECONDS = 15 * 60;
export const CALENDAR_COOKIE_TTL_SECONDS = 120;

/**
 * ¿Existe la conexión por link en esta instancia? Agenda encendida Y las tres
 * `GOOGLE_OAUTH_*`. Se lee de `process.env` directo, como `agendaEnabled()`:
 * preguntar si una feature existe no puede depender de que todo el entorno
 * valide. La configuración completa se valida al usarla (`getEnv()`).
 */
export function googleLinkAvailable(): boolean {
  if (!agendaEnabled()) return false;
  const has = (key: string) => (process.env[key] ?? "").trim().length > 0;
  return (
    has("GOOGLE_OAUTH_CLIENT_ID") &&
    has("GOOGLE_OAUTH_CLIENT_SECRET") &&
    has("GOOGLE_OAUTH_REDIRECT_URI")
  );
}

export type GoogleAgencyConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  onboardingUrl: string | null;
  /** Origen de la instancia (sin ruta): es el `ret` del `state`. */
  origin: string;
  /** Para firmar el `state`; se deriva una clave propia con HKDF. */
  authSecret: string;
};

export function googleAgencyConfig(): GoogleAgencyConfig {
  const env = getEnv();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    // Con la agenda encendida, env.ts ya exigió las tres; esto es solo el tipo.
    throw new Error("La app de Google de la agencia no está configurada");
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    authUrl: env.GOOGLE_AUTH_URL,
    onboardingUrl: env.GOOGLE_ONBOARDING_URL ?? null,
    origin: new URL(env.APP_BASE_URL).origin,
    authSecret: env.BETTER_AUTH_SECRET,
  };
}

/**
 * El link que se comparte (contracts/relevo-lanco-cloud.md §1). Con página de
 * aterrizaje: `{onboarding}?i={host}&t={llave}`; sin ella, directo a START.
 */
export function buildGoogleLinkUrl(
  token: string,
  cfg: Pick<GoogleAgencyConfig, "onboardingUrl" | "origin">
): string {
  if (cfg.onboardingUrl) {
    const url = new URL(cfg.onboardingUrl);
    url.searchParams.set("i", new URL(cfg.origin).host);
    url.searchParams.set("t", token);
    return url.toString();
  }
  const url = new URL(START_PATH, cfg.origin);
  url.searchParams.set("t", token);
  return url.toString();
}

/**
 * A dónde termina el titular. Se construye sobre el origen configurado
 * (`APP_BASE_URL`), no sobre la petición: detrás del proxy, el host que ve el
 * contenedor puede ser el interno. Solo viaja la clave del motivo (FR-1421).
 */
export function resultUrl(origin: string, motivo: Motivo): string {
  const url = new URL(RESULT_PATH, origin);
  url.searchParams.set("estado", motivo);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* El `state`                                                          */
/* ------------------------------------------------------------------ */

/** Clave propia para el `state`, separada por HKDF del uso de Better Auth. */
function stateKey(authSecret: string): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", authSecret, "uniko/029", "google-oauth-state", 32)
  );
}

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function nonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/**
 * JWT HS256. `ret` es el ÚNICO campo que el relevo de lanco.cloud puede leer y
 * usar (contrato §3); el resto es de la instancia. Firmarlo es lo que impide
 * cambiar `ret` o `lnk` por el camino.
 */
export async function signOAuthState(
  input: { organizationId: string; linkId: string; nonce: string; now: Date },
  cfg: Pick<GoogleAgencyConfig, "origin" | "authSecret">
): Promise<string> {
  const iat = Math.floor(input.now.getTime() / 1000);
  return new SignJWT({
    ret: cfg.origin,
    lnk: input.linkId,
    nh: nonceHash(input.nonce),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.organizationId)
    .setAudience(cfg.origin)
    .setIssuedAt(iat)
    .setExpirationTime(iat + STATE_TTL_SECONDS)
    .sign(stateKey(cfg.authSecret));
}

export type OAuthState = {
  organizationId: string;
  linkId: string;
  nonceHash: string;
};

export type StateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "vencido" | "invalido" };

export async function verifyOAuthState(
  jwt: string,
  now: Date,
  cfg: Pick<GoogleAgencyConfig, "origin" | "authSecret">
): Promise<StateCheck> {
  try {
    const { payload } = await jwtVerify(jwt, stateKey(cfg.authSecret), {
      algorithms: ["HS256"],
      audience: cfg.origin,
      currentDate: now,
    });
    const { sub, lnk, nh, ret } = payload as Record<string, unknown>;
    if (
      typeof sub !== "string" ||
      typeof lnk !== "string" ||
      typeof nh !== "string" ||
      ret !== cfg.origin
    ) {
      return { ok: false, reason: "invalido" };
    }
    return { ok: true, state: { organizationId: sub, linkId: lnk, nonceHash: nh } };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "vencido" };
    return { ok: false, reason: "invalido" };
  }
}

/** La autorización de Google (research D6): un permiso, de larga duración. */
export function buildGoogleAuthUrl(
  state: string,
  cfg: Pick<GoogleAgencyConfig, "authUrl" | "clientId" | "redirectUri">
): string {
  const url = new URL(cfg.authUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  // Sin `offline` no hay refresh token; sin `consent`, quien ya había
  // autorizado antes (al reconectar) no lo recibe otra vez.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Completar el flujo                                                  */
/* ------------------------------------------------------------------ */

export type CompleteDeps = {
  config: Pick<GoogleAgencyConfig, "clientId" | "clientSecret">;
  verifyState(jwt: string, now: Date): Promise<StateCheck>;
  getLink(organizationId: string, linkId: string): Promise<LinkRow | null>;
  currentCalendarId(organizationId: string): Promise<string | null>;
  exchange(
    code: string,
    calendarId: string
  ): Promise<{ refreshToken: string | null; scope: string }>;
  testConnection(creds: GoogleCreds): Promise<TestConnectionResult>;
  consumeAndSave(input: {
    organizationId: string;
    linkId: string;
    creds: GoogleCredentialsInput;
    now: Date;
  }): Promise<ConsumeResult>;
  useGoogleConnector(organizationId: string): Promise<void>;
  log(message: string): void;
};

export type CompleteResult = { motivo: Motivo; calendario?: string };

/**
 * El orden importa (research D7): todo lo que puede fallar por culpa de
 * Google o del titular pasa ANTES de tocar la base, y lo que toca la base es
 * una sola transacción. En ningún motivo distinto de `ok` se escribe nada.
 */
export async function completeGoogleOAuth(
  query: URLSearchParams,
  ctx: { cookieNonce: string | null; now: Date },
  deps: CompleteDeps
): Promise<CompleteResult> {
  const rawState = query.get("state");
  if (!rawState) return { motivo: "link_invalido" };

  const checked = await deps.verifyState(rawState, ctx.now);
  if (!checked.ok) {
    return { motivo: checked.reason === "vencido" ? "otro_navegador" : "link_invalido" };
  }
  const { organizationId, linkId } = checked.state;

  // Atado al navegador: sin la cookie, o con la de otro flujo, no se sigue.
  if (!ctx.cookieNonce || nonceHash(ctx.cookieNonce) !== checked.state.nonceHash) {
    return { motivo: "otro_navegador" };
  }

  const googleError = query.get("error");
  if (googleError) {
    if (googleError === "access_denied") return { motivo: "cancelado" };
    if (googleError === "admin_policy_enforced") return { motivo: "politica_empresa" };
    deps.log(`Google devolvió error=${googleError.slice(0, 60)}`);
    return { motivo: "google_rechazo" };
  }

  // El `state` prueba que el link era válido hace menos de 15 minutos: aquí
  // solo importa si alguien lo usó o lo revocó mientras tanto.
  const link = await deps.getLink(organizationId, linkId);
  if (!link) return { motivo: "link_invalido" };
  const state = linkState(link, ctx.now);
  if (state === "usado") return { motivo: "link_usado" };
  if (state === "revocado") return { motivo: "link_invalido" };

  const code = query.get("code");
  if (!code) return { motivo: "google_rechazo" };

  const calendarId = (await deps.currentCalendarId(organizationId)) ?? "primary";

  let exchanged: { refreshToken: string | null; scope: string };
  try {
    exchanged = await deps.exchange(code, calendarId);
  } catch (err) {
    const status = err instanceof ConnectorError ? err.status : null;
    deps.log(
      `el canje del código falló (${status ?? "sin respuesta"}): ${
        err instanceof Error ? err.message.slice(0, 200) : "error desconocido"
      }`
    );
    // 401 = el cliente OAuth de la instancia está mal configurado: lo arregla
    // el operador, no reintentando.
    return { motivo: status === 401 ? "prueba_fallida" : "google_no_respondio" };
  }

  if (!grantCoversCalendar(exchanged.scope)) {
    return { motivo: "permiso_incompleto" };
  }
  if (!exchanged.refreshToken) {
    // Sin permiso de larga duración la conexión moriría en una hora.
    deps.log("Google no devolvió refresh token");
    return { motivo: "prueba_fallida" };
  }

  const creds: GoogleCredentialsInput = {
    clientId: deps.config.clientId,
    clientSecret: deps.config.clientSecret,
    refreshToken: exchanged.refreshToken,
    calendarId,
  };
  const test = await deps.testConnection({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    calendarId,
    status: "connected",
  });
  if (!test.ok) {
    // El permiso de la app solo alcanza los calendarios PROPIOS de quien
    // autoriza: un destino conservado de otra cuenta falla aquí, y el operador
    // tiene que poder leerlo en el log (sin el id, que suele ser un correo).
    const destino =
      calendarId === "primary"
        ? ""
        : " (el calendario destino no es `primary`: el permiso solo alcanza los calendarios propios de la cuenta que autoriza)";
    deps.log(`la prueba de conexión falló: ${test.error.slice(0, 200)}${destino}`);
    return { motivo: "prueba_fallida" };
  }

  const consumed = await deps.consumeAndSave({
    organizationId,
    linkId,
    creds,
    now: ctx.now,
  });
  if (consumed !== "ok") return { motivo: consumed };

  // Conectar por link es conectar Google PARA las citas (FR-1418): una
  // conexión con la agenda en "enlace fijo" fue la trampa del 2026-09-23. Va
  // después de la transacción porque reutiliza las validaciones de
  // upsertSettings; si fallara, la conexión ya es buena y el operador lo ve.
  try {
    await deps.useGoogleConnector(organizationId);
  } catch (err) {
    deps.log(
      `conectado, pero no se pudo cambiar el conector a google: ${
        err instanceof Error ? err.message : err
      }`
    );
  }

  return { motivo: "ok", calendario: test.detail };
}

/** Las dependencias de verdad, para las rutas. */
export function defaultCompleteDeps(): CompleteDeps {
  const cfg = googleAgencyConfig();
  return {
    config: cfg,
    verifyState: (jwt, now) => verifyOAuthState(jwt, now, cfg),
    getLink: getGoogleLink,
    currentCalendarId: getGoogleCalendarId,
    exchange: (code, calendarId) =>
      exchangeAuthorizationCode({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri,
        code,
        calendarId,
      }),
    testConnection: (creds) => googleConnector.testConnection(creds),
    consumeAndSave: consumeLinkAndSaveCredentials,
    useGoogleConnector: async (organizationId) => {
      await upsertSettings(organizationId, { connector: "google" });
    },
    log: (message) => console.warn(`[google-link] ${message}`),
  };
}
