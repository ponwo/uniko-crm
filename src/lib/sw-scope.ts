/**
 * Qué peticiones NO toca el service worker. Aislado del service worker a
 * propósito.
 *
 * Vive aquí y no dentro del archivo que ejecuta el navegador por la misma razón
 * por la que el vigilante de la 018 vive en `lib/sse-watchdog` y no dentro de
 * `use-events.ts`: es la decisión que hay que poder probar con un test, y metida
 * dentro del service worker sería exactamente lo que nadie mira hasta que un
 * operador pierde un mensaje.
 *
 * El service worker de esta app no cachea nada (spec 019), así que en teoría
 * "no tocar" y "tocar sin cachear" darían igual hoy. La exclusión existe porque
 * mañana no dará igual: la 020 va a abrir este mismo archivo para añadir push, y
 * envolver el canal SSE en un `respondWith` lo ataría al ciclo de vida del
 * worker — el navegador puede pararlo por inactividad mientras la conexión sigue
 * abierta. Esa es la silueta exacta del fallo que arregló la 018, esta vez
 * causada por nosotros.
 *
 * Ver [contrato](../../specs/019-pwa-instalable/contracts/service-worker.md).
 */

/**
 * Rutas que el service worker deja pasar a la red sin mirarlas.
 *
 * Se exporta para que el service worker generado las lleve incrustadas y para
 * que el test pueda comprobar que están las tres. Si alguien añade una, el test
 * de la ruta comprueba que también llegó al archivo servido.
 */
export const SW_RUTAS_EXCLUIDAS = [
  /** El canal SSE de la bandeja. El motivo entero está arriba. */
  "/api/events",
  /**
   * Los webhooks de Meta (WhatsApp, Instagram, Messenger). Tráfico de máquina
   * que entra al servidor: no es navegación de nadie y no gana nada pasando por
   * aquí.
   */
  "/api/webhooks",
  /** El cerebro externo, autenticado por API key. Misma razón. */
  "/api/bot",
] as const;

/**
 * ¿Debe el service worker desentenderse de esta petición?
 *
 * Compara por segmento y no por `startsWith` pelado: `/api/eventsfalsos` no es
 * `/api/events`, y dejar fuera de la vigilancia una ruta que solo se parece
 * sería un agujero silencioso en el sentido contrario.
 */
export function serviceWorkerDebeIgnorar(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    // Una URL que no se puede ni parsear no es nuestra: que la resuelva el
    // navegador.
    return true;
  }
  return SW_RUTAS_EXCLUIDAS.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`)
  );
}
