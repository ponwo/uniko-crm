"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
  /** 033 — Último día en que la entrada es verdad (AAAA-MM-DD). `null` = permanente. */
  validUntil: string | null;
  /** 033 — Lo calcula el SERVIDOR en la zona del negocio, no el navegador. */
  estado: "vigente" | "por_vencer" | "vencida";
};

export function AgentClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-knob transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-4 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-5 text-center sm:mx-6 sm:mt-6 sm:p-6">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agrega <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code> a las variables
            de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
        <ProfileSection profile={profile} onSave={saveProfile} />
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <Button onClick={() => void onSave(form)}>Guardar comportamiento</Button>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [qaHasta, setQaHasta] = useState("");
  const [block, setBlock] = useState("");
  const [blockHasta, setBlockHasta] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Envía y, si el servidor rechaza, ENSEÑA por qué: un alta que no aparece sin
   * explicación es peor que el error. El 422 trae el mensaje de qué se esperaba.
   */
  async function enviar(url: string, method: string, body?: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setError("No se pudo conectar. Revisa tu conexión y vuelve a intentarlo.");
      return false;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(json?.error?.message ?? "No se pudo guardar el cambio.");
      return false;
    }
    setError(null);
    return true;
  }

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    const ok = await enviar("/api/kb", "POST", {
      kind: "qa",
      question,
      answer,
      validUntil: qaHasta || null,
    });
    if (ok) {
      setQuestion("");
      setAnswer("");
      setQaHasta("");
    }
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    const ok = await enviar("/api/kb", "POST", {
      kind: "block",
      content: block,
      validUntil: blockHasta || null,
    });
    if (ok) {
      setBlock("");
      setBlockHasta("");
    }
    onChanged();
  }

  async function remove(id: string) {
    await enviar(`/api/kb/${id}`, "DELETE");
    onChanged();
  }

  /**
   * 033 — Cambiar la vigencia SIN tocar el texto (FR-1831). `null` se manda
   * explícito para quitarla: es lo que vuelve permanente una entrada.
   */
  async function cambiarVigencia(id: string, validUntil: string | null): Promise<boolean> {
    const ok = await enviar(`/api/kb/${id}`, "PATCH", { validUntil });
    onChanged();
    return ok;
  }

  /** 033 — Corregir el texto SIN tocar la fecha (FR-1832). */
  async function editarTexto(
    id: string,
    texto: { question?: string; answer?: string; content?: string }
  ): Promise<boolean> {
    const ok = await enviar(`/api/kb/${id}`, "PATCH", texto);
    onChanged();
    return ok;
  }

  // «Por vencer» sigue activa: va con las vigentes, solo marcada.
  const vigentes = entries.filter((e) => e.estado !== "vencida");
  const obsoletas = entries.filter((e) => e.estado === "vencida");
  const porVencer = entries.filter((e) => e.estado === "por_vencer").length;

  const fila = (e: KbEntry) => (
    <KbFila
      key={e.id}
      entry={e}
      onVigencia={(v) => cambiarVigencia(e.id, v)}
      onTexto={(t) => editarTexto(e.id, t)}
      onRemove={() => void remove(e.id)}
    />
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-warning-text">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-2 text-xs text-danger-text">
            {error}
          </p>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <VigenciaNueva id="kb-qa-hasta" value={qaHasta} onChange={setQaHasta} />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <VigenciaNueva id="kb-block-hasta" value={blockHasta} onChange={setBlockHasta} />
          <Button size="sm" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        {porVencer > 0 && (
          <p data-testid="kb-por-vencer" className="text-xs text-warning-text">
            {porVencer === 1
              ? "1 entrada vence en los próximos días."
              : `${porVencer} entradas vencen en los próximos días.`}{" "}
            Siguen activas; si siguen siendo verdad, renueva su fecha para que el
            agente no deje de saberlas.
          </p>
        )}

        <ul className="space-y-2" data-testid="kb-vigentes">
          {vigentes.map(fila)}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
          {entries.length > 0 && vigentes.length === 0 && (
            <p className="py-2 text-center text-xs text-warning-text">
              Todo tu conocimiento ya venció, así que el agente no está afirmando
              nada de él. Renueva la fecha de lo que siga siendo verdad.
            </p>
          )}
        </ul>

        {/*
          033 (FR-1830) — Lo vencido NO se borra: el dueño escribió ese texto, y
          que desapareciera sin explicación sería peor que el problema que la
          vigencia resuelve. La sección solo aparece si hay algo dentro: una
          sección vacía pidiendo atención es ruido.
        */}
        {obsoletas.length > 0 && (
          <section
            aria-label="Conocimiento obsoleto"
            data-testid="kb-obsoletas"
            className="space-y-2 rounded-md border border-dashed p-3"
          >
            <div>
              <p className="text-sm font-medium">Conocimiento obsoleto</p>
              <p className="text-xs text-muted-foreground">
                Su fecha ya pasó, así que el agente dejó de usarlo: no lo afirma
                ni lo menciona. Sigue aquí para que puedas renovar su fecha,
                corregir el texto o borrarlo.
              </p>
            </div>
            <ul className="space-y-2">{obsoletas.map(fila)}</ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/** «2026-10-15» → «15 oct 2026», sin que la zona del navegador mueva el día. */
function fechaLegible(iso: string): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * 033 (FR-1802) — La fecha de una entrada nueva. El texto de ayuda existe
 * porque la distinción no es obvia y equivocarla apaga el conocimiento antes de
 * tiempo: es el último día en que el dato ES VERDAD, no la fecha del evento.
 */
function VigenciaNueva({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          Vigente hasta (opcional)
        </Label>
        <Input
          id={id}
          type="date"
          className="h-8 w-auto text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        El último día en que el dato sigue siendo verdad, no la fecha del evento:
        un curso que empieza en octubre y dura tres meses va hasta enero. Sin
        fecha, es permanente.
      </p>
    </div>
  );
}

/**
 * Una entrada del conocimiento: su texto (editable), su fecha (editable sin
 * tocar el texto) y su estado. Renovar y corregir son dos decisiones distintas
 * —una promoción renovada suele necesitar las dos, porque su texto todavía dice
 * «hasta el 15 de octubre»—, así que van por separado.
 */
function KbFila({
  entry: e,
  onVigencia,
  onTexto,
  onRemove,
}: {
  entry: KbEntry;
  onVigencia: (validUntil: string | null) => Promise<boolean>;
  onTexto: (t: { question?: string; answer?: string; content?: string }) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [q, setQ] = useState(e.question ?? "");
  const [a, setA] = useState(e.answer ?? "");
  const [c, setC] = useState(e.content ?? "");
  /*
   * La fecha se cambia con un «Guardar» explícito y no al vuelo: al teclear el
   * año en un campo de fecha, «2», «20», «202» ya son fechas válidas (año 0002…)
   * y guardarlas al vuelo vencería la entrada a medio escribir.
   */
  const [editandoFecha, setEditandoFecha] = useState(false);
  const [fecha, setFecha] = useState(e.validUntil ?? "");
  const fechaCompleta = /^\d{4}-\d{2}-\d{2}$/.test(fecha);

  async function guardarFecha() {
    if (!fechaCompleta) return;
    if (await onVigencia(fecha)) setEditandoFecha(false);
  }

  function abrirEdicion() {
    setQ(e.question ?? "");
    setA(e.answer ?? "");
    setC(e.content ?? "");
    setEditando(true);
  }

  async function guardar() {
    const ok = await onTexto(e.kind === "qa" ? { question: q, answer: a } : { content: c });
    if (ok) setEditando(false);
  }

  const vacio = e.kind === "qa" ? !q.trim() || !a.trim() : !c.trim();

  return (
    <li data-testid="kb-entrada" className="flex items-start gap-2 rounded-md border p-3">
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        {editando ? (
          <div className="space-y-2">
            {e.kind === "qa" ? (
              <>
                <Input aria-label="Pregunta" value={q} onChange={(ev) => setQ(ev.target.value)} />
                <Textarea aria-label="Respuesta" rows={2} value={a} onChange={(ev) => setA(ev.target.value)} />
              </>
            ) : (
              <Textarea aria-label="Contenido" rows={3} value={c} onChange={(ev) => setC(ev.target.value)} />
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void guardar()} disabled={vacio}>
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : e.kind === "qa" ? (
          <div>
            <p className="font-medium">{e.question}</p>
            <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {editandoFecha ? (
            <>
              <Input
                type="date"
                aria-label="Vigente hasta"
                className="h-7 w-auto py-0 text-xs"
                value={fecha}
                onChange={(ev) => setFecha(ev.target.value)}
              />
              <Button size="sm" className="h-7" onClick={() => void guardarFecha()} disabled={!fechaCompleta}>
                Guardar fecha
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditandoFecha(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <span data-testid="kb-vigencia">
                {e.validUntil ? `Vigente hasta el ${fechaLegible(e.validUntil)}` : "Permanente"}
              </span>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setFecha(e.validUntil ?? "");
                  setEditandoFecha(true);
                }}
              >
                {e.validUntil ? "Cambiar fecha" : "Poner fecha"}
              </button>
              {e.validUntil && (
                <button type="button" className="underline" onClick={() => void onVigencia(null)}>
                  Hacer permanente
                </button>
              )}
            </>
          )}
          {/* La fecha ya está a la izquierda: las marcas solo dicen qué significa. */}
          {e.estado === "por_vencer" && <Badge variant="warning">Vence pronto · sigue activa</Badge>}
          {e.estado === "vencida" && <Badge variant="secondary">Ya venció · el agente no la usa</Badge>}
        </div>
      </div>
      {!editando && (
        <Button variant="ghost" size="icon" aria-label="Editar entrada" onClick={abrirEdicion}>
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" aria-label="Eliminar entrada" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}
