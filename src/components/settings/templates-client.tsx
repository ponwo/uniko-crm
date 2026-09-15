"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import {
  analizarComponentes,
  bloqueoDeMeta,
  countVariables,
  esEnviable,
  validateBodyVariables,
} from "@/lib/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_BADGE: Record<
  TemplateDto["status"],
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente de Meta", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

/**
 * Motivos de rechazo de Meta (`rejected_reason`), traducidos a qué hacer. Los
 * que no están aquí se muestran literales: el nombre exacto es lo que permite
 * buscarlos en la documentación de Meta.
 */
const MOTIVOS_DE_RECHAZO: Record<string, string> = {
  INVALID_FORMAT:
    "formato inválido (variables mal usadas, ejemplos que no cuadran o estructura incorrecta). Revisa el texto y créala de nuevo.",
  TAG_CONTENT_MISMATCH:
    "la categoría no coincide con el contenido según Meta. Créala de nuevo con la otra categoría.",
  INCORRECT_CATEGORY:
    "la categoría no coincide con el contenido según Meta. Créala de nuevo con la otra categoría.",
  ABUSIVE_CONTENT:
    "Meta considera que el contenido infringe sus políticas. Reescríbela con otro enfoque.",
  SCAM: "Meta la marcó como posible estafa. Reescríbela con otro enfoque.",
};

function explicarRechazo(reason: string): string {
  return MOTIVOS_DE_RECHAZO[reason.toUpperCase()] ?? reason;
}

type SyncMsg = { tipo: "ok" | "error"; texto: string };

/**
 * Qué decir cuando la API no respondió con su JSON de error. Antes todo caía
 * en "No se pudo crear la plantilla", que es lo que vio el dueño el
 * 2026-09-14 y no distingue una caída de red, un 502 del proxy durante un
 * despliegue o un 524 del CDN: con el código HTTP a la vista, sí.
 */
function explicarFalloHttp(res: Response | null, accion: string): string {
  if (!res) return `${accion}: no hubo respuesta del servidor (¿sin conexión?). Vuelve a intentarlo.`;
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return `${accion}: el servidor no estaba disponible (HTTP ${res.status}), puede estar reiniciándose. Vuelve a intentarlo en un minuto.`;
  }
  return `${accion}: respuesta inesperada del servidor (HTTP ${res.status}).`;
}

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<SyncMsg | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/templates").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: TemplateDto[] };
    setTemplates(data.templates);
  }, []);

  /**
   * `silent` significa "no anuncies el ÉXITO con el botón girando", nunca "no
   * anuncies el fallo".
   *
   * Meta entrega `message_template_status_update` al callback A NIVEL APP, que
   * en modo agencia no es el de esta instancia — sin este pull la plantilla se
   * queda "Pendiente de Meta" para siempre aunque ya esté aprobada. Y si la
   * consulta a Meta no salió, lo que se ve es local y VIEJO, y hay que decirlo:
   * antes el sync automático se tragaba el error entero y la lista local era
   * indistinguible de una al día.
   */
  const sync = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setSyncing(true);
      setSyncMsg(null);
      const res = await fetch("/api/templates/sync", { method: "POST" }).catch(
        () => null
      );
      if (!silent) setSyncing(false);

      if (!res?.ok) {
        const data = (await res?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setSyncMsg({
          tipo: "error",
          texto:
            data?.error?.message ??
            `${explicarFalloHttp(res, "No se pudo consultar Meta")} Lo que ves es la última copia local.`,
        });
        return;
      }

      const data = (await res.json()) as {
        updated?: number;
        imported?: number;
        missing?: number;
      };
      const partes = [
        data.imported ? `${data.imported} importada(s) de Meta` : null,
        data.updated ? `${data.updated} actualizada(s)` : null,
        data.missing ? `${data.missing} ya no está(n) en Meta` : null,
      ].filter(Boolean);
      // También cuando no cambió nada y venía del sync automático: "Todo al
      // día" es lo que hace COMPROBABLE la promesa de que esta pantalla
      // consulta a Meta al abrirse. Sin esa línea, "todo bien" y "no llegué a
      // preguntar" se ven exactamente igual.
      setSyncMsg({
        tipo: "ok",
        texto: partes.length > 0 ? partes.join(" · ") : "Todo al día",
      });
      void refetch();
    },
    [refetch]
  );

  useEffect(() => {
    void refetch().then(() => sync({ silent: true }));
  }, [refetch, sync]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Las plantillas permiten reabrir conversaciones con la ventana de 24 h
          cerrada. Meta las aprueba en horas o días y puede reclasificar la
          categoría (lo que cambia el costo por conversación). Esta pantalla
          consulta a Meta cada vez que la abres y trae también las que hayas
          creado en el Administrador de WhatsApp; Sincronizar fuerza la
          consulta sin recargar.
        </p>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && (
        <p
          data-testid="templates-sync-msg"
          className={
            syncMsg.tipo === "error"
              ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {syncMsg.texto}
        </p>
      )}

      <CreateForm onCreated={() => void refetch()} />

      <div className="space-y-2">
        {templates.map((t) => (
          <TemplateRow key={t.id} t={t} />
        ))}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Sin plantillas todavía. Crea la primera arriba — por ejemplo un
            «seguimos disponibles, ¿retomamos tu cotización?» para
            conversaciones frías. Si ya tienes plantillas en el Administrador
            de WhatsApp, Sincronizar las trae.
          </p>
        )}
      </div>
    </div>
  );
}

function TemplateRow({ t }: { t: TemplateDto }) {
  // El estado de Meta manda sobre el envío, así que también sobre lo que se
  // pinta: una plantilla pausada con la insignia "Aprobada" es exactamente la
  // mentira que esta pantalla evita.
  //
  // Se calcula SIN condicionarlo a la ausencia. Son dos bloqueos distintos y
  // pueden darse a la vez —Meta pausó una plantilla y después dejó de
  // listarla— así que ninguno debe tapar al otro. La INSIGNIA sí tiene que
  // elegir, porque solo cabe un rótulo, y ahí manda la ausencia: es la que
  // dicta qué hacer. Pero el motivo de Meta se sigue contando abajo.
  const bloqueo = bloqueoDeMeta(t);
  const analisis = analizarComponentes(t.components, t.body);
  const enviable = esEnviable(t);
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="template-row">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-sm font-medium">
          {t.name}{" "}
          <span className="text-muted-foreground">
            ({t.language} · {t.category})
          </span>
        </p>
        <Badge
          variant={
            t.missingSince || bloqueo ? "secondary" : STATUS_BADGE[t.status].variant
          }
        >
          {t.missingSince
            ? "Ya no está en Meta"
            : (bloqueo?.etiqueta ?? STATUS_BADGE[t.status].label)}
        </Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
      {analisis.extras && (
        <p className="mt-1 text-xs text-muted-foreground">{analisis.extras}</p>
      )}
      {t.missingSince && (
        <p className="mt-2 text-xs text-muted-foreground">
          Desapareció de tu cuenta de Meta el{" "}
          {new Date(t.missingSince).toLocaleDateString()}. La conservamos
          porque los mensajes que ya enviaste con ella la referencian, pero no
          se puede volver a enviar: créala de nuevo arriba si la necesitas.
        </p>
      )}
      {/*
        Bloquear el envío sin decir nada dejaría al operador con una plantilla
        desaparecida del selector y ninguna pista. Cada estado tiene su causa
        y su salida, y la salida casi siempre está en el Administrador de
        WhatsApp, no aquí. Con la plantilla YA ausente el encabezado cambia:
        lo que aporta este texto es el porqué anterior, en pasado.
      */}
      {bloqueo && (
        <p className="mt-2 text-xs text-warning-text">
          {t.missingSince
            ? `Antes de desaparecer, Meta la tenía así (${t.metaStatus}). `
            : "No se puede enviar. "}
          {bloqueo.explicacion}
        </p>
      )}
      {!t.missingSince && !bloqueo && analisis.requisito && (
        <p className="mt-2 text-xs text-warning-text">{analisis.requisito}</p>
      )}
      {!t.missingSince && t.status === "rejected" && t.rejectionReason && (
        <p className="mt-2 text-xs text-destructive">
          Razón del rechazo: {explicarRechazo(t.rejectionReason)}
        </p>
      )}
      {enviable && (
        <p className="mt-2 text-xs text-muted-foreground">
          Lista para enviar desde la Bandeja y Contactos.
        </p>
      )}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Misma validación que el servidor —y que Meta al crear—: avisa antes de
  // gastar una llamada que responderá "(#100) Invalid parameter".
  const bodyError = body.trim() ? validateBodyVariables(body) : null;
  const variableCount = countVariables(body);

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, language, category, body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(
        data?.error?.message ?? explicarFalloHttp(res, "No se pudo crear la plantilla")
      );
      // Ya existía en Meta y el servidor la importó: la lista debe mostrarla.
      if (data?.error?.code === "already_exists") onCreated();
      return;
    }
    setName("");
    setBody("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva plantilla</CardTitle>
        <CardDescription>
          Cuerpo con las variables que necesites: numéralas{" "}
          <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, <code>{"{{3}}"}</code>
          … en orden y sin saltos, con texto antes, después y entre ellas. Se
          envía a aprobación de Meta al crearla; Meta puede asignarle la
          categoría que sus reglas dicten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input
              id="tpl-name"
              placeholder="seguimiento_cotizacion"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-lang">Idioma</Label>
            <select
              id="tpl-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="es_MX">es_MX</option>
              <option value="es">es</option>
              <option value="es_AR">es_AR</option>
              <option value="en_US">en_US</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-cat">Categoría</Label>
            <select
              id="tpl-cat"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as "UTILITY" | "MARKETING")
              }
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="UTILITY">UTILITY (seguimiento)</option>
              <option value="MARKETING">MARKETING</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">Cuerpo</Label>
          <Textarea
            id="tpl-body"
            rows={3}
            placeholder="Hola {{1}}, te confirmo tu sesión el {{2}} a las {{3}}."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {bodyError ? (
            <p className="text-xs text-destructive" data-testid="tpl-body-error">
              {bodyError}
            </p>
          ) : (
            variableCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {variableCount === 1
                  ? "1 variable: al enviar pedirá su valor."
                  : `${variableCount} variables: al enviar pedirá los ${variableCount} valores.`}
              </p>
            )
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive" data-testid="tpl-create-error">
            {error}
          </p>
        )}
        <Button
          disabled={saving || !name.trim() || !body.trim() || bodyError !== null}
          onClick={() => void create()}
        >
          {saving ? "Enviando a Meta…" : "Crear y enviar a aprobación"}
        </Button>
      </CardContent>
    </Card>
  );
}
