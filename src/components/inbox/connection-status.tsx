"use client";

import { useEffect, useState } from "react";
import type { EventsStatus } from "@/components/use-events";

/**
 * Lo que la bandeja dice sobre su propia conexión.
 *
 * Existe porque el silencio no es un estado válido: si no se puede afirmar que
 * la vista está al día, hay que decirlo. Antes, una conexión muerta se veía
 * exactamente igual que un día tranquilo — sin error, sin spinner, sin nada— y
 * un cliente esperando respuesta se convertía en un cliente ignorado sin que
 * nadie pudiera notarlo.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 * 1. **"Al día" no se adorna.** El estado normal no lleva insignia. Un indicador
 *    permanente se vuelve parte del decorado y deja de leerse.
 *
 * 2. **Reconectando y sin conexión son cosas distintas.** Uno pide esperar, el
 *    otro pide actuar. Fundirlos en un "hay un problema" genérico obliga al
 *    operador a adivinar si tiene que hacer algo.
 *
 * 3. **Aparece con retardo.** Una reconexión limpia —desbloquear el teléfono,
 *    cambiar de wifi a datos— se resuelve en menos de un segundo. Si el aviso
 *    saltara ahí, parpadearía varias veces al día por cosas que se arreglan
 *    solas, y el operador aprendería a ignorarlo. Entonces no serviría el día
 *    que de verdad importa, que es justo el caso para el que se construyó.
 */

/** Cuánto aguantar antes de molestar. Por debajo de esto, se arregla solo. */
const GRACIA_MS = 2_000;

export function ConnectionStatus({ status }: { status: EventsStatus }) {
  // La verdad de "¿está la vista al día?" incluye el catch-up: reconectar no
  // es estar al día. Retirar el aviso al abrir la conexión, con la bandeja
  // todavía sin refrescar, sería volver a decir "todo bien" antes de tiempo.
  const problema =
    status.state !== "conectado" || status.catchingUp;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!problema) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), GRACIA_MS);
    return () => clearTimeout(t);
  }, [problema]);

  if (!visible) return null;

  const { texto, detalle, tono } = describir(status);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-state={status.catchingUp ? "poniendose-al-dia" : status.state}
      className={[
        "flex items-center gap-2 border-b px-3 py-2 text-xs",
        tono === "aviso"
          ? "border-[var(--warning-soft)] bg-[var(--warning-tint)] text-[var(--warning-text)]"
          : "border-[var(--danger-soft)] bg-[var(--danger-tint)] text-[var(--danger-text)]",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "size-1.5 shrink-0 rounded-full",
          tono === "aviso"
            ? "animate-pulse bg-[var(--warning)]"
            : "bg-[var(--danger)]",
        ].join(" ")}
      />
      <span className="font-medium">{texto}</span>
      <span className="min-w-0 truncate opacity-80">{detalle}</span>
    </div>
  );
}

function describir(status: EventsStatus): {
  texto: string;
  detalle: string;
  tono: "aviso" | "error";
} {
  if (status.state === "sesion-terminada") {
    return {
      texto: "Sesión terminada",
      detalle: "Vuelve a entrar para seguir recibiendo mensajes.",
      tono: "error",
    };
  }

  if (status.state === "sin-conexion") {
    return {
      texto: "Sin conexión",
      detalle: "Puede que falten mensajes. Revisa tu red.",
      tono: "error",
    };
  }

  // Reconectando o poniéndose al día: transitorio, no pide nada al operador.
  // Se dice igualmente, porque durante ese rato la vista puede estar incompleta.
  return {
    texto: status.catchingUp ? "Poniendo al día…" : "Reconectando…",
    detalle: "La bandeja puede no estar completa.",
    tono: "aviso",
  };
}
