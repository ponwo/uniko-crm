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
 */

type AiMockState = {
  /** El modelo del último turno. */
  lastModel: string | null;
  /** Todos, en orden, para poder afirmar sobre una secuencia de turnos. */
  models: string[];
};

const state: AiMockState = { lastModel: null, models: [] };

export function recordAiMockCall(model: string | null | undefined): void {
  const m = (model ?? "").trim() || null;
  state.lastModel = m;
  if (m) state.models.push(m);
  // Acotado: es un mock, no un historial.
  if (state.models.length > 100) state.models.splice(0, state.models.length - 100);
}

export function aiMockSnapshot(): AiMockState {
  return { lastModel: state.lastModel, models: [...state.models] };
}

export function resetAiMock(): void {
  state.lastModel = null;
  state.models = [];
}
