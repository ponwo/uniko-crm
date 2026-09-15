/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: number;
  phoneNumberId: string;
  to: string;
  type: string;
  body: unknown;
  at: string;
  /**
   * Id que se le devolvió al CRM. Lo expone el outbox para que un self-test
   * pueda mandarle un webhook de estado a ESE mensaje sin adivinar el formato.
   */
  waMessageId?: string;
};

export type MockTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  /**
   * Estado tal como lo devuelve Meta. Texto libre, NO una unión cerrada
   * (027): Meta responde también PAUSED, DISABLED, LIMIT_EXCEEDED, DELETED,
   * ARCHIVED e IN_REVIEW, y puede añadir otros sin avisar. Un mock más
   * estricto que la API real es una prueba que no puede fallar — y el agujero
   * existió precisamente porque nada podía producir esos estados.
   */
  status: string;
  body: string;
  /** Motivo con el que se simuló el rechazo (Meta: `rejected_reason`). */
  rejectedReason?: string;
  /** Componentes tal cual los mandó el CRM: Meta valida aquí los `example`. */
  components?: unknown[];
};

/**
 * 016 — Un evento de Conversions API que el CRM le mandó al mock. El self-test
 * lo inspecciona para verificar la FORMA del payload: el modo de fallar de ese
 * endpoint es un 200 con `events_received: 0`, donde un campo mal puesto se ve
 * idéntico a uno bien puesto.
 */
export type CapiMockEvent = {
  n: number;
  datasetId: string;
  eventName: string;
  ctwaClid: string | null;
  customData: Record<string, unknown> | null;
  body: unknown;
  at: string;
};

/**
 * 026 — Cómo responde el mock a un mensaje de imagen por link (foto del
 * producto): `reject` ⇒ 400 como Meta ante un link inválido; `slow` ⇒ tarda
 * más que el límite del motor (que debe mandar el texto solo).
 */
export type MediaMode = "ok" | "reject" | "slow";

type WaMockState = {
  outbox: OutboxEntry[];
  /**
   * 027 — Plantillas POR WABA, no un array global. En Meta una plantilla
   * pertenece a una cuenta concreta y `GET {waba}/message_templates` jamás
   * devuelve las de otra; con una sola bolsa compartida, el sync de un arnés
   * importaría lo que sembró otro y los conteos dejarían de significar lo
   * que dicen.
   */
  templates: Record<string, MockTemplate[]>;
  capiEvents: CapiMockEvent[];
  counter: number;
  mediaMode: MediaMode;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = {
      outbox: [],
      templates: {},
      capiEvents: [],
      counter: 0,
      mediaMode: "ok",
    };
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  globalForMock.__waMockState = {
    outbox: [],
    templates: {},
    capiEvents: [],
    counter: 0,
    mediaMode: "ok",
  };
}

/**
 * Bolsa de plantillas de UN WABA, creándola si es la primera. Todo acceso a
 * plantillas del mock pasa por aquí: es lo que impide volver a escribir una
 * lista global sin darse cuenta.
 */
export function templatesOf(wabaId: string): MockTemplate[] {
  const state = getWaMockState();
  const bolsa = state.templates[wabaId];
  if (bolsa) return bolsa;
  const nueva: MockTemplate[] = [];
  state.templates[wabaId] = nueva;
  return nueva;
}

/** Todas las plantillas del mock, de todos los WABA (para buscar por nombre). */
export function allMockTemplates(): MockTemplate[] {
  return Object.values(getWaMockState().templates).flat();
}

export function nextN(): number {
  return ++getWaMockState().counter;
}

/**
 * Sello único por arranque del proceso. Sin él, el contador del mock reinicia
 * al reiniciar `pnpm dev` y vuelve a emitir `wamid.mock.out.1`, que choca con
 * el UNIQUE de `wa_message_id` en la BD de una corrida anterior (500 al
 * enviar). No es un fallo del producto: la idempotencia hace su trabajo.
 */
const boot = Math.random().toString(36).slice(2, 8);

export function nextOutboundWamid(): string {
  return `wamid.mock.out.${boot}.${nextN()}`;
}

/**
 * 027 — Ids de plantilla. Llevan el sello de arranque Y una secuencia que
 * vive FUERA del estado: los ids de Meta son únicos para siempre y jamás se
 * reciclan, así que vaciar el panel simulado (`DELETE outbox` llama a
 * `resetWaMockState`) no puede devolver el contador a cero. Cuando lo hacía,
 * la plantilla recién creada nacía con un id que ya tenía una fila de una
 * corrida anterior, y el sync —que casa primero por `waTemplateId`—
 * actualizaba la fila equivocada.
 */
let secuenciaDePlantillas = 0;
export function nextTemplateId(prefijo: "tplmock" | "tplseed"): string {
  return `${prefijo}_${boot}_${++secuenciaDePlantillas}`;
}
