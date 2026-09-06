"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SSE_PING_EVENT, SSE_SILENCE_LIMIT_MS } from "@/lib/sse-constants";
import {
  decide,
  type ConnectionState,
  type ReadyState,
} from "@/lib/sse-watchdog";

export type EventHandlers = {
  onMessageNew?: (data: { conversationId: string; message: unknown }) => void;
  onMessageStatus?: (data: {
    conversationId: string;
    messageId: string;
    status: string;
    /** Motivo, presente solo cuando status = "failed". */
    error?: string | null;
  }) => void;
  onConversationUpdated?: (data: { conversation: unknown }) => void;
  onLabRun?: (data: {
    runId: string;
    status: string;
    progress: { done: number; total: number };
    score?: number | null;
  }) => void;
  /** 015 — Algo cambió en la agenda (también cuando agenda la IA). */
  onBookingUpdated?: (data: { bookingId: string }) => void;
  /**
   * Catch-up tras RECONECTAR (no en la conexión inicial): volver a pedir lo que
   * se muestre en pantalla.
   *
   * **Obligatorio a propósito** (018). Antes era opcional y tres de los cinco
   * consumidores se lo saltaron sin que nadie se enterara: al reconectar, la
   * bandeja se ponía al día y el contador de no leídos, el Laboratorio y la
   * agenda se quedaban con datos viejos — sin avisar, que es el fallo que esta
   * feature existe para eliminar. Un contrato que se cumple recordándolo se
   * erosiona; este se cumple porque no compila si no.
   *
   * Si de verdad no hay nada que refrescar, pásalo explícito: `() => {}`.
   *
   * **Puede devolver una promesa, y conviene que lo haga.** El hook la espera
   * para saber cuándo la vista vuelve a ser de fiar: si el catch-up se lanza y
   * se olvida, el aviso de "poniendo al día" desaparecería de inmediato, con la
   * bandeja todavía sin refrescar — que es decir "todo bien" antes de tiempo.
   */
  onReconnect: () => void | Promise<void>;
};

/** Lo que el hook cuenta de la conexión, para que la interfaz no mienta. */
export type EventsStatus = {
  state: ConnectionState;
  /** El catch-up sigue en marcha: la vista todavía no es de fiar. */
  catchingUp: boolean;
};

/** Cada cuánto mira el vigilante, con la pestaña delante. */
const CHECK_INTERVAL_MS = 10_000;

function readyStateOf(source: EventSource | null): ReadyState {
  if (!source) return "closed";
  if (source.readyState === EventSource.CONNECTING) return "connecting";
  if (source.readyState === EventSource.OPEN) return "open";
  return "closed";
}

/**
 * Suscripción SSE de la bandeja (contrato `sse.md`).
 *
 * No basta con `EventSource`: puede quedarse con una conexión muerta diciendo
 * OPEN y sin disparar `error` —está reportado en iOS 18 al volver de segundo
 * plano—, y entonces la app enseña una vista vieja como si estuviera al día.
 * Así que aquí se vigila el silencio: el servidor manda una señal de vida cada
 * ~25 s, se apunta cuándo llegó la última, y si pasa demasiado tiempo se
 * reconecta sin preguntarle al navegador su opinión.
 *
 * La decisión vive en `lib/sse-watchdog` para poder probarla con reloj falso;
 * aquí solo está el cableado con el transporte y el DOM.
 */
export function useEvents(handlers: EventHandlers): EventsStatus {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [status, setStatus] = useState<EventsStatus>({
    state: "conectado",
    catchingUp: false,
  });

  const sourceRef = useRef<EventSource | null>(null);
  const lastTrafficAtRef = useRef<number>(Date.now());
  const attemptsRef = useRef(0);
  const hadTerminalRetryRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Hubo desconexión desde la última conexión buena: al abrir toca catch-up. */
  const needsCatchUpRef = useRef(false);
  const stoppedRef = useRef(false);
  /**
   * `connect` y `check` se necesitan mutuamente: al conectar hay que poder
   * pedir una comprobación, y al comprobar hay que poder reconectar. La ref
   * rompe el ciclo sin recrear el `EventSource` en cada render.
   */
  const checkRef = useRef<(justBecameVisible?: boolean) => void>(() => {});

  const connect = useCallback(() => {
    if (stoppedRef.current) return;

    sourceRef.current?.close();

    const source = new EventSource("/api/events");
    sourceRef.current = source;
    lastTrafficAtRef.current = Date.now();

    /** Cualquier dato es señal de vida, venga de donde venga. */
    const touch = () => {
      lastTrafficAtRef.current = Date.now();
    };

    const listen = <T,>(type: string, handler: (data: T) => void) => {
      source.addEventListener(type, (ev) => {
        touch();
        try {
          handler(JSON.parse((ev as MessageEvent).data) as T);
        } catch {
          // evento malformado: ignorar, pero el tráfico ya cuenta como vida
        }
      });
    };

    // El heartbeat con nombre (Entrega 1). No lleva datos: su único trabajo es
    // demostrar que la conexión sigue entregando. El comentario `: ping` que
    // manda el servidor al mismo tiempo NO sirve para esto: la especificación
    // manda ignorar las líneas que empiezan por `:`, así que nunca llega aquí.
    source.addEventListener(SSE_PING_EVENT, touch);

    listen("message.new", (d) => handlersRef.current.onMessageNew?.(d as never));
    listen("message.status", (d) =>
      handlersRef.current.onMessageStatus?.(d as never)
    );
    listen("conversation.updated", (d) =>
      handlersRef.current.onConversationUpdated?.(d as never)
    );
    listen("lab.run", (d) => handlersRef.current.onLabRun?.(d as never));
    listen("booking.updated", (d) =>
      handlersRef.current.onBookingUpdated?.(d as never)
    );

    source.onopen = () => {
      touch();
      attemptsRef.current = 0;
      hadTerminalRetryRef.current = false;

      if (!needsCatchUpRef.current) {
        setStatus({ state: "conectado", catchingUp: false });
        return;
      }

      // Reconexión: la vista puede estar incompleta hasta que el catch-up
      // termine, así que el aviso NO se retira todavía. Se ESPERA el catch-up
      // (FR-311): reconectar no es estar al día.
      needsCatchUpRef.current = false;
      setStatus({ state: "conectado", catchingUp: true });
      void (async () => {
        try {
          await handlersRef.current.onReconnect();
        } catch {
          // Un catch-up que falla no debe dejar el aviso colgado para siempre;
          // si la conexión sigue mal, el vigilante lo volverá a marcar.
        } finally {
          setStatus((prev) => ({ ...prev, catchingUp: false }));
        }
      })();
    };

    source.onerror = () => {
      needsCatchUpRef.current = true;
      // No se decide nada aquí: el vigilante mira `readyState` y el silencio en
      // su próxima pasada. `error` en SSE es ambiguo —puede ser "ya estoy
      // reintentando"— y actuar sobre él directamente duplicaría reconexiones.
      checkRef.current();
    };
  }, []);

  const scheduleReconnect = useCallback(
    (delayMs: number) => {
      if (reconnectTimerRef.current) return; // ya hay uno en camino
      attemptsRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delayMs);
    },
    [connect]
  );

  const check = useCallback(
    (justBecameVisible = false) => {
      if (stoppedRef.current) return;

      const decision = decide({
        lastTrafficAt: lastTrafficAtRef.current,
        now: Date.now(),
        readyState: readyStateOf(sourceRef.current),
        visible:
          typeof document === "undefined" ? true : !document.hidden,
        attempts: attemptsRef.current,
        justBecameVisible,
        hadTerminalRetry: hadTerminalRetryRef.current,
      });

      setStatus((prev) =>
        prev.state === decision.state ? prev : { ...prev, state: decision.state }
      );

      if (decision.action === "rendirse") {
        stoppedRef.current = true;
        sourceRef.current?.close();
        return;
      }

      if (decision.action === "reconectar") {
        needsCatchUpRef.current = true;
        // Un cierre terminal que reintentamos: si vuelve a cerrar, es la sesión.
        if (readyStateOf(sourceRef.current) === "closed") {
          hadTerminalRetryRef.current = true;
        }
        scheduleReconnect(decision.delayMs);
      }
    },
    [scheduleReconnect]
  );

  checkRef.current = check;

  useEffect(() => {
    stoppedRef.current = false;
    connect();

    const onVisibility = () => {
      if (document.hidden) return;
      // Sin esperar al margen: es cuando aparece el fallo de iOS y cuando el
      // operador está mirando.
      checkRef.current(true);
    };
    /** Vuelta desde el bfcache: camino distinto al de visibilidad. */
    const onPageShow = () => checkRef.current(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    // El intervalo cubre la pestaña abierta y quieta. NO cubre la suspensión:
    // con la página congelada los temporizadores no corren, y por eso la
    // comprobación compara sellos de tiempo en vez de contar disparos.
    const timer = setInterval(() => checkRef.current(false), CHECK_INTERVAL_MS);

    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect]);

  return status;
}

/** Reexport por comodidad de quien pinta el estado. */
export { SSE_SILENCE_LIMIT_MS };
