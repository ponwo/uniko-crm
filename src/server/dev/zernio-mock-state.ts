/**
 * 017 — Estado en memoria del mock de Zernio (solo dev/test). Vive en
 * globalThis porque Next recarga módulos en dev; una instancia = un proceso,
 * así que el outbox en memoria alcanza para las aserciones del self-test.
 */

export type ZernioSentMessage = {
  n: number;
  conversationId: string;
  accountId: string | null;
  message: string;
  /** Presente solo fuera de la ventana de 24 h. */
  messagingType?: string;
  messageTag?: string;
  /** Llave de idempotencia con la que llegó, si la hubo. */
  idempotencyKey: string | null;
  at: string;
};

/** 025: lo que Uniko da de alta en Zernio, para que el arnés lo afirme. */
export type ZernioMockWebhook = {
  _id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
};

export type ZernioMockAutomation = {
  id: string;
  name: string;
  profileId: string;
  accountId: string;
  platform: string;
  trigger: string;
  keywords: string[];
  matchMode: string;
  typoTolerance: boolean;
  dmMessage: string;
  commentReply: string;
  isActive: boolean;
  stats: { triggered: number; dmsSent: number; dmsFailed: number };
};

type ZernioMockState = {
  seq: number;
  sent: ZernioSentMessage[];
  webhooks: ZernioMockWebhook[];
  automations: ZernioMockAutomation[];
};

const g = globalThis as unknown as { __unikoZernioMock?: ZernioMockState };

export function zernioMockState(): ZernioMockState {
  if (!g.__unikoZernioMock) {
    g.__unikoZernioMock = { seq: 0, sent: [], webhooks: [], automations: [] };
  }
  // Instancias creadas antes de la 025 (hot reload en dev) no traen las listas.
  g.__unikoZernioMock.webhooks ??= [];
  g.__unikoZernioMock.automations ??= [];
  return g.__unikoZernioMock;
}

/**
 * Vacía lo enviado y lo dado de alta. El contador NO se reinicia: ver
 * `nextZernioMessageId`.
 */
export function resetZernioMock(): void {
  const state = zernioMockState();
  state.sent = [];
  state.webhooks = [];
  state.automations = [];
}

/** Un ObjectId de mentira con la forma que Zernio valida (24 hex). */
export function nextZernioObjectId(): string {
  const state = zernioMockState();
  return (Date.now().toString(16) + (++state.seq).toString(16).padStart(6, "0") + "0".repeat(24)).slice(0, 24);
}

/**
 * Id del mensaje que el mock le devuelve al CRM.
 *
 * Lleva la marca de tiempo del proceso, no solo un contador: el CRM guarda ese
 * id con un índice ÚNICO, así que dos corridas del arnés contra la misma base
 * chocarían con `zmock_1` y el envío fallaría por una colisión del harness,
 * que se ve igual que un bug del producto.
 */
export function nextZernioMessageId(): string {
  const state = zernioMockState();
  return `zmock_${Date.now().toString(36)}_${++state.seq}`;
}

/**
 * Una llave que termina en `-invalid` se rechaza, igual que hace el mock de
 * Graph: es como el arnés comprueba que unas credenciales malas NO se guardan.
 */
export function zernioTokenIsBad(authorization: string | null): boolean {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return token.length === 0 || token.endsWith("-invalid");
}

/**
 * Una llave que termina en `-sin-inbox` es válida pero su plan no tiene el
 * Inbox contratado: `/accounts` responde, `/inbox/*` da el 403 real de
 * Zernio. Es la forma de fallo que se llevó la primera conexión de verdad.
 */
export function zernioTokenLacksInbox(authorization: string | null): boolean {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return token.endsWith("-sin-inbox");
}

/** El perfil de Zernio al que pertenecen las cuentas del arnés. */
export const ZERNIO_MOCK_PROFILE = { _id: "zernio-profile-001", name: "Negocio Demo" } as const;

/** Las cuentas que el arnés espera encontrar en la llave, por plataforma. */
export const ZERNIO_MOCK_ACCOUNTS = [
  {
    _id: "zernio-ig-account-001",
    platform: "instagram",
    username: "negocio_demo",
    displayName: "Negocio Demo",
    isActive: true,
    profileId: ZERNIO_MOCK_PROFILE,
  },
  {
    _id: "zernio-account-001",
    platform: "facebook",
    username: null,
    displayName: "Página Demo",
    isActive: true,
    profileId: ZERNIO_MOCK_PROFILE,
  },
] as const;
