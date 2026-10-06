/**
 * 015 (ajuste 2026-09-23) — Qué modelo pidió cada turno.
 *
 * Existe para que el arnés pueda PROBAR la promesa de `AGENDA_MODEL`: el
 * modelo bueno solo en los turnos en los que se elige horario, el de siempre
 * en el resto. Sin este registro, esa promesa —que es de COSTO— solo se podría
 * comprobar mirando la factura del proveedor.
 *
 * Vive con los demás mocks: fuera del entorno de pruebas no existe (404
 * incondicional en el perímetro `/api/dev/*`).
 *
 * 032 — El estado vive en `globalThis`, como el del wa-mock y el del stock-mock. En
 * `next dev` cada ruta compila su propia copia de este módulo y además la vuelve a
 * evaluar cuando la recompila: con una variable de módulo, la ruta `_state` no veía
 * lo que anotaba la de completions (en una corrida del arnés de la 032 seguía en
 * `lastModel: null` tras cientos de turnos).
 */

type AiMockState = {
  /** El modelo del último turno. */
  lastModel: string | null;
  /** Todos, en orden, para poder afirmar sobre una secuencia de turnos. */
  models: string[];
  /**
   * 032 — El último prompt recibido (system + historial, un mensaje por línea): con él
   * el arnés PRUEBA que la URL del catálogo PDF nunca llega al modelo (SC-004).
   */
  lastPrompt: string | null;
};

const globalForAiMock = globalThis as unknown as { __aiMock?: AiMockState };

function aiMockState(): AiMockState {
  if (!globalForAiMock.__aiMock) {
    globalForAiMock.__aiMock = { lastModel: null, models: [], lastPrompt: null };
  }
  return globalForAiMock.__aiMock;
}

export function recordAiMockCall(
  model: string | null | undefined,
  messages?: { role: string; content: string }[]
): void {
  const state = aiMockState();
  const m = (model ?? "").trim() || null;
  state.lastModel = m;
  if (m) state.models.push(m);
  // Acotado: es un mock, no un historial.
  if (state.models.length > 100) state.models.splice(0, state.models.length - 100);
  state.lastPrompt = messages?.length ? messages.map((x) => x.content).join("\n") : null;
}

export function aiMockSnapshot(): AiMockState {
  const state = aiMockState();
  return { lastModel: state.lastModel, models: [...state.models], lastPrompt: state.lastPrompt };
}

export function resetAiMock(): void {
  const state = aiMockState();
  state.lastModel = null;
  state.models = [];
  state.lastPrompt = null;
}
