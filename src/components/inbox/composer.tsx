"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Clock3,
  FileText,
  ImagePlus,
  MapPin,
  Paperclip,
  Plus,
  Send,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining } from "./helpers";
import { TemplateSender } from "./template-sender";

/** 008 — Panel secundario del clip: formulario de ubicación o contacto. */
type AttachPanel = "location" | "contact" | null;

/**
 * Archivo en espera de salir. `preview` es un object URL (solo imágenes) que
 * se libera al quitarlo del lote o al desmontar.
 */
type Attachment = { id: string; file: File; preview: string | null };

/**
 * Tope por lote. Por la API de WhatsApp no existe el "álbum": cada archivo
 * sale como un mensaje propio, en orden. Treinta es lo que permite la app de
 * WhatsApp al elegir varias fotos; más que eso casi seguro fue soltar una
 * carpeta entera por error, y avisarlo vale más que encolar 400 subidas.
 */
const MAX_ATTACHMENTS = 30;

let attachSeq = 0;

/** Extrae lat,long de "21.019, -101.257" o de un enlace de Google Maps. */
function parseCoords(raw: string): { latitude: number; longitude: number } | null {
  const m =
    raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ??
    raw.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Etiqueta corta para la ficha de un adjunto sin miniatura (PDF, DOCX…). */
function fileBadge(name: string): string {
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  return ext && ext.length <= 5 ? ext.toUpperCase() : "ARCHIVO";
}

/** Un drag trae archivos (y no texto o un enlace) cuando declara `Files`. */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function Composer({
  conversation,
  onSend,
  onSent,
  dropZoneRef,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
  /**
   * Superficie que acepta soltar archivos (el hilo completo, no solo la caja
   * de escritura). Debe ser `position: relative`: el velo "Suelta para
   * adjuntar" se pinta encima de ella.
   */
  dropZoneRef?: RefObject<HTMLElement | null>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Cuántos del lote ya salieron, mientras `sending`. Null fuera del envío.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<AttachPanel>(null);
  const [coordsRaw, setCoordsRaw] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Espejo del lote para leerlo desde listeners nativos y del bucle de envío
  // sin depender del cierre de un render concreto.
  const attachmentsRef = useRef<Attachment[]>([]);
  const sendingRef = useRef(false);
  const windowOpenRef = useRef(conversation.windowOpen);
  windowOpenRef.current = conversation.windowOpen;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setBatch = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const removeAttachment = useCallback(
    (id: string) => {
      const gone = attachmentsRef.current.find((a) => a.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      setBatch(attachmentsRef.current.filter((a) => a.id !== id));
    },
    [setBatch]
  );

  const clearAttachments = useCallback(() => {
    for (const a of attachmentsRef.current) {
      if (a.preview) URL.revokeObjectURL(a.preview);
    }
    setBatch([]);
  }, [setBatch]);

  // Un archivo con tipo image/* pero corrupto no pinta miniatura: la ficha
  // cae al icono genérico en vez de mostrar un <img> roto.
  const dropPreview = useCallback(
    (id: string) => {
      const att = attachmentsRef.current.find((a) => a.id === id);
      if (!att?.preview) return;
      URL.revokeObjectURL(att.preview);
      setBatch(
        attachmentsRef.current.map((a) => (a.id === id ? { ...a, preview: null } : a))
      );
    },
    [setBatch]
  );

  // Las miniaturas se liberan al desmontar; en vida, al quitar cada adjunto.
  useEffect(() => clearAttachments, [clearAttachments]);

  // Los adjuntos elegidos son de ESTA conversación: al cambiar de hilo se
  // descartan (como hace WhatsApp Web), salvo que estén saliendo en ese
  // momento — el lote ya va a la conversación correcta y se retira solo.
  useEffect(() => {
    if (sendingRef.current) return;
    if (attachmentsRef.current.length > 0) clearAttachments();
    setError(null);
  }, [conversation.id, clearAttachments]);

  /**
   * Agrega archivos al lote (picker, drop o pegado). Dedup por
   * nombre+tamaño+fecha para que un doble drop no duplique; los que rebasan el
   * tope se anuncian, no se pierden en silencio.
   */
  const addFiles = useCallback(
    (incoming: Iterable<File>) => {
      const next = [...attachmentsRef.current];
      let fuera = 0;
      for (const f of incoming) {
        // Soltar una carpeta llega como File vacío y sin tipo: no es adjunto.
        if (f.size === 0 && !f.type) continue;
        const dup = next.some(
          (a) =>
            a.file.name === f.name &&
            a.file.size === f.size &&
            a.file.lastModified === f.lastModified
        );
        if (dup) continue;
        if (next.length >= MAX_ATTACHMENTS) {
          fuera++;
          continue;
        }
        next.push({
          id: `att_${++attachSeq}`,
          file: f,
          preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        });
      }
      setBatch(next);
      setPanel(null);
      setError(
        fuera > 0
          ? `Máximo ${MAX_ATTACHMENTS} adjuntos por envío; ${fuera} ${
              fuera === 1 ? "quedó" : "quedaron"
            } fuera`
          : null
      );
    },
    [setBatch]
  );

  // Drop sobre el hilo. Listeners nativos porque la superficie es del padre
  // (MessageThread + Composer), no de este componente. El contador de
  // profundidad evita que el velo parpadee al pasar sobre hijos (cada uno
  // dispara su propio dragleave).
  useEffect(() => {
    const el = dropZoneRef?.current;
    if (!el) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (windowOpenRef.current) setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      // Sin esto el navegador no permite soltar (y abriría el archivo).
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      // Con la ventana cerrada no hay a dónde adjuntar: solo evitamos que el
      // navegador navegue al archivo.
      if (!windowOpenRef.current) return;
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) addFiles(Array.from(files));
    };
    el.addEventListener("dragenter", onEnter);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onEnter);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [dropZoneRef, addFiles]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function resetText() {
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(path, init).catch(() => null);
    if (!res) return "Sin conexión con el servidor";
    if (res.ok) return null;
    // `apiError` responde { error: { code, message } }: el mensaje del
    // servidor ("El archivo excede el límite de 5 MB") es el que se muestra.
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return data?.error?.message ?? `Error ${res.status}`;
  }

  async function submit() {
    setError(null);

    if (attachmentsRef.current.length > 0) {
      // El lote sí espera: cada archivo se sube y confirma antes del
      // siguiente para que lleguen en el orden en que se eligieron.
      if (sending) return;
      const batch = attachmentsRef.current;
      const caption = text.trim();
      setSending(true);
      sendingRef.current = true;
      setProgress({ done: 0, total: batch.length });
      for (let i = 0; i < batch.length; i++) {
        const att = batch[i]!;
        const form = new FormData();
        form.set("file", att.file);
        // El texto va como pie del PRIMER adjunto: en WhatsApp cada archivo
        // es un mensaje propio y el pie acompaña al que abre la serie.
        if (i === 0 && caption) form.set("caption", caption);
        const err = await apiSend(
          `/api/conversations/${conversation.id}/messages/media`,
          { method: "POST", body: form }
        );
        if (err) {
          // Lo que ya salió, salió; lo que no, se queda en el lote para
          // reintentar. Con varios archivos se dice cuál falló.
          setError(batch.length > 1 ? `${att.file.name}: ${err}` : err);
          break;
        }
        if (i === 0) resetText();
        removeAttachment(att.id);
        setProgress({ done: i + 1, total: batch.length });
        onSent();
      }
      setSending(false);
      sendingRef.current = false;
      setProgress(null);
      return;
    }

    const value = text.trim();
    if (!value) return;
    // Aquí NO se espera al servidor. Enviar tarda ~1.5 s (el viaje a Meta) y
    // durante ese rato el renglón siguiente se escribía encima del anterior y
    // salía todo como un solo mensaje. El campo se limpia ya; la burbuja
    // "enviando" del hilo es la que informa el estado real.
    resetText();
    const err = await onSend(value);
    if (err) {
      setError(err);
      // Lo que no salió vuelve al campo. Si ya empezaste a escribir otra cosa
      // se antepone en vez de pisarte: nada se pierde en silencio.
      setText((actual) => (actual ? `${value}\n${actual}` : value));
      taRef.current?.focus();
      setTimeout(autogrow, 0);
    }
  }

  async function submitLocation() {
    const coords = parseCoords(coordsRaw);
    if (!coords) {
      setError("Coordenadas inválidas — pega «lat, long» o un enlace de Google Maps");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "location",
        location: { ...coords, ...(placeName.trim() ? { name: placeName.trim() } : {}) },
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setCoordsRaw("");
    setPlaceName("");
    onSent();
  }

  async function submitContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setError("El contacto necesita nombre y teléfono");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "contacts",
        contacts: [{ name: contactName.trim(), phone: contactPhone.trim() }],
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setContactName("");
    setContactPhone("");
    onSent();
  }

  if (!conversation.windowOpen) {
    return (
      <div className="border-t bg-background px-[18px] py-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="font-medium">La ventana de 24 horas está cerrada.</p>
            <p className="opacity-80">
              WhatsApp solo permite texto libre dentro de las 24 horas
              siguientes al último mensaje del cliente. Para retomar la
              conversación, envía una plantilla aprobada.
            </p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  const hasAttachments = attachments.length > 0;
  const canSubmit = hasAttachments || text.trim().length > 0;
  const totalBytes = attachments.reduce((n, a) => n + a.file.size, 0);
  const single = attachments.length === 1 ? attachments[0] : null;

  return (
    <div className="border-t bg-background px-[18px] pb-3.5 pt-3">
      {dragging && (
        <div
          data-testid="drop-veil"
          className="pointer-events-none absolute inset-0 z-20 bg-background p-3"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand-tint text-brand-text">
            <ImagePlus className="h-8 w-8" strokeWidth={1.5} />
            <p className="text-sm font-semibold">Suelta para adjuntar</p>
            <p className="text-xs opacity-80">
              Imágenes, videos, audio o documentos · hasta {MAX_ATTACHMENTS} por
              envío
            </p>
          </div>
        </div>
      )}

      {templates.length > 0 && !hasAttachments && panel === null && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {templates.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className="rounded-full border border-border-strong bg-background px-3 py-1 text-xs font-semibold text-text-2 transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand-text"
              onClick={() => {
                const firstName = conversation.contact.name.split(" ")[0] ?? "";
                setText(t.body.replace(/\{\{\s*1\s*\}\}/g, firstName));
                taRef.current?.focus();
                setTimeout(autogrow, 0);
              }}
              title={t.body}
            >
              {t.name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {hasAttachments && (
        <div
          data-testid="attachment-batch"
          className="mb-2.5 rounded-md border bg-subtle p-2.5"
        >
          <div className="flex gap-2.5 overflow-x-auto pb-1 pt-1.5">
            {attachments.map((a) => (
              <div
                key={a.id}
                data-testid="attachment-tile"
                className="relative shrink-0"
                title={`${a.file.name} · ${formatBytes(a.file.size)}`}
              >
                {a.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.preview}
                    alt={a.file.name}
                    onError={() => dropPreview(a.id)}
                    className="h-16 w-16 rounded-md border bg-background object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border bg-background px-1">
                    <FileText className="h-6 w-6 text-brand" strokeWidth={1.5} />
                    <span className="w-full truncate text-center font-mono text-[9.5px] tracking-[0.04em] text-text-3">
                      {fileBadge(a.file.name)}
                    </span>
                  </div>
                )}
                {!sending && (
                  <button
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Quitar ${a.file.name}`}
                    className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-text-3 shadow-sm transition-colors hover:text-foreground"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
            {!sending && attachments.length < MAX_ATTACHMENTS && (
              <button
                onClick={() => fileRef.current?.click()}
                aria-label="Agregar más adjuntos"
                title="Agregar más adjuntos"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong text-text-3 transition-colors hover:border-brand hover:text-brand"
              >
                <Plus className="h-5 w-5" strokeWidth={1.7} />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p
              className="min-w-0 truncate text-xs text-text-3"
              data-testid="attachment-summary"
            >
              {progress
                ? `Enviando ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…`
                : single
                  ? `${single.file.name} · ${formatBytes(single.file.size)} · el texto de abajo va como pie del adjunto`
                  : `${attachments.length} adjuntos · ${formatBytes(totalBytes)} · salen en orden; el texto de abajo va como pie del primero`}
            </p>
            {!sending && attachments.length > 1 && (
              <button
                onClick={clearAttachments}
                className="shrink-0 text-xs font-medium text-text-2 transition-colors hover:text-foreground"
              >
                Quitar todos
              </button>
            )}
          </div>
        </div>
      )}

      {panel === "location" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Coordenadas o enlace de Google Maps
            <input
              value={coordsRaw}
              onChange={(e) => setCoordsRaw(e.target.value)}
              placeholder="21.019, -101.257"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre del lugar (opcional)
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Oficina AISHIA"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitLocation()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar ubicación
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "contact" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Xavier Pérez"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Teléfono
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+52 462 123 4567"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitContact()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar contacto
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {/* La caja de escritura en píldora, como la del mockup de la landing */}
      <div className="flex items-end gap-2 rounded-[23px] border border-border-strong bg-background py-1.5 pl-2 pr-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files));
            // Sin esto, volver a elegir el mismo archivo no dispara `change`.
            e.target.value = "";
          }}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Adjuntar archivos"
            title="Adjuntar imágenes, videos, audio o documentos (puedes elegir varios o soltarlos sobre el hilo)"
            className="rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "location" ? null : "location")}
            aria-label="Enviar ubicación"
            title="Enviar ubicación"
            className={cn(
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
              panel === "location" && "bg-secondary text-brand"
            )}
          >
            <MapPin className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "contact" ? null : "contact")}
            aria-label="Compartir contacto"
            title="Compartir contacto"
            className={cn(
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
              panel === "contact" && "bg-secondary text-brand"
            )}
          >
            <UserRound className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
        <textarea
          ref={taRef}
          placeholder={
            single
              ? "Pie del adjunto (opcional)…"
              : hasAttachments
                ? "Pie del primer adjunto (opcional)…"
                : "Escribe una respuesta…"
          }
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
          }}
          onPaste={(e) => {
            // Pegar una captura o una imagen copiada la adjunta directo.
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length === 0) return;
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[120px] w-full resize-none self-center bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label="Enviar"
          className={cn(
            "flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-[opacity,background-color] hover:bg-brand-hover",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      {/* En pantallas angostas un error largo ("grande.png: El archivo
          excede…") manda el contador de la ventana al renglón siguiente en
          vez de estrujarse en una columna de tres palabras. */}
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {error ? (
          <p className="min-w-[60%] flex-1 text-xs text-destructive">{error}</p>
        ) : (
          <span />
        )}
        <p className="ml-auto shrink-0 font-mono text-[10.5px] tracking-[0.04em] text-text-3">
          Ventana abierta · quedan {formatRemaining(conversation.windowRemainingMs)}
        </p>
      </div>
    </div>
  );
}
