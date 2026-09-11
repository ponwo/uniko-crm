"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 025 — Automatización comentario→DM de Zernio, desde la pantalla del canal.
 *
 * Los comentarios no entran a la bandeja (spec 014): el negocio los atiende
 * con la automatización nativa de Zernio, que manda un DM a quien comenta una
 * palabra clave. Ese DM abre la conversación que Uniko sí recibe. Antes esto
 * se configuraba en el panel de Zernio, cliente por cliente; aquí se hace con
 * la llave que Uniko ya guarda, y se lee de Zernio al abrir (no hay copia
 * local que pueda desactualizarse).
 */

type Automation = {
  enabled: boolean;
  keywords: string[];
  dmMessage: string;
  commentReply: string | null;
  stats?: { triggered?: number; dmsSent?: number; dmsFailed?: number } | null;
};

const DEFAULTS = {
  keywords: "info, precio, interesa, quiero, más información",
  dmMessage:
    "¡Hola! Vi tu comentario 👋 Te escribo por aquí para darte la información completa. ¿Qué te gustaría saber?",
  commentReply: "¡Te mandamos la info por DM! 📩",
};

export function CommentAutomationCard({
  channel,
  /** El GET/PUT del canal: `/api/settings/instagram` o `/api/settings/messenger`. */
  endpoint,
}: {
  channel: "instagram" | "messenger";
  endpoint: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [current, setCurrent] = useState<Automation | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [keywords, setKeywords] = useState(DEFAULTS.keywords);
  const [dmMessage, setDmMessage] = useState(DEFAULTS.dmMessage);
  const [commentReply, setCommentReply] = useState(DEFAULTS.commentReply);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const data = (await fetch(`${endpoint}/comment-automation`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { available: boolean; automation: Automation | null } | null;
    if (data) {
      setAvailable(data.available);
      setCurrent(data.automation);
      if (data.automation) {
        setEnabled(data.automation.enabled);
        setKeywords(data.automation.keywords.join(", "));
        setDmMessage(data.automation.dmMessage);
        setCommentReply(data.automation.commentReply ?? "");
      }
    }
    setLoaded(true);
  }, [endpoint]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function save(nextEnabled = enabled) {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`${endpoint}/comment-automation`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: nextEnabled,
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        dmMessage: dmMessage.trim(),
        commentReply: commentReply.trim() || null,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar en Zernio");
      return;
    }
    setEnabled(nextEnabled);
    setSaved(true);
    void refetch();
  }

  if (!loaded || !available) return null;

  const where = channel === "instagram" ? "un post o reel" : "una publicación de la página";
  const canSave = dmMessage.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Comentario → DM</CardTitle>
            <CardDescription>
              Cuando alguien comenta una de estas palabras en {where}, Zernio le
              manda un DM. Esa conversación entra a la bandeja y el agente la
              sigue. Los comentarios en sí no se ven en Uniko.
            </CardDescription>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Automatización encendida"
            disabled={saving || (!current && !canSave)}
            onClick={() => void save(!enabled)}
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-knob transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${channel}-kw`}>Palabras clave (separadas por coma)</Label>
          <Input
            id={`${channel}-kw`}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={DEFAULTS.keywords}
          />
          <p className="text-xs text-text-2">
            Se comparan como palabra completa y toleran erratas («informacion»
            sin acento dispara igual). Vacío = cualquier comentario dispara.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${channel}-dm`}>DM que recibe quien comenta</Label>
          <Textarea
            id={`${channel}-dm`}
            value={dmMessage}
            onChange={(e) => setDmMessage(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${channel}-reply`}>Respuesta pública al comentario (opcional)</Label>
          <Input
            id={`${channel}-reply`}
            value={commentReply}
            onChange={(e) => setCommentReply(e.target.value)}
            placeholder="vacío = sin respuesta pública"
            maxLength={500}
          />
        </div>

        {current?.stats && (
          <p className="text-xs text-text-2">
            Disparada {current.stats.triggered ?? 0} veces · {current.stats.dmsSent ?? 0} DMs
            enviados
            {current.stats.dmsFailed ? ` · ${current.stats.dmsFailed} fallidos` : ""}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-success-text">Guardado en Zernio ✓</p>}

        <Button disabled={saving || !canSave} onClick={() => void save(current ? enabled : true)}>
          {saving ? "Guardando…" : current ? "Guardar cambios" : "Crear y encender"}
        </Button>
      </CardContent>
    </Card>
  );
}
