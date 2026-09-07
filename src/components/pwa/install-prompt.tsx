"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  decidirAvisoInstalacion,
  type AvisoInstalacion,
  type EntornoCliente,
} from "@/lib/platform";

/**
 * El aviso para instalar la app.
 *
 * Tres estados, decididos por una función pura (`lib/platform`): **botón**
 * cuando el navegador nos ha ofrecido instalar, **instrucciones** en iOS —donde
 * ese ofrecimiento no existe y el único camino es el del sistema—, y **nada** el
 * resto del tiempo.
 *
 * Que se pueda quitar importa más que dónde esté: un aviso de instalar que no se
 * puede descartar es peor que no tenerlo, porque lo ve todos los días quien ya
 * decidió que no. El descarte se recuerda en `localStorage` y es de ESE
 * dispositivo: instalar es una decisión por teléfono, no por cuenta.
 */

const CLAVE_DESCARTE = "uniko:instalar-descartado";

/** Lo que el navegador emite cuando la app se puede instalar (solo Chromium). */
type EventoDeInstalacion = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function leerEntorno(): EntornoCliente {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    displayStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

export function InstallPrompt() {
  const [evento, setEvento] = useState<EventoDeInstalacion | null>(null);
  const [descartado, setDescartado] = useState(true);
  const [entorno, setEntorno] = useState<EntornoCliente | null>(null);

  useEffect(() => {
    // El estado inicial es "descartado" para no parpadear en el primer render:
    // se lee de verdad ya en el cliente.
    let guardado = false;
    try {
      guardado = localStorage.getItem(CLAVE_DESCARTE) === "1";
    } catch {
      // Navegador con el almacenamiento bloqueado: se trata como no descartado.
    }
    setDescartado(guardado);
    setEntorno(leerEntorno());

    const alPoderInstalar = (ev: Event) => {
      // Sin esto, Chrome enseña SU aviso y el nuestro no llega a existir.
      ev.preventDefault();
      setEvento(ev as EventoDeInstalacion);
    };
    const alInstalar = () => {
      setEvento(null);
      setEntorno(leerEntorno());
    };

    window.addEventListener("beforeinstallprompt", alPoderInstalar);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alPoderInstalar);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  const descartar = useCallback(() => {
    setDescartado(true);
    try {
      localStorage.setItem(CLAVE_DESCARTE, "1");
    } catch {
      // Si no se puede recordar, al menos se va de esta sesión.
    }
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    // El evento no se puede volver a usar, se acepte o no.
    setEvento(null);
    if (outcome === "dismissed") descartar();
  }, [evento, descartar]);

  if (!entorno) return null;

  const aviso: AvisoInstalacion = decidirAvisoInstalacion({
    entorno,
    hayEventoDeInstalacion: evento !== null,
    descartado,
  });

  if (aviso === "nada") return null;

  return (
    <div
      data-testid="install-prompt"
      data-aviso={aviso}
      className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--accent-tint)] px-3 py-2 text-xs"
    >
      <Download aria-hidden className="size-4 shrink-0 text-[var(--accent)]" />
      {aviso === "boton" ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="font-medium">Instala la app</span>{" "}
            <span className="opacity-80">
              para abrirla desde la pantalla de inicio, sin buscarla entre
              pestañas.
            </span>
          </span>
          <button
            type="button"
            onClick={() => void instalar()}
            data-testid="install-button"
            className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1 font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
          >
            Instalar
          </button>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="font-medium">Instala la app</span>{" "}
          <span className="opacity-80">
            toca Compartir y luego <b>Añadir a pantalla de inicio</b>.
          </span>
        </span>
      )}
      <button
        type="button"
        onClick={descartar}
        aria-label="No volver a mostrar"
        data-testid="install-dismiss"
        className="shrink-0 rounded p-1 opacity-60 hover:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
