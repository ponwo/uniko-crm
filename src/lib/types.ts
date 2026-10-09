/** DTOs que viajan por la API interna (lado cliente). */

import type { Channel } from "@/lib/channels";
import type { TemplateComponent } from "@/lib/templates";

export type ConversationDto = {
  id: string;
  /** 014: canal de la conversacion, para el distintivo de la bandeja. */
  channel: Channel;
  contact: { id: string; name: string; phone: string | null };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  /**
   * 031 — Solo se le puede escribir con una plantilla aprobada: su canal la
   * exige fuera de ventana (WhatsApp) y la ventana está cerrada. En Instagram
   * y Messenger es siempre false: ahí la ventana cerrada no bloquea.
   */
  templateRequired: boolean;
  preview: string | null;
  /** 034: el anuncio que abrió la conversación, para la marca de la lista. */
  anuncio: {
    headline: string | null;
    sourceId: string | null;
    /** `post` si fue una publicación y no un anuncio. */
    sourceType: string | null;
  } | null;
};

/** 034 — De qué anuncio llegó un contacto, como lo ve la bandeja. */
export type AnuncioDto = {
  sourceId: string | null;
  sourceType: string | null;
  /** Solo https. */
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  /** Imagen del creativo, servida por `/api/media/{id}`. */
  imageAssetId: string | null;
  /** Si Meta mandó identificador de clic. El valor no sale del servidor. */
  hasCtwaClid: boolean;
  capturedAt: string;
};

/** 008 — Adjunto de un mensaje, para previsualización en el hilo. */
export type MessageMediaDto = {
  assetId: string;
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contacts";
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  caption: string | null;
  fetchStatus: "available" | "pending" | "failed";
  /** location {latitude, longitude, name?, address?} / contacts (subset). */
  payload: unknown;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  /** Motivo del fallo en lenguaje llano cuando status = "failed". */
  error: string | null;
  aiGenerated: boolean;
  /** 008 — Origen del saliente (en entrantes viene 'operator' y se ignora). */
  origin: "ai" | "operator" | "manual" | "template";
  media: MessageMediaDto | null;
  createdAt: string;
};

export type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  /** Ciclo de aprobación de este CRM. Es lo que la insignia pinta. */
  status: "draft" | "pending" | "approved" | "rejected";
  /**
   * 027 — Estado LITERAL de Meta, sin traducir, y autoridad sobre el envío.
   * Viaja al cliente porque la pantalla y el selector deciden con él
   * (`esEnviable` es la MISMA función en las dos orillas). No es un secreto:
   * es lo que Meta ya le dice al dueño en su Administrador de WhatsApp.
   * null = todavía sin noticias de Meta, que también bloquea.
   */
  metaStatus: string | null;
  rejectionReason: string | null;
  /** 027 — ISO del momento en que Meta dejó de listarla; null = sigue en Meta. */
  missingSince: string | null;
  /** 027 — Componentes crudos de Meta (null en las creadas aquí sin sync). */
  components: TemplateComponent[] | null;
};

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

/** Un dato de la ficha. Escalar a propósito: ver `server/bot/ficha`. */
export type FichaValue = string | number | boolean;

/**
 * Ficha de calificación del lead. Claves libres: cada negocio califica
 * distinto, así que las define quien pregunta —el agente o el dueño— y el CRM
 * no las cablea.
 */
export type FichaDto = Record<string, FichaValue>;

export type ContactDto = {
  id: string;
  name: string;
  /**
   * 031 — Su canal permite escribirle primero (con plantilla): solo WhatsApp.
   * A uno de Instagram o Messenger se le responde desde la Bandeja.
   */
  canWriteFirst: boolean;
  /** null en contactos que llegaron solo con BSUID (003). */
  phone: string | null;
  notes: string | null;
  /** Etapa del embudo del lead asociado; null si el contacto no tiene lead. */
  stageName: string | null;
  archivedAt: string | null;
  /** De dónde salió el prospecto, capturada o deducida. */
  source?: SourceDto;
  /** Prioridad del lead asociado; null si nadie la fijó. */
  priority?: PriorityValue | null;
  /** Lo que se sabe del lead. `{}` mientras nadie haya calificado. */
  ficha?: FichaDto;
};

/* ============================================================
 * Bitácora de etapas
 * ============================================================ */

/** Por qué se perdió un trato. Lista corta a propósito: una taxonomía larga
 *  se responde "otro" y deja de informar. */
export type LossReason =
  | "precio"
  | "no_es_perfil"
  | "sin_presupuesto"
  | "eligio_otro"
  | "nunca_contesto"
  | "otro";

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  precio: "Le pareció caro",
  no_es_perfil: "No era el perfil",
  sin_presupuesto: "Sin presupuesto ahora",
  eligio_otro: "Se fue con otro",
  nunca_contesto: "Nunca contestó",
  otro: "Otro",
};

/** Quién provocó un movimiento de etapa. */
export type StageChangeSource = "dueno" | "bot" | "sistema" | "migracion";

/* ============================================================
 * Fuente del prospecto
 * ============================================================ */

export type SourceValue =
  | "anuncio"
  | "organico"
  | "referido"
  | "conocido"
  | "otro";

export type SourceDto = {
  /** "desconocida" cuando nadie la capturó y no se pudo deducir. */
  value: SourceValue | "desconocida";
  /** `deducida` = la infirió el sistema; `capturada` = la puso el dueño. */
  source: "capturada" | "deducida";
};

/* ============================================================
 * Prioridad del lead
 * ============================================================ */

/** La fija el dueño; NULL = nadie la ha decidido (no es "media"). */
export type PriorityValue = "alta" | "media" | "baja";
