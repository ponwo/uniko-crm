/**
 * 026 — Si esta instancia tiene el conector de inventario (MS-Stock) o no.
 *
 * Misma decisión que la agenda (015) y los canales opcionales (ADR-001): el
 * código viaja siempre en main y lo que decide si EXISTE para el usuario es
 * una variable de despliegue. Una instancia normal (sin `INVENTARIO`) no ve el
 * botón, ni la pestaña de Ajustes, ni la acción del agente, ni una palabra de
 * inventario en el prompt — ni se le piden las variables `STOCK_*`.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseInventarioFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `agendaEnabled()`: preguntar si una feature existe no puede depender de que
 * TODO el entorno valide. `INVENTARIO` y las `STOCK_*` sí están declaradas en
 * `lib/env.ts` (ahí viven su documentación, su tipo y la regla de que con la
 * bandera encendida las tres son obligatorias).
 */
export function inventarioEnabled(): boolean {
  return parseInventarioFlag(process.env.INVENTARIO);
}

/**
 * Respuesta para una superficie del conector apagada. 404 y no 403 a
 * propósito: si el conector no está encendido, ese endpoint no existe en esta
 * instancia — no hay nada que revelar sobre él.
 */
export function inventarioDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
