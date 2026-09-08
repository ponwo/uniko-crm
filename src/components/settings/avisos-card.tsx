"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Smartphone } from "lucide-react";
import { estaInstalada, esIOS, type EntornoCliente } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Activar y desactivar los avisos de escalación **en este dispositivo**.
 *
 * Tres cosas que parecen detalles y no lo son:
 *
 * 1. **El permiso se pide DENTRO del clic** (FR-509). En iOS, pedirlo al cargar
 *    la página no funciona: el sistema exige un gesto del usuario. Y aunque
 *    funcionara, un permiso que salta solo se rechaza por reflejo.
 * 2. **En iOS hace falta la app instalada.** El Push API no existe en una
 *    pestaña de Safari, se conceda el permiso o no. Si no está instalada, esto
 *    lo dice en vez de ofrecer un botón que no puede funcionar (FR-513).
 * 3. **Es por dispositivo, no por cuenta.** El mismo operador puede querer
 *    avisos en su teléfono y no en el portátil, y eso es lo normal.
 */

type Estado =
  | "cargando"
  | "no-soportado"
  | "hace-falta-instalar"
  | "permiso-bloqueado"
  | "activables"
  | "activados";

function leerEntorno(): EntornoCliente {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    displayStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

/** De base64url a los bytes que espera `pushManager.subscribe()`. */
function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

export function AvisosCard() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revisar = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      const entorno = leerEntorno();
      // En iOS el Push API solo existe con la app instalada: si falta, el
      // motivo no es que el navegador no sirva, es que falta instalarla.
      setEstado(
        esIOS(entorno) && !estaInstalada(entorno)
          ? "hace-falta-instalar"
          : "no-soportado"
      );
      return;
    }
    if (Notification.permission === "denied") {
      setEstado("permiso-bloqueado");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const suscripcion = await reg.pushManager.getSubscription();
    setEstado(suscripcion ? "activados" : "activables");
  }, []);

  useEffect(() => {
    void revisar();
  }, [revisar]);

  const activar = useCallback(async () => {
    setError(null);
    setTrabajando(true);
    try {
      // El permiso, DENTRO del gesto. Nunca al cargar.
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "permiso-bloqueado" : "activables");
        return;
      }

      const res = await fetch("/api/push/clave-publica");
      if (!res.ok) throw new Error("no se pudo obtener la clave");
      const { publicKey } = (await res.json()) as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const suscripcion = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveABytes(publicKey),
      });

      const alta = await fetch("/api/push/suscripcion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: suscripcion.endpoint }),
      });
      if (!alta.ok) throw new Error("no se pudo guardar la suscripción");
      setEstado("activados");
    } catch {
      setError("No se pudieron activar los avisos en este dispositivo.");
    } finally {
      setTrabajando(false);
    }
  }, []);

  const desactivar = useCallback(async () => {
    setError(null);
    setTrabajando(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const suscripcion = await reg.pushManager.getSubscription();
      if (suscripcion) {
        await fetch("/api/push/suscripcion", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: suscripcion.endpoint }),
        });
        await suscripcion.unsubscribe();
      }
      setEstado("activables");
    } catch {
      setError("No se pudieron desactivar. Intenta de nuevo.");
    } finally {
      setTrabajando(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avisos en este dispositivo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-text-2">
          Suena <b>solo</b> cuando el agente pasa una conversación a una persona.
          No por cada mensaje: para eso está la bandeja.
        </p>

        {estado === "cargando" && (
          <p className="text-xs text-text-3">Comprobando este dispositivo…</p>
        )}

        {estado === "hace-falta-instalar" && (
          <p
            data-testid="avisos-hace-falta-instalar"
            className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs leading-relaxed text-text-2"
          >
            <Smartphone aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              En iPhone los avisos solo funcionan con la app instalada. Toca{" "}
              <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>, ábrela
              desde ahí y vuelve a esta pantalla.
            </span>
          </p>
        )}

        {estado === "no-soportado" && (
          <p className="text-xs text-text-3">
            Este navegador no admite avisos. La bandeja sigue funcionando igual.
          </p>
        )}

        {estado === "permiso-bloqueado" && (
          <p
            data-testid="avisos-bloqueados"
            className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs leading-relaxed text-text-2"
          >
            Los avisos están bloqueados para este sitio en los ajustes del
            navegador. Hay que permitirlos ahí; desde aquí no se puede.
          </p>
        )}

        {estado === "activables" && (
          <Button
            data-testid="avisos-activar"
            disabled={trabajando}
            onClick={() => void activar()}
          >
            {trabajando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
            Activar avisos
          </Button>
        )}

        {estado === "activados" && (
          <div className="flex flex-wrap items-center gap-3">
            <p data-testid="avisos-activados" className="text-sm">
              Activados en este dispositivo.
            </p>
            <Button
              variant="ghost"
              data-testid="avisos-desactivar"
              disabled={trabajando}
              onClick={() => void desactivar()}
            >
              Desactivar
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
