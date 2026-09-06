import { describe, expect, it } from "vitest";
import {
  SSE_RETRY_BACKOFF_MS,
  SSE_SILENCE_LIMIT_MS,
} from "@/lib/sse-constants";
import { decide, isSilent, type WatchdogInput } from "@/lib/sse-watchdog";

/**
 * La decisión de si la conexión sigue viva (018).
 *
 * Reloj inyectado, sin navegador y sin servidor: es la parte determinista de la
 * feature. El nivel 3 (dispositivo real) prueba que el sistema operativo
 * provoca el fallo; esto prueba que cuando ocurre, decidimos bien.
 */

const AHORA = 1_000_000;

function entrada(over: Partial<WatchdogInput> = {}): WatchdogInput {
  return {
    lastTrafficAt: AHORA,
    now: AHORA,
    readyState: "open",
    visible: true,
    attempts: 0,
    ...over,
  };
}

describe("isSilent", () => {
  it("no da por muerta una pausa por debajo del margen", () => {
    expect(isSilent(AHORA, AHORA + SSE_SILENCE_LIMIT_MS - 1)).toBe(false);
  });

  it("da por muerta la conexión pasado el margen", () => {
    expect(isSilent(AHORA, AHORA + SSE_SILENCE_LIMIT_MS + 1)).toBe(true);
  });

  it("justo en el margen todavía no", () => {
    expect(isSilent(AHORA, AHORA + SSE_SILENCE_LIMIT_MS)).toBe(false);
  });
});

describe("decide — el silencio manda sobre lo que diga el navegador", () => {
  it("silencio por debajo del margen: no hace nada y se declara conectado", () => {
    const d = decide(entrada({ now: AHORA + SSE_SILENCE_LIMIT_MS - 1_000 }));
    expect(d.action).toBe("nada");
    expect(d.state).toBe("conectado");
    expect(d.reason).toBe("sano");
  });

  /** El caso de iOS 18: readyState miente diciendo OPEN y no llegó `error`. */
  it("silencio por encima del margen con readyState OPEN: reconecta igual", () => {
    const d = decide(entrada({ now: AHORA + SSE_SILENCE_LIMIT_MS + 1_000 }));
    expect(d.action).toBe("reconectar");
    expect(d.state).toBe("reconectando");
    expect(d.reason).toBe("silencio");
  });

  it("volver a primer plano fuerza la comprobación sin esperar nada", () => {
    const d = decide(
      entrada({
        now: AHORA + SSE_SILENCE_LIMIT_MS + 1_000,
        justBecameVisible: true,
      })
    );
    expect(d.action).toBe("reconectar");
    expect(d.delayMs).toBe(0);
    expect(d.reason).toBe("vuelve-a-primer-plano");
  });

  it("volver a primer plano con la conexión sana no reconecta por si acaso", () => {
    const d = decide(entrada({ justBecameVisible: true }));
    expect(d.action).toBe("nada");
    expect(d.state).toBe("conectado");
  });
});

describe("decide — readyState", () => {
  it("CONNECTING: espera, no duplica la reconexión del navegador", () => {
    const d = decide(entrada({ readyState: "connecting" }));
    expect(d.action).toBe("nada");
    expect(d.state).toBe("reconectando");
    expect(d.reason).toBe("reintentando");
  });

  it("CLOSED: el navegador se rindió, así que reconectamos nosotros", () => {
    const d = decide(entrada({ readyState: "closed" }));
    expect(d.action).toBe("reconectar");
    expect(d.reason).toBe("cerrado");
  });

  it("CLOSED tras haber reintentado ya: es la sesión, no la red — se rinde", () => {
    const d = decide(entrada({ readyState: "closed", hadTerminalRetry: true }));
    expect(d.action).toBe("rendirse");
    expect(d.state).toBe("sesion-terminada");
  });

  it("no reintenta en bucle contra un cierre terminal", () => {
    // Dos vueltas seguidas: la segunda ya no propone reconectar.
    const primera = decide(entrada({ readyState: "closed" }));
    expect(primera.action).toBe("reconectar");
    const segunda = decide(
      entrada({ readyState: "closed", hadTerminalRetry: true, attempts: 1 })
    );
    expect(segunda.action).toBe("rendirse");
  });
});

describe("decide — página oculta", () => {
  it("con silencio y la página oculta no se reintenta", () => {
    const d = decide(
      entrada({ now: AHORA + SSE_SILENCE_LIMIT_MS + 60_000, visible: false })
    );
    expect(d.action).toBe("nada");
    expect(d.reason).toBe("oculta");
  });

  it("con cierre terminal y la página oculta tampoco", () => {
    const d = decide(entrada({ readyState: "closed", visible: false }));
    expect(d.action).toBe("nada");
    expect(d.reason).toBe("oculta");
  });
});

describe("decide — espera creciente", () => {
  it("crece con los intentos", () => {
    const now = AHORA + SSE_SILENCE_LIMIT_MS + 1_000;
    const esperas = [0, 1, 2, 3, 4].map(
      (attempts) => decide(entrada({ now, attempts })).delayMs
    );
    expect(esperas).toEqual(SSE_RETRY_BACKOFF_MS);
  });

  it("topa en el último escalón y no sigue creciendo", () => {
    const now = AHORA + SSE_SILENCE_LIMIT_MS + 1_000;
    const tope = SSE_RETRY_BACKOFF_MS[SSE_RETRY_BACKOFF_MS.length - 1];
    expect(decide(entrada({ now, attempts: 50 })).delayMs).toBe(tope);
  });

  it("con el contador a cero vuelve al primer escalón (se reinicia al conectar)", () => {
    const now = AHORA + SSE_SILENCE_LIMIT_MS + 1_000;
    expect(decide(entrada({ now, attempts: 0 })).delayMs).toBe(
      SSE_RETRY_BACKOFF_MS[0]
    );
  });
});
