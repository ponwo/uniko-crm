"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 029 — Conectar Google por link (modelo agencia).
 *
 * Solo existe si la instancia tiene la app de agencia configurada: la ruta
 * responde 404 si no, y entonces esta sección no se pinta y la tarjeta queda
 * como la de siempre (FR-1401).
 *
 * El link completo se ve UNA vez, al generarlo (FR-1408): después solo se sabe
 * que hay uno pendiente y cuándo vence. Generar otro invalida el anterior.
 *
 * Si el calendario es de quien está frente a la pantalla, el link se abre aquí
 * mismo, en otra pestaña (FR-1429). Al volver a esta con el link a la vista, la
 * sección pregunta si ya se usó —desde aquí o por quien lo recibió— y la
 * tarjeta relee la conexión: sin recargar, "Probar" ya prueba la nueva.
 */

type Status = {
  canManage: boolean;
  pending: { createdAt: string; expiresAt: string } | null;
  usedAt: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function GoogleLinkSection({
  onAvailable,
  onConnected,
}: {
  onAvailable?: (available: boolean) => void;
  onConnected?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [generated, setGenerated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // `onAvailable` debe ser estable (un setter de useState): la disponibilidad
  // no cambia sin redesplegar, así que esto corre una vez.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/google/link").catch(() => null);
      if (!res?.ok) {
        setStatus(null);
        onAvailable?.(false);
        return;
      }
      setStatus((await res.json()) as Status);
      onAvailable?.(true);
    })();
  }, [onAvailable]);

  // Al volver a esta pestaña con el link a la vista.
  useEffect(() => {
    if (!generated) return;
    const aLaVista = generated;
    // Volver suele disparar los dos eventos a la vez: se atiende uno.
    let enCurso = false;
    // Si mientras tanto se generó otro, esta respuesta ya no aplica: borraría
    // de la pantalla el link nuevo, que solo se ve una vez.
    let vigente = true;
    async function alVolver() {
      if (enCurso || document.visibilityState !== "visible") return;
      enCurso = true;
      try {
        const res = await fetch("/api/settings/google/link").catch(() => null);
        const next = res?.ok ? ((await res.json()) as Status) : null;
        if (!next || !vigente) return;
        setStatus(next);
        // Sigue pendiente (no se ha usado, o se canceló en Google): sigue sirviendo.
        if (next.pending?.expiresAt === aLaVista.expiresAt) return;
        setGenerated(null);
        if (next.usedAt) {
          setMessage({
            kind: "ok",
            text: "Listo: Google quedó conectado. «Probar» te dice qué calendario.",
          });
          onConnected?.();
        } else {
          setMessage({ kind: "error", text: "Ese link ya no sirve." });
        }
      } finally {
        enCurso = false;
      }
    }
    // `visibilitychange` al volver de otra pestaña; `focus`, de otra ventana.
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vigente = false;
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [generated, onConnected]);

  if (!status) return null;

  async function generate() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/settings/google/link", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage({
        kind: "error",
        text: data?.error?.message ?? "No se pudo generar el link. Intenta de nuevo.",
      });
      return;
    }
    const data = (await res.json()) as { url: string; expiresAt: string };
    setGenerated(data);
    // Como lo dirá el servidor: el más reciente es este, pendiente y sin usar.
    setStatus((s) =>
      s
        ? {
            ...s,
            pending: { createdAt: new Date().toISOString(), expiresAt: data.expiresAt },
            usedAt: null,
          }
        : s
    );
  }

  async function revoke() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/settings/google/link", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMessage({ kind: "error", text: "No se pudo revocar el link. Intenta de nuevo." });
      return;
    }
    setGenerated(null);
    setStatus((s) => (s ? { ...s, pending: null, usedAt: null } : s));
    setMessage({ kind: "ok", text: "Link revocado: ya no sirve para conectar." });
  }

  async function copy() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.url);
      setMessage({ kind: "ok", text: "Link copiado" });
    } catch {
      setMessage({ kind: "error", text: "No se pudo copiar: selecciónalo y cópialo a mano." });
    }
  }

  const { canManage, pending, usedAt } = status;
  // FR-1410: con página de aterrizaje, el link sale de la instancia (en LanCo,
  // a lanco.cloud); sin ella, la instancia lo manda directo a Google.
  const sitio = generated ? new URL(generated.url).host : null;
  const sale = sitio !== null && sitio !== window.location.host;

  return (
    <section className="space-y-3 rounded-sm border border-border bg-subtle p-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Conectar por link</h4>
        <p className="text-xs text-text-2">
          Genera un link y mándaselo a quien tiene el calendario donde deben
          caer las citas. Lo abre, autoriza con su cuenta de Google y queda
          conectado: no necesita entrar a Uniko ni crear nada en Google Cloud.
        </p>
      </div>

      {generated && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            {/* min-w-0: sin él, el ancho intrínseco del input empuja el botón
                fuera de la tarjeta en un teléfono. */}
            <Input
              readOnly
              value={generated.url}
              aria-label="Link de conexión"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 font-mono text-xs"
            />
            <Button variant="outline" onClick={copy} disabled={busy} className="shrink-0">
              Copiar
            </Button>
          </div>
          <p className="text-xs text-text-3">
            Vence el {formatDate(generated.expiresAt)} · sirve una sola vez. Se
            muestra solo ahora: cópialo antes de salir de esta pantalla.
          </p>
        </div>
      )}

      {generated && (
        <div className="space-y-1.5">
          <a
            href={generated.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Conectar mi calendario
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.8} />
          </a>
          <p className="text-xs text-text-3">
            {sale
              ? `Se abre ${sitio} en otra pestaña y de ahí Google te pide permiso`
              : "Se abre Google en otra pestaña para que autorices"}{" "}
            con la cuenta que elijas: esa es la que recibirá las citas. Si el
            calendario es de otra persona, mándale el link.
          </p>
        </div>
      )}

      {/* La fecha en es-MX ya termina en «p.m.»: detrás de ella no va punto, o
          saldría «p.m..». */}
      {!generated && pending && (
        <p className="text-xs text-text-2">
          Hay un link pendiente (vence el {formatDate(pending.expiresAt)}). Si lo
          perdiste, genera otro: el anterior deja de servir.
        </p>
      )}

      {!generated && !pending && usedAt && (
        <p className="text-xs text-text-2">Último link: usado el {formatDate(usedAt)}</p>
      )}

      {!canManage && (
        <p className="text-xs text-text-3">
          Solo el dueño de la cuenta puede generar o revocar el link.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={busy || !canManage}>
          {pending || generated ? "Generar otro" : "Generar link"}
        </Button>
        {pending && (
          <button
            type="button"
            onClick={revoke}
            disabled={busy || !canManage}
            className="text-sm text-text-3 hover:text-foreground disabled:opacity-50"
          >
            Revocar
          </button>
        )}
        {message && (
          <span
            className={
              message.kind === "ok" ? "text-sm text-brand-text" : "text-sm text-destructive"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
