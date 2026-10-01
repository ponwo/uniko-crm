/**
 * 015 — Estado del mock de Google Calendar (solo entorno de pruebas).
 *
 * Imita la parte que más cuesta creer hasta que se ve: la conferencia de Meet
 * NO viene en la respuesta de crear el evento. Aquí el primer `GET` del evento
 * todavía la da como pendiente y el siguiente ya trae el enlace — así el
 * self-test ejercita el camino real, no uno cómodo.
 *
 * 029 — Y la autorización de la conexión por link: códigos de UN solo uso,
 * atados al `client_id` y al `redirect_uri` con los que se pidieron (como
 * Google), con una decisión determinista por código para los caminos
 * infelices.
 */

export type MockEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  /** Cuántas veces se ha leído: la conferencia "termina" tras la primera. */
  reads: number;
  meetLink: string | null;
  updates: number;
  /**
   * ¿Se pidió conferencia al crearlo? Sin `conferenceData.createRequest`
   * Google no crea Meet nunca — es la cita presencial, y el mock no debe
   * regalarle un enlace.
   */
  withConference: boolean;
  location: string | null;
};

/**
 * Lo que "hace" el titular en la pantalla de Google, elegido por el arnés con
 * `mock_decision` en la URL de autorización:
 * - `approve`: acepta — código que da refresh token y el permiso completo.
 * - `deny` / `policy`: vuelve con `error=access_denied` / `admin_policy_enforced`.
 * - `partial`: acepta sin el permiso de calendario.
 * - `no_refresh`: Google no devuelve refresh token.
 * - `exchange_down`: el canje responde 503.
 */
export type MockDecision =
  | "approve"
  | "deny"
  | "policy"
  | "partial"
  | "no_refresh"
  | "exchange_down";

export const MOCK_DECISIONS: readonly MockDecision[] = [
  "approve",
  "deny",
  "policy",
  "partial",
  "no_refresh",
  "exchange_down",
];

/**
 * 029 (permiso owned) — Un calendario al que la cuenta tiene acceso pero que NO
 * es suyo (uno compartido por otra cuenta). Con `calendar.events` se puede
 * escribir en él; con `calendar.events.owned` —el permiso de la conexión por
 * link— Google lo rechaza con 403.
 */
export const MOCK_FOREIGN_CALENDAR = "compartido@group.calendar.google.com";

export type MockAuthCode = {
  clientId: string;
  redirectUri: string;
  decision: MockDecision;
  used: boolean;
};

type MockState = {
  events: Map<string, MockEvent>;
  deleted: string[];
  nextId: number;
  /** Lecturas que tarda la conferencia en estar lista. */
  conferenceDelayReads: number;
  authCodes: Map<string, MockAuthCode>;
  nextCode: number;
  authorizations: number;
  exchanges: number;
  /** Lo último que pidió la instancia al autorizar, para comprobar sus parámetros. */
  lastAuthorization: Record<string, string> | null;
};

const globalForMock = globalThis as unknown as { __googleMock?: MockState };

export function googleMockState(): MockState {
  if (!globalForMock.__googleMock) {
    globalForMock.__googleMock = {
      events: new Map(),
      deleted: [],
      nextId: 1,
      conferenceDelayReads: 1,
      authCodes: new Map(),
      nextCode: 1,
      authorizations: 0,
      exchanges: 0,
      lastAuthorization: null,
    };
  }
  return globalForMock.__googleMock;
}

export function resetGoogleMock(): void {
  const s = googleMockState();
  s.events.clear();
  s.deleted.length = 0;
  s.nextId = 1;
  s.conferenceDelayReads = 1;
  s.authCodes.clear();
  s.nextCode = 1;
  s.authorizations = 0;
  s.exchanges = 0;
  s.lastAuthorization = null;
}

export function googleMockSnapshot() {
  const s = googleMockState();
  return {
    events: [...s.events.values()],
    deleted: [...s.deleted],
    authorizations: s.authorizations,
    exchanges: s.exchanges,
    lastAuthorization: s.lastAuthorization,
  };
}

/**
 * Camino infeliz determinista: un refresh token terminado en `-invalid` hace
 * que Google responda `invalid_grant` — exactamente lo que pasa cuando la app
 * OAuth sigue en modo prueba y caducó a los 7 días.
 */
export function mockRefreshTokenIsBad(body: string): boolean {
  return new URLSearchParams(body).get("refresh_token")?.endsWith("-invalid") ?? true;
}

/** 029 — Emite un código de autorización de un solo uso. */
export function issueMockAuthCode(input: {
  clientId: string;
  redirectUri: string;
  decision: MockDecision;
}): string {
  const s = googleMockState();
  const code = `mock-code-${s.nextCode++}`;
  s.authCodes.set(code, { ...input, used: false });
  return code;
}
