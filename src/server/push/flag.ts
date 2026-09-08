/**
 * 020 — Si esta instancia manda notificaciones push o no.
 *
 * Mismo patrón que la agenda (015) y la atribución (016), y por la misma razón
 * de fondo: Web Push mete un tercero en runtime —FCM, APNs, el autopush de
 * Mozilla— y el Principio II solo lo permite como **conector opcional apagado
 * por defecto**. Ver [ADR-003](../../../docs/adr-003-notificaciones-push.md).
 *
 * Con `PUSH` apagada la instancia no menciona los avisos por ningún lado: no
 * registra manejador en el service worker, no pide permiso, no genera claves y
 * sus rutas responden 404. Es indistinguible de una instancia que no tiene la
 * feature.
 *
 * La migración se aplica igual en toda la flota: dos tablas vacías son inertes,
 * y a cambio todas las instancias comparten la misma estructura.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parsePushFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `agendaEnabled()` e `isMockEnabled()`: preguntar si una feature existe no
 * puede depender de que TODO el entorno valide. Si `getEnv()` fallara, una
 * escalación reventaría en vez de degradar — y la escalación no puede depender
 * del aviso (FR-504).
 *
 * `PUSH` sí está declarada en `lib/env.ts`: ahí viven su documentación y su
 * tipo. Lo que no pasa por el validador es esta consulta.
 */
export function pushEnabled(): boolean {
  return parsePushFlag(process.env.PUSH);
}

/**
 * Respuesta para una superficie de push apagada. 404 y no 403 a propósito: si
 * los avisos no están encendidos, ese endpoint no existe en esta instancia — no
 * hay nada que revelar sobre él.
 */
export function pushDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
