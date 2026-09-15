import { and, eq } from "drizzle-orm";
import {
  analizarComponentes,
  bloqueoDeMeta,
  countVariables,
  normalizeBody,
  renderBody,
  validateBodyVariables,
  type TemplateComponent,
} from "@/lib/templates";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import {
  describeTemplateError,
  esFaltaDePermiso,
  esNombreDuplicado,
  esWabaDesconocido,
} from "@/lib/meta/template-errors";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  getCredentialsByWabaId,
  markReconnectRequired,
} from "@/server/whatsapp/credentials";
import { callGraphSend, SendError } from "@/server/inbox/send";
import { serializeMessage } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "already_exists"
    | "meta_error"
    | "meta_unavailable";

  constructor(code: TemplateError["code"], message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const TEMPLATE_ERROR_STATUS: Record<TemplateError["code"], number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  already_exists: 409,
  meta_error: 422,
  meta_unavailable: 503,
};

export function templateErrorStatus(err: TemplateError): number {
  return TEMPLATE_ERROR_STATUS[err.code];
}

export { countVariables, renderBody, validateBodyVariables };

type TemplateRow = typeof schema.template.$inferSelect;

export function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    metaStatus: t.metaStatus,
    rejectionReason: t.rejectionReason,
    missingSince: t.missingSince ? t.missingSince.toISOString() : null,
    components: t.components ?? null,
  };
}

/**
 * El estado de Meta tal cual, solo normalizado a mayúsculas.
 *
 * No filtra por una lista de estados conocidos A PROPÓSITO: lo que Meta invente
 * mañana tiene que poder GUARDARSE —para poder nombrarlo en pantalla— y a la
 * vez bloquear el envío, cosa que `esEnviable` consigue exigiendo el APPROVED
 * literal en vez de excluir estados malos uno a uno.
 */
function normalizaMetaStatus(status: string | undefined | null): string | null {
  const s = (status ?? "").trim().toUpperCase();
  return s.length > 0 ? s : null;
}

/**
 * Traducción al ciclo de aprobación del CRM. Devuelve null para lo que no es
 * un paso de ese ciclo (PAUSED, DISABLED…): eso vive en `meta_status`.
 */
function mapMetaStatus(
  status: string | undefined | null
): TemplateRow["status"] | null {
  const s = (status ?? "").trim().toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (
    s === "PENDING" ||
    s === "IN_REVIEW" ||
    s === "IN_APPEAL" ||
    s === "PENDING_DELETION"
  ) {
    return "pending";
  }
  return null;
}

/**
 * Meta manda `rejected_reason: "NONE"` en las que NO están rechazadas, y el
 * motivo real solo tiene sentido cuando el estado es REJECTED. Guardar "NONE"
 * pintaría "Razón del rechazo: NONE" en una plantilla aprobada.
 */
function motivoDeRechazo(
  status: TemplateRow["status"] | null,
  reason: string | null | undefined
): string | null {
  if (status !== "rejected") return null;
  const r = (reason ?? "").trim();
  return r && r.toUpperCase() !== "NONE" ? r : null;
}

/**
 * Tope de espera por llamada de administración de plantillas. Sin él, una
 * llamada colgada a Graph se convierte en un 5xx del proxy (HTML) que la
 * pantalla solo puede mostrar como "No se pudo crear la plantilla": con él,
 * es un 503 con causa ("Meta no respondió a tiempo") y la base no se toca.
 */
const ESPERA_MAXIMA_MS = 30_000;

/** Crea la plantilla y la manda a aprobación de Meta (FR-050, FR-1208..FR-1211). */
export async function createTemplate(
  organizationId: string,
  input: { name: string; language: string; category: string; body: string }
): Promise<TemplateRow> {
  // `{{ 1 }}` → `{{1}}` antes de validar, de mandar y de guardar: Meta solo
  // reconoce la forma pegada, y el cuerpo guardado debe ser el aprobado.
  const body = normalizeBody(input.body);
  if (!body) throw new TemplateError("invalid", "El cuerpo no puede estar vacío");
  const variableError = validateBodyVariables(body);
  if (variableError) throw new TemplateError("invalid", variableError);

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de crear plantillas");
  }

  const name = input.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  // Meta pide un ejemplo por variable: si faltan, rechaza la plantilla.
  const variableCount = countVariables(body);
  const examples = Array.from(
    { length: variableCount },
    (_, i) => `ejemplo ${i + 1}`
  );
  const components: TemplateComponent[] = [
    {
      type: "BODY",
      text: body,
      ...(variableCount > 0 ? { example: { body_text: [examples] } } : {}),
    },
  ];

  let respuesta: { id?: string; status?: string; category?: string };
  try {
    respuesta = await graphRequest(`${creds.wabaId}/message_templates`, {
      method: "POST",
      token: creds.token,
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      body: {
        name,
        language: input.language,
        category: input.category,
        // Sin esto, una UTILITY que Meta clasifica como MARKETING se RECHAZA
        // días después (TAG_CONTENT_MISMATCH). Con esto Meta le pone la
        // categoría que sus reglas dictan y la responde aquí mismo; se guarda
        // la suya, que es la que cobra.
        allow_category_change: true,
        components,
      },
    });
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    if (err.isAuthError) {
      await markReconnectRequired(organizationId);
      throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
    }
    if (err.status === 0 || err.status >= 500) {
      throw new TemplateError(
        "meta_unavailable",
        err.status === 0 ? `${err.message}: vuelve a intentarlo en un momento` : "Meta no está disponible ahora"
      );
    }
    // Sin token ni secretos: código, subcódigo y lo que Meta dijo. Es lo que
    // permite diagnosticar desde los logs de la instancia sin pedirle al
    // dueño que copie la pantalla.
    console.error(
      `[templates] Meta rechazó la creación de «${name}» (${err.codeLabel ?? "sin código"}): ${err.explanation}`
    );
    if (esNombreDuplicado(err)) {
      // Ya existía en Meta —creada allá, o por un intento anterior que no
      // llegó a guardarse aquí—. Se importa tal como está y se explica: un
      // 422 "ya existe" a secas manda al dueño a inventar otro nombre para
      // algo que ya tenía.
      const importada = await importarSiExiste(organizationId, name, input.language);
      throw new TemplateError(
        "already_exists",
        importada
          ? `Ya existe en tu cuenta de Meta una plantilla «${name}» en ${input.language}: la importé tal como está allá y ya aparece en la lista. Si quieres otro texto, ponle otro nombre.`
          : `Ya existe en tu cuenta de Meta una plantilla «${name}» en ${input.language}. Pulsa Sincronizar para traerla, o ponle otro nombre.`
      );
    }
    throw new TemplateError("meta_error", describeTemplateError(err));
  }

  const status = mapMetaStatus(respuesta.status) ?? "pending";
  const metaStatus = normalizaMetaStatus(respuesta.status) ?? "PENDING";
  const category = (respuesta.category ?? input.category).toUpperCase();
  const waTemplateId = respuesta.id ?? null;

  const db = getDb();
  const inserted = await db
    .insert(schema.template)
    .values({
      id: newId("template"),
      organizationId,
      name,
      language: input.language,
      category,
      body,
      status,
      metaStatus,
      rejectionReason: null,
      waTemplateId,
      missingSince: null,
      components,
    })
    .onConflictDoUpdate({
      target: [
        schema.template.organizationId,
        schema.template.name,
        schema.template.language,
      ],
      set: {
        category,
        body,
        status,
        metaStatus,
        rejectionReason: null,
        waTemplateId,
        missingSince: null,
        components,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted[0]!;
}

/** Tras un "already exists": sincroniza y dice si la plantilla quedó local. */
async function importarSiExiste(
  organizationId: string,
  name: string,
  language: string
): Promise<boolean> {
  try {
    await syncTemplates(organizationId);
  } catch (err) {
    console.warn("[templates] no se pudo importar la duplicada:", err);
    return false;
  }
  const db = getDb();
  const rows = await db
    .select({ id: schema.template.id })
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/* ============================================================
 * Sincronización: espejo en tres direcciones (FR-1201..FR-1206)
 * ============================================================ */

/** Una plantilla tal como la devuelve `GET {waba}/message_templates`. */
type PlantillaRemota = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  components?: TemplateComponent[];
};

type PaginaDePlantillas = {
  data?: PlantillaRemota[];
  paging?: { cursors?: { after?: string }; next?: string };
};

/**
 * Campos pedidos explícitamente. Se enumeran en vez de aceptar el default
 * porque el default de Graph cambia entre versiones sin avisar (y no trae
 * `rejected_reason`), y porque un campo mal escrito debe reventar la petición
 * entera (400/código 100) en vez de llegar vacío y hacernos creer que la
 * plantilla no tiene cuerpo.
 */
const CAMPOS_PLANTILLA =
  "id,name,language,status,category,components,rejected_reason";

/**
 * Tope de páginas. No es un límite de producto: es el seguro contra un cursor
 * que no avanza. Si se alcanza, la lista está INCOMPLETA y eso se reporta como
 * fallo — nunca como una sincronización correcta.
 */
const MAX_PAGINAS = 200;

/**
 * Igualdad de componentes SIN depender del orden de las llaves: Postgres
 * reordena las de un `jsonb` al guardarlo, así que comparar el JSON tal cual
 * marcaba "cambió" en cada sync y la idempotencia se rompía sin que nada
 * hubiera cambiado.
 */
function canon(value: unknown): string {
  return JSON.stringify(ordenar(value));
}

function ordenar(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordenar);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, ordenar(obj[k])])
    );
  }
  return value;
}

/** El cuerpo vive en el componente BODY; el resto se conserva en `components`. */
function cuerpoDe(remota: PlantillaRemota): string {
  const body = remota.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "BODY"
  );
  return body?.text ?? "";
}

/**
 * Recorre TODAS las páginas de `GET {waba}/message_templates`.
 *
 * Graph sirve 25 por página y señala continuación con `paging.next`. Quien lea
 * solo `data` se lleva las primeras 25 y cree que son todas: sin error y sin
 * aviso. Aquí se sigue el CURSOR (`paging.cursors.after`), no la URL absoluta
 * de `paging.next`, por dos razones: `graphRequest` sigue siendo la única
 * frontera de salida hacia Meta (Principio II), y no se navega a una URL que
 * viene en la respuesta de un tercero.
 *
 * A propósito no se pide `limit`: con el tamaño de página por defecto el código
 * ejercita la paginación de verdad en cuanto hay más de 25 plantillas.
 */
async function traerTodasLasPlantillas(
  wabaId: string,
  token: string
): Promise<PlantillaRemota[]> {
  const todas: PlantillaRemota[] = [];
  let after: string | undefined;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const query = new URLSearchParams({ fields: CAMPOS_PLANTILLA });
    if (after) query.set("after", after);
    const res = await graphRequest<PaginaDePlantillas>(
      `${wabaId}/message_templates?${query.toString()}`,
      { token, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) }
    );
    todas.push(...(res.data ?? []));

    if (!res.paging?.next) return todas;

    const siguiente = res.paging.cursors?.after;
    if (!siguiente || siguiente === after) {
      // Meta dice que hay más pero no da con qué pedirlo. Devolver lo que
      // llevamos sería presentar una lista parcial como si fuera completa.
      throw new TemplateError(
        "meta_unavailable",
        "Meta devolvió la lista de plantillas a medias. Vuelve a intentarlo en un momento."
      );
    }
    after = siguiente;
  }

  throw new TemplateError(
    "meta_unavailable",
    "La lista de plantillas de Meta no terminó de paginar. Vuelve a intentarlo en un momento."
  );
}

/** Lo que cambió en una pasada de sincronización. */
export type ResumenDeSync = {
  /** Filas existentes cuyo estado, categoría, motivo o componentes cambiaron. */
  updated: number;
  /** Plantillas que estaban en Meta y no en la base: ahora sí están. */
  imported: number;
  /** Filas locales que Meta ya no lista: marcadas ausentes, nunca borradas. */
  missing: number;
};

/**
 * Sincroniza plantillas desde Graph. Cubre el modo agencia: los webhooks de
 * plantillas NO siguen el override de callback, así que el pull es la vía
 * universal (DV-VC-04/DV-VC-15).
 *
 * Meta es la AUTORIDAD sobre qué plantillas existen y en qué estado, así que
 * esto es un espejo en tres direcciones, no solo un actualizador de estados:
 * importa lo que falta, actualiza lo que cambió y marca lo que desapareció.
 */
export async function syncTemplates(
  organizationId: string
): Promise<ResumenDeSync> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }

  let remotas: PlantillaRemota[];
  try {
    remotas = await traerTodasLasPlantillas(creds.wabaId, creds.token);
  } catch (err) {
    if (err instanceof TemplateError) throw err;
    if (!(err instanceof MetaApiError)) throw err;
    if (err.isAuthError) {
      await markReconnectRequired(organizationId);
      throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
    }
    if (err.status === 0 || err.status >= 500) {
      throw new TemplateError(
        "meta_unavailable",
        err.status === 0
          ? `${err.message}: lo que ves es la última copia local`
          : "Meta no está disponible ahora: lo que ves es la última copia local"
      );
    }
    console.error(
      `[templates] Graph rechazó la lista de plantillas (${err.codeLabel ?? "sin código"}): ${err.explanation}`
    );
    if (esFaltaDePermiso(err) || esWabaDesconocido(err)) {
      // Fallo de la CONEXIÓN guardada, no de Meta: no lo arregla reintentar.
      throw new TemplateError("meta_error", describeTemplateError(err));
    }
    if (err.status === 400 && err.code === 100) {
      // Fallo NUESTRO: pedimos un campo que el nodo no tiene. Se distingue
      // del resto porque no lo arregla ni reintentar ni reconectar.
      throw new TemplateError(
        "meta_unavailable",
        `No se pudo leer la lista de plantillas de Meta: la app pidió algo que Graph no reconoce (${err.explanation}). Es un problema del CRM, no de tu cuenta.`
      );
    }
    throw new TemplateError("meta_unavailable", describeTemplateError(err));
  }

  const db = getDb();
  const local = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));

  /* ---------- Emparejamiento en DOS pasadas ----------
   *
   * Un `find` con `||` devuelve la primera coincidencia sin comprobar
   * unicidad, así que una fila ya reclamada por su `waTemplateId` podía
   * volver a casar por nombre+idioma con OTRA remota y acabar sobrescrita.
   * Primero se agotan las coincidencias por id —la llave fuerte, la que
   * asigna Meta— y solo después se empareja por nombre+idioma sobre lo que
   * quedó libre.
   */
  const sinReclamar = new Set(local.map((t) => t.id));
  const emparejadas: { remota: PlantillaRemota; fila: TemplateRow }[] = [];

  const porWaId = new Map<string, TemplateRow>();
  for (const t of local) if (t.waTemplateId) porWaId.set(t.waTemplateId, t);

  const huerfanas: PlantillaRemota[] = [];
  for (const remota of remotas) {
    const fila = remota.id ? porWaId.get(remota.id) : undefined;
    if (fila && sinReclamar.has(fila.id)) {
      sinReclamar.delete(fila.id);
      emparejadas.push({ remota, fila });
    } else {
      huerfanas.push(remota);
    }
  }

  const porNombre = new Map<string, TemplateRow>();
  for (const t of local) {
    if (sinReclamar.has(t.id)) porNombre.set(`${t.name}|${t.language}`, t);
  }

  const aImportar: PlantillaRemota[] = [];
  for (const remota of huerfanas) {
    const fila = porNombre.get(`${remota.name}|${remota.language}`);
    if (fila && sinReclamar.has(fila.id)) {
      sinReclamar.delete(fila.id);
      emparejadas.push({ remota, fila });
    } else {
      aImportar.push(remota);
    }
  }

  let updated = 0;
  for (const { remota, fila } of emparejadas) {
    // Un estado que no sabemos traducir no toca el ENUM local —preferimos
    // dejarlo como está a inventarle una etiqueta— pero SÍ se guarda crudo en
    // `metaStatus`, que es lo que manda sobre el envío.
    const status = mapMetaStatus(remota.status);
    if (!status) {
      console.warn(
        `[templates] estado de Meta no traducible a insignia: "${remota.status}" ` +
          `en ${remota.name} — se guarda crudo y bloquea el envío`
      );
    }
    const metaStatus = normalizaMetaStatus(remota.status);
    // Meta reclasifica la categoría al aprobar (una UTILITY puede volverse
    // MARKETING, lo que cambia el costo por conversación): es autoridad.
    const category = remota.category?.toUpperCase() ?? fila.category;
    const nuevoStatus = status ?? fila.status;
    const rejectionReason = motivoDeRechazo(nuevoStatus, remota.rejected_reason);
    const waTemplateId = remota.id ?? fila.waTemplateId ?? null;
    // El cuerpo lo escribe Meta también: una editada en el Administrador de
    // WhatsApp debe verse aquí con el texto que de verdad se manda.
    const body = cuerpoDe(remota) || fila.body;
    const components = remota.components ?? fila.components ?? null;

    const igual =
      fila.status === nuevoStatus &&
      fila.metaStatus === metaStatus &&
      fila.category === category &&
      fila.rejectionReason === rejectionReason &&
      fila.waTemplateId === waTemplateId &&
      fila.body === body &&
      canon(fila.components ?? null) === canon(components) &&
      fila.missingSince === null;
    if (igual) continue;

    await db
      .update(schema.template)
      .set({
        status: nuevoStatus,
        metaStatus,
        category,
        rejectionReason,
        waTemplateId,
        body,
        components,
        // Reapareció en Meta: deja de estar ausente.
        missingSince: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.template.id, fila.id));
    updated += 1;
  }

  let imported = 0;
  for (const remota of aImportar) {
    // Sin nombre o idioma no hay llave con la que guardarla.
    if (!remota.name || !remota.language) {
      console.warn("[templates] remota sin nombre o idioma, no se importa:", remota.id);
      continue;
    }
    // De una plantilla que vemos por primera vez solo afirmamos lo que Meta
    // afirma: si su estado no se reconoce, entra como pendiente (no
    // enviable), nunca como aprobada.
    const status = mapMetaStatus(remota.status) ?? ("pending" as const);
    const values = {
      organizationId,
      name: remota.name,
      language: remota.language,
      category: remota.category?.toUpperCase() ?? "UTILITY",
      body: cuerpoDe(remota),
      status,
      metaStatus: normalizaMetaStatus(remota.status),
      rejectionReason: motivoDeRechazo(status, remota.rejected_reason),
      waTemplateId: remota.id ?? null,
      missingSince: null,
      components: remota.components ?? null,
    };
    // `onConflictDoUpdate` sobre la MISMA llave única que usa createTemplate:
    // re-sincronizar no puede duplicar ni reventar (Principio IV).
    await db
      .insert(schema.template)
      .values({ id: newId("template"), ...values })
      .onConflictDoUpdate({
        target: [
          schema.template.organizationId,
          schema.template.name,
          schema.template.language,
        ],
        set: { ...values, updatedAt: new Date() },
      });
    imported += 1;
  }

  let missing = 0;
  for (const fila of local) {
    if (!sinReclamar.has(fila.id)) continue;
    // Un borrador nunca llegó a Meta: que no esté allí no es una ausencia.
    if (fila.status === "draft") continue;
    if (fila.missingSince) continue;
    // NO se borra: los mensajes ya enviados la referencian y el historial de la
    // conversación no puede quedarse sin el texto que se mandó.
    await db
      .update(schema.template)
      .set({ missingSince: new Date(), updatedAt: new Date() })
      .where(eq(schema.template.id, fila.id));
    missing += 1;
  }

  return { updated, imported, missing };
}

/** Evento webhook `message_template_status_update` (modo directo, FR-050). */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  if (!wabaId) return;
  const creds = await getCredentialsByWabaId(wabaId);
  if (!creds) return;

  const status = mapMetaStatus(value.event);
  const metaStatus = normalizaMetaStatus(value.event);
  const name = value.message_template_name;
  const language = value.message_template_language;
  // Sin nombre o idioma no hay a qué fila aplicarlo. El ESTADO, en cambio, ya
  // no puede faltar para seguir: un evento PAUSED salía por aquí y no tocaba
  // nada, así que la plantilla se quedaba `approved` y enviable. Importa
  // porque el webhook llega en segundos mientras que el sync espera a que
  // alguien lo pulse.
  if (!metaStatus || !name || !language) return;

  const db = getDb();
  await db
    .update(schema.template)
    .set({
      // El enum solo se mueve si el estado es traducible; `metaStatus` siempre.
      ...(status ? { status } : {}),
      metaStatus,
      ...(status ? { rejectionReason: motivoDeRechazo(status, value.reason) } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.template.organizationId, creds.organizationId),
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    );
}

/** Envía una plantilla APROBADA a una conversación (ventana cerrada, FR-051). */
export async function sendTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variables?: string[];
}): Promise<{ messageId: string }> {
  const db = getDb();

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");
  if (template.status !== "approved") {
    throw new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas");
  }
  if (template.missingSince) {
    // Meta ya no la lista: intentarlo devolvería un error suyo sin explicación
    // útil. Se dice aquí, con la causa y la salida.
    throw new TemplateError(
      "invalid",
      "Esta plantilla ya no existe en tu cuenta de Meta. Vuelve a crearla en el Administrador de WhatsApp o desde Plantillas."
    );
  }
  // El estado CRUDO de Meta manda sobre el envío. Es la última barrera y la
  // que cuenta: la UI ya no la ofrece, pero esta ruta también la alcanzan el
  // bot API y cualquier cliente que mande el id a mano.
  const bloqueo = bloqueoDeMeta(template);
  if (bloqueo) {
    throw new TemplateError("invalid", `${bloqueo.etiqueta}. ${bloqueo.explicacion}`);
  }
  // Una importada con encabezado multimedia, botones dinámicos o variables
  // con nombre: Meta exigiría parámetros que este CRM no rellena (132000).
  const requisito = analizarComponentes(template.components, template.body).requisito;
  if (requisito) throw new TemplateError("invalid", requisito);

  // Meta exige EXACTAMENTE un parámetro por variable del cuerpo: si sobran o
  // falta alguno responde 132000 (plantilla y parámetros no coinciden).
  const variableCount = countVariables(template.body);
  const values = (input.variables ?? [])
    .slice(0, variableCount)
    .map((v) => v.trim());
  if (values.length < variableCount || values.some((v) => !v)) {
    const missing = values.findIndex((v) => !v);
    const n = missing === -1 ? values.length + 1 : missing + 1;
    throw new TemplateError(
      "invalid",
      variableCount === 1
        ? "La plantilla requiere el valor de {{1}}"
        : `La plantilla requiere ${variableCount} valores: falta {{${n}}}`
    );
  }

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TemplateError("not_found", "Conversación no encontrada");
  if (row.conversation.isTest) {
    // Aserción dura del sandbox (FR-031)
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) throw new TemplateError("not_connected", "Sin número conectado");
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta el número");
  }

  // 003: destinatario = teléfono normalizado o BSUID.
  const templateRecipient = row.contact.phone
    ? normalizeRecipient(row.contact.phone)
    : row.contact.waUserId;
  if (!templateRecipient) {
    throw new TemplateError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  const waMessageId = await callGraphSend(creds, {
    messaging_product: "whatsapp",
    to: templateRecipient,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(variableCount > 0
        ? {
            components: [
              {
                type: "body",
                parameters: values.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "template",
      text: renderBody(template.body, values),
      status: "pending",
      origin: "template",
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}
