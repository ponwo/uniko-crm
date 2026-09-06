/**
 * Los tiempos del canal SSE, en un solo sitio.
 *
 * Viven juntos porque servidor y cliente tienen que estar de acuerdo: el
 * servidor emite una señal de vida cada `SSE_HEARTBEAT_MS`, y el cliente
 * declara muerta la conexión tras `SSE_SILENCE_LIMIT_MS` sin recibir nada. Si
 * esos dos números se desincronizan, el cliente empieza a matar conexiones
 * sanas — que es justo el fallo que la feature 018 evita.
 */

/** Cada cuánto manda el servidor su señal de vida. */
export const SSE_HEARTBEAT_MS = 25_000;

/**
 * Cuánto silencio hace falta para dar por muerta la conexión.
 *
 * Dos heartbeats perdidos (50 s) más margen para el jitter de una red móvil.
 * Menos de eso produce falsos positivos en una pausa normal; mucho más deja al
 * operador mirando una pantalla desactualizada. No se espera este margen al
 * volver a primer plano: ahí se comprueba de inmediato.
 */
export const SSE_SILENCE_LIMIT_MS = 60_000;

/**
 * Espera antes de cada reintento, en milisegundos.
 *
 * Crece para no martillear sin red y topa en 15 s para que la recuperación siga
 * siendo rápida cuando la red vuelve. El contador se reinicia al conectar bien.
 * A partir del último elemento, se repite ese valor.
 */
export const SSE_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Nombre del evento de señal de vida.
 *
 * Es un evento CON NOMBRE y no el comentario `: ping`, porque la especificación
 * de server-sent events manda ignorar las líneas que empiezan por `:`: no
 * despachan evento ni tocan estado observable, así que el cliente no puede
 * verlas. El comentario se sigue enviando —defiende del corte por inactividad
 * en proxies— y esto se añade al lado, sin sustituirlo.
 */
export const SSE_PING_EVENT = "ping";

/** Espera antes de retomar el backoff desde el último escalón. */
export function retryDelayMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), SSE_RETRY_BACKOFF_MS.length - 1);
  return SSE_RETRY_BACKOFF_MS[i] ?? 15_000;
}
