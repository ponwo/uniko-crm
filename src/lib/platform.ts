/**
 * En qué plataforma corre la app, y si ya está instalada.
 *
 * Funciones puras sobre hechos que el llamador lee del navegador, para poder
 * probarlas sin navegador. Aquí no se toca `window`.
 *
 * Existe porque instalar no se hace igual en cada sitio: en Android el navegador
 * nos ofrece un evento y podemos poner un botón; en iOS no existe tal evento y
 * lo único que se puede hacer es explicar el camino del sistema. Elegir mal
 * significa enseñarle a alguien instrucciones de iPhone en un Android, que es
 * peor que no enseñar nada.
 */

/** Lo que hay que mirar del navegador para decidir. */
export type EntornoCliente = {
  userAgent: string;
  /**
   * Cuántos puntos táctiles admite. Es lo que distingue un iPad moderno de un
   * Mac: desde iPadOS 13 el iPad se anuncia como Macintosh, así que el
   * `userAgent` por sí solo miente.
   */
  maxTouchPoints: number;
  /** `display-mode: standalone` (o fullscreen/minimal-ui): abierta instalada. */
  displayStandalone: boolean;
  /** Lo que iOS pone en `navigator.standalone` cuando corre desde el inicio. */
  navigatorStandalone?: boolean;
};

export type AvisoInstalacion = "boton" | "instrucciones" | "nada";

export function esIOS(entorno: EntornoCliente): boolean {
  const ua = entorno.userAgent;
  if (/iphone|ipod|ipad/i.test(ua)) return true;
  // iPad que se hace pasar por Mac: se delata por tener pantalla táctil.
  return /macintosh/i.test(ua) && entorno.maxTouchPoints > 1;
}

export function esAndroid(entorno: EntornoCliente): boolean {
  return /android/i.test(entorno.userAgent);
}

/**
 * ¿Está corriendo ya instalada?
 *
 * Se miran las dos señales porque ninguna cubre todo: `display-mode` es el
 * estándar, y `navigator.standalone` es lo que iOS lleva usando desde antes de
 * que existiera el estándar.
 */
export function estaInstalada(entorno: EntornoCliente): boolean {
  return entorno.displayStandalone || entorno.navigatorStandalone === true;
}

/**
 * Qué enseñar sobre instalar.
 *
 * - Ya instalada, o descartado por el operador → **nada**. Un aviso que sale
 *   cuando ya hiciste lo que pide enseña a ignorar el siguiente.
 * - Hay evento de instalación guardado → **botón**, que es lo que de verdad
 *   instala.
 * - iOS sin evento (nunca lo hay) → **instrucciones**, porque el sistema solo
 *   permite el camino manual.
 * - Cualquier otro caso → nada. En un escritorio sin evento no hay nada útil que
 *   decir.
 */
export function decidirAvisoInstalacion(input: {
  entorno: EntornoCliente;
  /** ¿Guardamos un `beforeinstallprompt` que todavía se puede disparar? */
  hayEventoDeInstalacion: boolean;
  /** ¿El operador ya dijo que no en este dispositivo? */
  descartado: boolean;
}): AvisoInstalacion {
  if (estaInstalada(input.entorno)) return "nada";
  if (input.descartado) return "nada";
  if (input.hayEventoDeInstalacion) return "boton";
  if (esIOS(input.entorno)) return "instrucciones";
  return "nada";
}
