/**
 * La decisión de si una conexión SSE sigue viva, aislada del transporte.
 *
 * Existe separada de `use-events.ts` a propósito: es la parte que hay que poder
 * probar con un reloj falso, sin navegador y sin servidor. Metida dentro del
 * hook sería exactamente lo que no se prueba, y esta feature nace de un fallo
 * que nadie detectó porque nadie lo miraba.
 *
 * No toca `EventSource`, no toca el DOM y no tiene efectos: recibe hechos y
 * devuelve qué hacer. Todo el estado vive fuera.
 */

import { SSE_SILENCE_LIMIT_MS, retryDelayMs } from "@/lib/sse-constants";

/** Lo que el navegador dice del stream. Espeja `EventSource.readyState`. */
export type ReadyState = "connecting" | "open" | "closed";

/** Qué está pasando, de cara a la interfaz. */
export type ConnectionState =
  | "conectado"
  | "reconectando"
  | "sin-conexion"
  | "sesion-terminada";

export type WatchdogInput = {
  /** Cuándo llegó el último dato: heartbeat o evento de dominio. */
  lastTrafficAt: number;
  /** Ahora, inyectable para poder probarlo. */
  now: number;
  /** Lo que reporta el navegador. Puede MENTIR: por eso existe el resto. */
  readyState: ReadyState;
  /** ¿La página está a la vista? Con ella oculta no se insiste. */
  visible: boolean;
  /** Reintentos consecutivos fallidos desde la última conexión buena. */
  attempts: number;
  /**
   * ¿Se acaba de hacer visible la página? Fuerza comprobación inmediata sin
   * esperar al margen de silencio: es el momento en que aparece el fallo de
   * iOS, y también el momento en que el operador está mirando.
   */
  justBecameVisible?: boolean;
  /**
   * ¿El último cierre fue terminal (`readyState` CLOSED tras un error) y ya se
   * reintentó una vez sin éxito? Entonces no es la red: es la sesión.
   */
  hadTerminalRetry?: boolean;
};

export type WatchdogDecision = {
  /** Qué hacer con el transporte. */
  action: "nada" | "reconectar" | "rendirse";
  /** Cuánto esperar antes de reconectar, si toca reconectar. */
  delayMs: number;
  /** Qué contar al usuario. */
  state: ConnectionState;
  /** Por qué, para poder leerlo en un log o en un test. */
  reason:
    | "sano"
    | "silencio"
    | "vuelve-a-primer-plano"
    | "cerrado"
    | "reintentando"
    | "oculta"
    | "sesion";
};

/**
 * ¿Lleva demasiado tiempo sin llegar nada?
 *
 * Se compara el reloj contra un sello de tiempo, y NO se cuenta cuántas veces
 * disparó un temporizador: con la página congelada los temporizadores no
 * corren, así que "el intervalo no saltó" no significa "todo bien" — significa
 * que no sabemos nada. Al volver, esta resta es la que dice la verdad.
 */
export function isSilent(lastTrafficAt: number, now: number): boolean {
  return now - lastTrafficAt > SSE_SILENCE_LIMIT_MS;
}

export function decide(input: WatchdogInput): WatchdogDecision {
  const {
    lastTrafficAt,
    now,
    readyState,
    visible,
    attempts,
    justBecameVisible = false,
    hadTerminalRetry = false,
  } = input;

  // 1. Sesión terminada. Un cierre terminal que ya se reintentó una vez no es
  //    la red: es un 401 (o equivalente). `EventSource` no expone el código,
  //    pero la especificación distingue "fail" de "reestablish", y en el
  //    primero pone CLOSED y NO reintenta por su cuenta. Insistir contra eso no
  //    se recupera nunca.
  if (hadTerminalRetry && readyState === "closed") {
    return {
      action: "rendirse",
      delayMs: 0,
      state: "sesion-terminada",
      reason: "sesion",
    };
  }

  // 2. Cierre terminal, primer intento. El navegador ya se rindió, así que
  //    nadie va a reconectar si no lo hacemos nosotros.
  if (readyState === "closed") {
    if (!visible) {
      return {
        action: "nada",
        delayMs: 0,
        state: "sin-conexion",
        reason: "oculta",
      };
    }
    return {
      action: "reconectar",
      delayMs: retryDelayMs(attempts),
      state: "reconectando",
      reason: "cerrado",
    };
  }

  // 3. El navegador dice que está reconectando. Ahí sí basta con esperar: es el
  //    camino que ya funcionaba y que no hay que duplicar.
  if (readyState === "connecting") {
    return {
      action: "nada",
      delayMs: 0,
      state: "reconectando",
      reason: "reintentando",
    };
  }

  // 4. Dice OPEN. Aquí es donde puede estar mintiendo, y donde el silencio
  //    manda sobre lo que diga.
  const silent = isSilent(lastTrafficAt, now);

  if (!silent) {
    return { action: "nada", delayMs: 0, state: "conectado", reason: "sano" };
  }

  // Silencio con la página oculta: no se insiste. Sin push (feature 020) no hay
  // nada que enseñar mientras la app no está delante, y reintentar en segundo
  // plano solo gasta batería. Al volver, el caso siguiente lo recoge.
  if (!visible) {
    return {
      action: "nada",
      delayMs: 0,
      state: "sin-conexion",
      reason: "oculta",
    };
  }

  // Al volver a primer plano no se espera nada: reconectar ya.
  if (justBecameVisible) {
    return {
      action: "reconectar",
      delayMs: 0,
      state: "reconectando",
      reason: "vuelve-a-primer-plano",
    };
  }

  return {
    action: "reconectar",
    delayMs: retryDelayMs(attempts),
    state: "reconectando",
    reason: "silencio",
  };
}
