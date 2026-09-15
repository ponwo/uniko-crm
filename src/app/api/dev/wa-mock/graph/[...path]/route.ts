import { mockGuard } from "@/lib/dev-guard";
import {
  allMockTemplates,
  getWaMockState,
  nextN,
  nextOutboundWamid,
  nextTemplateId,
  templatesOf,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

/**
 * Imitación de la Graph API (contrato mocks.md). El cliente real apunta aquí
 * cuando META_GRAPH_BASE_URL = <app>/api/dev/wa-mock/graph — el código de
 * producción no sabe que habla con un mock.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

/** 016 — Catálogo cerrado de Meta para `business_messaging` (mismo que el real). */
const CAPI_EVENT_NAMES = new Set([
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "CartAbandoned",
  "RatingProvided",
  "ReviewProvided",
]);

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function invalidTokenResponse(): Response {
  return Response.json(
    {
      error: {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
        fbtrace_id: "mock",
      },
    },
    { status: 401 }
  );
}

/** Quita el segmento de versión (v25.0/...) si viene en la ruta. */
function normalizePath(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

/* ---------- 027 — Fidelidad del mock: plantillas ----------
 *
 * Un mock que responde lo que nos conviene no prueba nada, MIENTE. Tres cosas
 * que la Graph API real hace y un mock permisivo se salta:
 *
 * 1. Valida el `fields=` y rechaza la petición ENTERA (400/100) si pide un
 *    campo que el nodo no tiene: los campos buenos se pierden con el malo.
 * 2. Pagina por cursor, 25 por página. Quien lea solo `data` se lleva las
 *    primeras 25 y cree que son todas, sin error y sin aviso.
 * 3. Valida de forma SÍNCRONA al crear, y responde siempre "(#100) Invalid
 *    parameter" en `message` con la causa en `error_subcode` y
 *    `error_user_msg`. Si el mock no lo replica, el CRM nunca ejercita la
 *    traducción de esos errores.
 */

/** Campos documentados del edge message_templates (v26.0). */
const CAMPOS_PLANTILLA = new Set([
  "id", "name", "status", "category", "language", "components",
  "rejected_reason", "quality_score", "previous_category",
  "correct_category", "sub_category", "message_send_ttl_seconds",
  "parameter_format", "library_template_name", "cta_url_link_tracking_opted_out",
]);

/** Réplica del rechazo real de Graph ante un campo que el nodo no tiene. */
function campoInexistente(req: Request, conocidos: Set<string>, nodo: string): Response | null {
  const fields = new URL(req.url).searchParams.get("fields");
  if (!fields) return null;
  const malo = fields
    .split(",")
    .map((f) => f.trim().split("(")[0]!.trim())
    .filter(Boolean)
    .find((f) => !conocidos.has(f));
  if (!malo) return null;
  return Response.json(
    {
      error: {
        message: `(#100) Tried accessing nonexisting field (${malo}) on node type (${nodo})`,
        type: "OAuthException",
        code: 100,
        fbtrace_id: "mock",
      },
    },
    { status: 400 }
  );
}

/**
 * Los cursores de Meta son OPACOS (base64 de su estado interno). Aquí también
 * lo son a propósito: si el mock devolviera el índice en claro, alguien
 * acabaría calculándolo en vez de seguir el cursor, y contra Meta real eso no
 * funciona.
 */
const PAGINA_POR_DEFECTO = 25;

function codificarCursor(indice: number): string {
  return Buffer.from(`mock:${indice}`).toString("base64url");
}

function decodificarCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const crudo = Buffer.from(cursor, "base64url").toString("utf8");
  const n = Number(crudo.startsWith("mock:") ? crudo.slice(5) : NaN);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Envuelve una colección como lo hace Graph: `data` con la página, y `paging`
 * con los cursores. `next` SOLO aparece si queda algo detrás — es la señal que
 * distingue "esto es todo" de "hay más y tienes que ir por ello".
 */
function paginar<T>(req: Request, todos: T[]): { data: T[]; paging: unknown } {
  const url = new URL(req.url);
  const pedido = Number(url.searchParams.get("limit"));
  const limite =
    Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 100) : PAGINA_POR_DEFECTO;
  const desde = decodificarCursor(url.searchParams.get("after"));
  const pagina = todos.slice(desde, desde + limite);
  const hasta = desde + pagina.length;
  const hayMas = hasta < todos.length;

  const siguiente = new URL(url);
  siguiente.searchParams.set("limit", String(limite));
  siguiente.searchParams.set("after", codificarCursor(hasta));

  return {
    data: pagina,
    paging: {
      cursors: {
        before: codificarCursor(desde),
        after: codificarCursor(hasta),
      },
      ...(hayMas ? { next: siguiente.toString() } : {}),
    },
  };
}

/**
 * Meta caído, con la forma real del incidente 2026-08-03: un 5xx que además
 * viene etiquetado `OAuthException` (código 2, "service temporarily
 * unavailable"). Lo produce un WABA cuyo id termina en `-caido`, para que el
 * arnés pueda comprobar que el CRM no lo confunde con un token vencido ni lo
 * disfraza de "Todo al día".
 */
function metaCaido(wabaId: string): Response | null {
  if (!wabaId.endsWith("-caido")) return null;
  return Response.json(
    {
      error: {
        message: "Service temporarily unavailable",
        type: "OAuthException",
        code: 2,
        is_transient: true,
        fbtrace_id: "mock",
      },
    },
    { status: 503 }
  );
}

/**
 * Error de validación de plantilla con la forma REAL de Meta: `message`
 * genérico, causa en `error_subcode`/`error_user_title`/`error_user_msg`.
 */
function rechazoDePlantilla(subcode: number, title: string, msg: string): Response {
  return Response.json(
    {
      error: {
        message: "(#100) Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: subcode,
        is_transient: false,
        error_user_title: title,
        error_user_msg: msg,
        fbtrace_id: "mock",
      },
    },
    { status: 400 }
  );
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // GET {wabaId}/message_templates → lista para el sync.
  // Filtrada por el WABA de la ruta y paginada como Graph: son las dos cosas
  // que un mock permisivo se salta y producción no perdona.
  if (path.length === 2 && path[1] === "message_templates") {
    const caido = metaCaido(path[0]!);
    if (caido) return caido;
    const malo = campoInexistente(req, CAMPOS_PLANTILLA, "WhatsAppBusinessAccount");
    if (malo) return malo;
    const todas = templatesOf(path[0]!).map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components ?? [{ type: "BODY", text: t.body }],
      // Como Meta: "NONE" en las que no están rechazadas.
      rejected_reason:
        t.status === "REJECTED" ? (t.rejectedReason ?? "INVALID_FORMAT") : "NONE",
    }));
    return Response.json(paginar(req, todas));
  }

  // GET {mediaId} (ids "media...") → metadata de adjunto (media proxy del bot)
  if (path.length === 1 && path[0]!.startsWith("media")) {
    const origin = new URL(req.url).origin;
    return Response.json({
      id: path[0],
      mime_type: path[0]!.includes("pdf") ? "application/pdf" : "image/jpeg",
      file_size: 13,
      url: `${origin}/api/dev/wa-mock/media-file/${path[0]}`,
    });
  }

  // 017 — GET {psid}?fields=first_name,last_name → perfil de quien escribe
  // por Messenger (la ingesta lo consulta la primera vez que ve un PSID).
  const fields = new URL(req.url).searchParams.get("fields") ?? "";
  if (path.length === 1 && fields.includes("first_name")) {
    return Response.json({
      id: path[0],
      first_name: "Cliente",
      last_name: "de Messenger",
    });
  }

  // 017 — GET {pageId}?fields=id,name → validación de la página de Facebook
  if (path.length === 1 && /(^|,)name(,|$)/.test(fields)) {
    return Response.json({ id: path[0], name: "Página de prueba Uniko" });
  }

  // GET {phoneNumberId}?fields=... → validación del wizard
  if (path.length === 1) {
    return Response.json({
      display_phone_number: "+52 55 0000 0000",
      verified_name: "Número de prueba Uniko",
      id: path[0],
    });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // POST {phoneNumberId}/media (multipart, 008) → id de media subido.
  // Va ANTES del parseo JSON: el body es form-data.
  if (path.length === 2 && path[1] === "media") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: { message: "missing file", type: "GraphMethodException", code: 100 } },
        { status: 400 }
      );
    }
    // El id arranca con "media" para que el GET de metadata lo resuelva.
    return Response.json({ id: `media-up-${nextN()}` });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 016 — POST {datasetId}/events: Conversions API. Imita las tres cosas que
  // de verdad importan del endpoint real: el catálogo cerrado de nombres, la
  // exigencia del ctwa_clid, y —sobre todo— que Meta puede responder 200
  // DESCARTANDO el evento. Los datasets terminados en "-fail" reproducen eso
  // último, que es el modo de fallo que nadie ve venir.
  if (path.length === 2 && path[1] === "events") {
    const state = getWaMockState();
    const events = Array.isArray(body.data)
      ? (body.data as Record<string, unknown>[])
      : [];
    const event = events[0];
    const eventName = String(event?.event_name ?? "");
    const userData = (event?.user_data ?? {}) as Record<string, unknown>;
    const ctwaClid = userData.ctwa_clid ? String(userData.ctwa_clid) : null;

    if (!CAPI_EVENT_NAMES.has(eventName)) {
      return Response.json(
        {
          error: {
            message: `(#100) Invalid parameter: event_name ${eventName || "(vacío)"}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock-capi-badname",
          },
        },
        { status: 400 }
      );
    }
    if (!ctwaClid) {
      return Response.json(
        {
          error: {
            message: "Messaging Event Invalid Ctwa Clid",
            type: "GraphMethodException",
            code: 100,
            error_subcode: 2804087,
            fbtrace_id: "mock-capi-noclid",
          },
        },
        { status: 400 }
      );
    }

    const datasetId = path[0]!;
    state.capiEvents.push({
      n: nextN(),
      datasetId,
      eventName,
      ctwaClid,
      customData:
        (event?.custom_data as Record<string, unknown> | undefined) ?? null,
      body,
      at: new Date().toISOString(),
    });

    // El 200 mentiroso: recibido por HTTP, descartado por Meta.
    const received = datasetId.endsWith("-fail") ? 0 : 1;
    return Response.json({
      events_received: received,
      messages: [],
      fbtrace_id: `mock-capi-${state.capiEvents.length}`,
    });
  }

  // POST {phoneNumberId}/messages con status:"read" → typing/leído:
  // NO es un mensaje saliente — no contamina el outbox.
  if (path.length === 2 && path[1] === "messages" && body.status === "read") {
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/messages → registra en el outbox
  if (path.length === 2 && path[1] === "messages") {
    const state = getWaMockState();
    // Meta responde 132000 si los parámetros no cuadran con las {{n}} de la
    // plantilla aprobada. El mock lo replica para que un desfase no pase.
    if (body.type === "template") {
      const tplSend = body.template as
        | {
            name?: string;
            components?: { type?: string; parameters?: unknown[] }[];
          }
        | undefined;
      const known = allMockTemplates().find((t) => t.name === tplSend?.name);
      if (known) {
        const expected = [...known.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce(
          (max, m) => Math.max(max, Number(m[1])),
          0
        );
        const got =
          tplSend?.components?.find(
            (c) => (c.type ?? "").toLowerCase() === "body"
          )?.parameters?.length ?? 0;
        if (expected !== got) {
          return Response.json(
            {
              error: {
                message: `(#132000) Number of parameters does not match the expected number of params: expected ${expected}, got ${got}`,
                type: "OAuthException",
                code: 132000,
                fbtrace_id: "mock",
              },
            },
            { status: 400 }
          );
        }
      }
    }
    // 026 — Imagen por link (foto del producto): el modo infeliz del mock
    // reproduce a Meta rechazando el link o tardando más de lo que el motor
    // espera. Como Meta, en `slow` el mensaje SÍ queda registrado aunque el
    // CRM ya haya cortado la espera.
    const link = (body.image as { link?: unknown } | undefined)?.link;
    if (body.type === "image" && typeof link === "string") {
      if (state.mediaMode === "reject") {
        return Response.json(
          {
            error: {
              message: "(#100) Param image['link'] is not a valid URL",
              type: "OAuthException",
              code: 100,
              fbtrace_id: "mock",
            },
          },
          { status: 400 }
        );
      }
      if (state.mediaMode === "slow") {
        await new Promise((r) => setTimeout(r, 7_000));
      }
    }
    const n = nextN();
    const waMessageId = nextOutboundWamid();
    state.outbox.push({
      n,
      waMessageId,
      phoneNumberId: path[0]!,
      to: String(body.to ?? ""),
      type: String(body.type ?? "text"),
      body,
      at: new Date().toISOString(),
    });
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: waMessageId }],
    });
  }

  // POST {wabaId}/message_templates → alta de plantilla (queda PENDING).
  // Replica las validaciones SÍNCRONAS de Meta, con su forma de error real.
  if (path.length === 2 && path[1] === "message_templates") {
    const caido = metaCaido(path[0]!);
    if (caido) return caido;
    const bolsa = templatesOf(path[0]!);
    const components = (body.components ?? []) as {
      type?: string;
      text?: string;
      example?: { body_text?: string[][] };
    }[];
    const bodyComponent = components.find(
      (c) => (c.type ?? "").toUpperCase() === "BODY"
    );
    const texto = bodyComponent?.text ?? "";
    // Meta solo reconoce `{{n}}` pegado: `{{ n }}` es texto para ella.
    const variables = [...texto.matchAll(/\{\{(\d+)\}\}/g)];
    // Meta valida que haya un ejemplo por cada {{n}} del cuerpo: sin esto el
    // mock aceptaría plantillas que producción rechaza (error 100).
    const highestVar = variables.reduce((max, m) => Math.max(max, Number(m[1])), 0);
    const examples = bodyComponent?.example?.body_text?.[0] ?? [];
    if (highestVar !== examples.length) {
      return Response.json(
        {
          error: {
            message: `Invalid parameter: expected ${highestVar} example value(s) for the body, got ${examples.length}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    // 2388299 — variable al inicio, al final o dos pegadas.
    if (
      /^\{\{\d+\}\}/.test(texto.trim()) ||
      /\{\{\d+\}\}$/.test(texto.trim()) ||
      /\{\{\d+\}\}\s*\{\{\d+\}\}/.test(texto)
    ) {
      return rechazoDePlantilla(
        2388299,
        "Variables cannot be at the start or end of the template",
        "The body text cannot start or end with a variable, and variables cannot be adjacent to each other."
      );
    }
    // Rechazo forzado para probar la TRADUCCIÓN de un subcódigo que el CRM no
    // valida localmente (la proporción variables/texto no es pública).
    if (texto.includes("[meta-rechaza]")) {
      return rechazoDePlantilla(
        2388293,
        "Template content contains too many variable parameters",
        "This template contains too many variable parameters relative to the message length. You need to decrease the number of variable parameters or increase the message length."
      );
    }
    // Nombre repetido dentro del mismo idioma: Meta lo rechaza, no lo pisa.
    const name = String(body.name ?? "");
    const language = String(body.language ?? "es_MX");
    if (bolsa.some((t) => t.name === name && t.language === language)) {
      return Response.json(
        {
          error: {
            message: "(#100) Invalid parameter",
            type: "OAuthException",
            code: 100,
            is_transient: false,
            error_user_title: "Message Template Name Already Exists",
            error_user_msg:
              "Message template with the same name and language already exists.",
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    const tpl: MockTemplate = {
      id: nextTemplateId("tplmock"),
      name,
      language,
      category: String(body.category ?? "UTILITY"),
      status: "PENDING",
      body: texto,
      components,
    };
    bolsa.push(tpl);
    return Response.json({ id: tpl.id, status: "PENDING", category: tpl.category });
  }

  // POST {wabaId}/subscribed_apps → suscripción (con o sin override)
  if (path.length === 2 && path[1] === "subscribed_apps") {
    return Response.json({ success: true });
  }

  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  await ctx.params;
  return Response.json({ success: true });
}
