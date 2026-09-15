/**
 * Self-test E2E de comportamiento — plantillas: espejo de Meta y errores con
 * causa (guion tests/e2e/us6-templates.md, secciones "modo agencia" y "027").
 *
 * Reproduce dos fallos vistos en producción:
 *  - Meta aprobó una plantilla y la reclasificó de UTILITY a MARKETING, pero
 *    el CRM la seguía mostrando "Pendiente de Meta" porque el webhook
 *    `message_template_status_update` se entrega al callback A NIVEL APP (que
 *    en modo agencia no es el de esta instancia). El único camino es el pull.
 *  - Las plantillas creadas en el Administrador de WhatsApp nunca aparecían, y
 *    crear desde el CRM fallaba con "(#100) Invalid parameter" sin causa.
 *
 * Uso: node --env-file=.env scripts/e2e-templates-sync.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const PN = "PN-TPL-1";
const WABA = "WABA-TPL";
const stamp = Date.now().toString(36);

async function findTemplate(name) {
  const { json } = await api("/api/templates");
  return (json?.templates ?? []).find((t) => t.name === name);
}

/**
 * Espejo DELIBERADO de `esEnviable` de `lib/templates` (027).
 *
 * Se reimplementa aquí en vez de importarla —un `.mjs` no carga TypeScript—
 * y eso además es lo correcto: lo que este arnés comprueba es que el DTO que
 * viaja al cliente lleve lo suficiente para decidir. Si mañana el servidor
 * dejara de mandar `metaStatus`, esta copia lo delata; una importación lo
 * escondería. (La cuarta condición —componentes rellenables— se comprueba
 * aparte, por el bloqueo del envío.)
 */
const enviable = (t) =>
  t?.status === "approved" && t?.missingSince === null && t?.metaStatus === "APPROVED";

/** Mueve SOLO el panel simulado de Meta: sin webhook, como en modo agencia. */
function metaApproves(name, category) {
  return api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({
      wabaId: WABA,
      name,
      language: "es_MX",
      event: "APPROVED",
      category,
      notify: false,
    }),
  });
}

/** Siembra plantillas en el panel de Meta SIN pasar por el CRM. */
function metaYaTenia(templates) {
  return api("/api/dev/wa-mock/seed-templates", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA, templates }),
  });
}

/**
 * Vacía el panel simulado de Meta. El estado del mock vive en el proceso y se
 * ACUMULA entre corridas: sin esto, las plantillas de hoy caen más allá de la
 * página 25 por culpa de las de ayer y los fallos dejan de significar lo que
 * dicen.
 */
function reiniciarPanelDeMeta() {
  return api("/api/dev/wa-mock/outbox", { method: "DELETE" });
}

function crear(name, body, extra = {}) {
  return api("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name, language: "es_MX", category: "UTILITY", body, ...extra }),
  });
}

async function main() {
  console.log("== Setup: registro + conexión WhatsApp ==");
  const limpio = await reiniciarPanelDeMeta();
  ok("panel simulado de Meta vacío", limpio.res.ok, `status=${limpio.res.status}`);
  const email = "e2e@uniko.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: "tok-tpl" }),
  });
  ok("conexión WhatsApp guardada", conn.res.ok, JSON.stringify(conn.json));

  // Las filas de corridas anteriores ya no están en el panel (se vació): el
  // primer sync las marca ausentes y deja la base en un estado conocido.
  await api("/api/templates/sync", { method: "POST" });

  console.log("\n== us6: alta de plantilla → Pendiente de Meta ==");
  const name = `seguimiento_${stamp}`;
  const created = await crear(name, "Hola {{1}} 👋 ¿Retomamos tu cotización?");
  ok("plantilla creada y enviada a Meta", created.res.ok, JSON.stringify(created.json));
  let local = await findTemplate(name);
  ok("estado inicial = pending", local?.status === "pending", local?.status);
  ok(
    "el estado crudo que Meta respondió al crear queda guardado (PENDING)",
    local?.metaStatus === "PENDING",
    JSON.stringify(local?.metaStatus)
  );
  ok("categoría inicial = UTILITY", local?.category === "UTILITY", local?.category);
  ok("todavía no es enviable", !enviable(local));

  console.log("\n== us6: Meta aprueba y reclasifica, SIN webhook (modo agencia) ==");
  const flip = await metaApproves(name, "MARKETING");
  ok("panel de Meta movido sin entregar webhook", flip.json?.delivered === false, JSON.stringify(flip.json));

  local = await findTemplate(name);
  ok(
    "el CRM sigue en pending (el webhook nunca llega) — este era el bug",
    local?.status === "pending",
    local?.status
  );

  console.log("\n== us6: el pull sincroniza estado Y categoría ==");
  const sync = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", sync.res.ok, JSON.stringify(sync.json));
  ok("sync reporta 1 actualizada", sync.json?.updated === 1, JSON.stringify(sync.json));

  local = await findTemplate(name);
  ok("estado = approved", local?.status === "approved", local?.status);
  ok("meta_status = APPROVED y enviable", enviable(local), JSON.stringify(local));
  ok(
    "categoría reclasificada por Meta = MARKETING",
    local?.category === "MARKETING",
    local?.category
  );

  console.log("\n== us6: idempotencia del sync ==");
  const again = await api("/api/templates/sync", { method: "POST" });
  ok("segundo sync no reescribe nada", again.json?.updated === 0, JSON.stringify(again.json));
  ok("ni importa ni marca nada", again.json?.imported === 0 && again.json?.missing === 0, JSON.stringify(again.json));

  console.log("\n== us6: camino infeliz — Meta caído no tumba la pantalla ==");
  const listStillOk = await api("/api/templates");
  ok(
    "GET /api/templates responde aunque el sync sea aparte",
    listStillOk.res.ok && (listStillOk.json?.templates?.length ?? 0) > 0
  );

  console.log("\n== 027: plantillas que el negocio YA tenía en el Administrador de WhatsApp ==");
  // Caso NORMAL, no de borde: cualquier negocio que llevara tiempo usando el
  // Administrador de WhatsApp —o que creó la plantilla allá porque aquí
  // "marcaba error"— llega con plantillas que este CRM nunca creó. Si el sync
  // no las importa son invisibles, y por tanto imposibles de enviar.
  const previa = `preexistente_${stamp}`;
  const pausada = `pausada_${stamp}`;
  const conImagen = `con_imagen_${stamp}`;
  const seed = await metaYaTenia([
    {
      name: previa,
      language: "es_MX",
      category: "UTILITY",
      status: "APPROVED",
      body: "Tu pedido va en camino, {{1}}.",
    },
    { name: pausada, language: "es_MX", status: "PAUSED", body: "Oferta de hoy." },
    {
      name: conImagen,
      language: "es_MX",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "IMAGE", example: { header_handle: ["x"] } },
        { type: "BODY", text: "Mira nuestro catálogo de esta semana." },
        { type: "FOOTER", text: "Responde STOP para no recibir más" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Me interesa" }] },
      ],
    },
  ]);
  ok("sembradas en Meta sin pasar por el CRM", seed.res.ok && seed.json?.seeded?.length === 3, JSON.stringify(seed.json));
  ok("no están en la base local antes de sincronizar", (await findTemplate(previa)) === undefined);

  const syncPrevia = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", syncPrevia.res.ok, JSON.stringify(syncPrevia.json));
  ok("el sync reporta 3 importadas", syncPrevia.json?.imported === 3, JSON.stringify(syncPrevia.json));
  const importada = await findTemplate(previa);
  ok(
    "tras sincronizar, la plantilla preexistente aparece en el CRM",
    importada !== undefined,
    "sigue ausente: el sync descarta toda remota sin pareja local"
  );
  ok("llega con su cuerpo (componente BODY)", importada?.body === "Tu pedido va en camino, {{1}}.", importada?.body);
  ok("y con el estado real de Meta (approved, APPROVED) → enviable", enviable(importada), JSON.stringify(importada));
  ok("y con su id de Meta", typeof importada?.id === "string" && importada.id.startsWith("tpl_"), importada?.id);

  const laPausada = await findTemplate(pausada);
  ok(
    "la pausada entra con su estado crudo y NO es enviable",
    laPausada?.metaStatus === "PAUSED" && !enviable(laPausada),
    JSON.stringify(laPausada)
  );
  ok(
    "y su ciclo local no miente: entra como pending, no como aprobada",
    laPausada?.status === "pending",
    laPausada?.status
  );

  const laDeImagen = await findTemplate(conImagen);
  ok(
    "la de encabezado de imagen se importa con sus componentes",
    Array.isArray(laDeImagen?.components) && laDeImagen.components.some((c) => c.type === "HEADER"),
    JSON.stringify(laDeImagen?.components)
  );
  ok("y está aprobada según Meta", enviable(laDeImagen), JSON.stringify(laDeImagen));

  // Una conversación real para poder intentar el envío de verdad: el rechazo
  // tiene que ocurrir en NUESTRA puerta, antes de gastar la llamada a Meta.
  const LEAD = `52155800${Math.floor(1000 + Math.random() * 8999)}`;
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: `Lead027${stamp}`,
      text: "hola",
      waMessageId: `wamid.tpl027.${stamp}`,
    }),
  });
  await new Promise((r) => setTimeout(r, 1200));
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  const convId = convs.find((c) => c.contact.name === `Lead027${stamp}`)?.id;
  ok("conversación de prueba creada", Boolean(convId), String(convs.length));

  const envioImagen = await api(`/api/conversations/${convId}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: laDeImagen?.id, variables: [] }),
  });
  ok(
    "enviar la de encabezado de imagen se rechaza ANTES de Meta (422)",
    envioImagen.res.status === 422,
    `HTTP ${envioImagen.res.status}`
  );
  ok(
    "diciendo qué le falta al CRM (el encabezado) y la salida",
    /encabezado es imagen/i.test(envioImagen.json?.error?.message ?? "") &&
      /Administrador de WhatsApp/.test(envioImagen.json?.error?.message ?? ""),
    JSON.stringify(envioImagen.json)
  );

  const envioPausada = await api(`/api/conversations/${convId}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: laPausada?.id, variables: [] }),
  });
  ok("enviar la pausada (importada como pending) → 422", envioPausada.res.status === 422, `HTTP ${envioPausada.res.status}`);

  const envioPrevia = await api(`/api/conversations/${convId}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: importada?.id, variables: ["María"] }),
  });
  ok("la importada de solo cuerpo SÍ se envía (200)", envioPrevia.res.ok, JSON.stringify(envioPrevia.json));

  console.log("\n== 027: crear — lo que Meta rechaza síncronamente se avisa antes, con causa ==");
  const alFinal = await crear(`al_final_${stamp}`, "Hola {{1}}");
  ok("variable al final → 422", alFinal.res.status === 422, `HTTP ${alFinal.res.status}`);
  ok(
    "y el mensaje dice la regla (TERMINE con una variable)",
    /TERMINE/.test(alFinal.json?.error?.message ?? ""),
    JSON.stringify(alFinal.json)
  );
  const pegadas = await crear(`pegadas_${stamp}`, "Hola {{1}} {{2}}, ¿retomamos?");
  ok("dos variables pegadas → 422 con la regla", pegadas.res.status === 422 && /pegadas/.test(pegadas.json?.error?.message ?? ""), JSON.stringify(pegadas.json));
  const alInicio = await crear(`al_inicio_${stamp}`, "{{1}}, tu pedido llegó.");
  ok("variable al inicio → 422 con la regla", alInicio.res.status === 422 && /EMPIECE/.test(alInicio.json?.error?.message ?? ""), JSON.stringify(alInicio.json));

  const conEspacios = `con_espacios_${stamp}`;
  const normalizada = await crear(conEspacios, "Hola {{ 1 }}, tu cita es el {{2 }}.");
  ok("`{{ 1 }}` se acepta…", normalizada.res.ok, JSON.stringify(normalizada.json));
  ok(
    "…normalizado a `{{1}}` en lo que se guarda (que es lo que Meta aprobó)",
    normalizada.json?.template?.body === "Hola {{1}}, tu cita es el {{2}}.",
    JSON.stringify(normalizada.json?.template?.body)
  );
  const enMeta = await api(`/api/dev/wa-mock/graph/${WABA}/message_templates?fields=id,name,components`);
  const remotaNormalizada = (enMeta.json?.data ?? []).find((t) => t.name === conEspacios);
  ok(
    "y Meta recibió `{{1}}` con un ejemplo por variable",
    remotaNormalizada?.components?.[0]?.text === "Hola {{1}}, tu cita es el {{2}}." &&
      remotaNormalizada?.components?.[0]?.example?.body_text?.[0]?.length === 2,
    JSON.stringify(remotaNormalizada)
  );

  // Un rechazo que el CRM NO valida localmente (la proporción variables/texto
  // no es pública): lo que importa es que la causa llegue traducida y con el
  // código, no "(#100) Invalid parameter".
  const rechazada = await crear(`rechazada_${stamp}`, "Hola {{1}}, [meta-rechaza] {{2}}.");
  ok("rechazo síncrono de Meta → 422", rechazada.res.status === 422, `HTTP ${rechazada.res.status}`);
  ok(
    "con la causa traducida y el código (Meta 100/2388293)",
    /demasiadas variables/.test(rechazada.json?.error?.message ?? "") &&
      /\(Meta 100\/2388293\)/.test(rechazada.json?.error?.message ?? ""),
    JSON.stringify(rechazada.json)
  );
  ok("y no deja fila local", (await findTemplate(`rechazada_${stamp}`)) === undefined);

  console.log("\n== 027: crear un nombre que YA existe en Meta → se importa, no se pierde ==");
  const dup = `duplicada_${stamp}`;
  await metaYaTenia([{ name: dup, language: "es_MX", status: "APPROVED", body: "La versión que ya estaba en Meta." }]);
  const duplicada = await crear(dup, "Otra versión escrita desde el CRM.");
  ok("Meta la rechaza y el CRM responde 409 already_exists", duplicada.res.status === 409 && duplicada.json?.error?.code === "already_exists", JSON.stringify(duplicada.json));
  ok("el mensaje dice que ya existía y que se importó", /la importé/.test(duplicada.json?.error?.message ?? ""), JSON.stringify(duplicada.json));
  const laDup = await findTemplate(dup);
  ok(
    "y la fila local es la de Meta (su cuerpo, aprobada, enviable)",
    laDup?.body === "La versión que ya estaba en Meta." && enviable(laDup),
    JSON.stringify(laDup)
  );

  console.log("\n== 027: 30 plantillas → se sincronizan las 30, no las 25 de la primera página ==");
  // Se crean DESDE el CRM para que el sync solo tenga que actualizarlas: así
  // este caso mide la paginación y nada más. Graph sirve 25 por página, y quien
  // lea solo `data` sin seguir `paging.next` se lleva las primeras y cree que
  // están todas — sin error, sin aviso y sin nada visible en la pantalla.
  await reiniciarPanelDeMeta();
  const lote = [];
  for (let i = 0; i < 30; i++) {
    const nombre = `lote_${stamp}_${String(i).padStart(2, "0")}`;
    lote.push(nombre);
    await crear(nombre, `Aviso número ${i + 1}.`);
  }
  const creadas = (await api("/api/templates")).json?.templates ?? [];
  ok(
    "las 30 del lote existen en la base local, en pending",
    lote.every((n) => creadas.find((t) => t.name === n)?.status === "pending"),
    `creadas ${creadas.filter((t) => lote.includes(t.name)).length}/30`
  );

  // Meta las aprueba las 30 de golpe, sin webhook (modo agencia).
  const aprobar = await metaYaTenia(lote.map((n) => ({ name: n, language: "es_MX", status: "APPROVED" })));
  ok("Meta aprueba las 30", aprobar.res.ok, JSON.stringify(aprobar.json));

  const syncLote = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", syncLote.res.ok, JSON.stringify(syncLote.json));
  const finales = (await api("/api/templates")).json?.templates ?? [];
  const aprobadas = lote.filter((n) => enviable(finales.find((t) => t.name === n))).length;
  ok("las 30 quedan aprobadas y enviables (no 25)", aprobadas === 30, `solo ${aprobadas}/30 — la segunda página de Graph nunca se pidió`);

  console.log("\n== 027: una plantilla que desaparece de Meta se marca, no se borra ==");
  // El negocio la borra desde el Administrador de WhatsApp. La fila NO puede
  // desaparecer: los mensajes ya enviados con ella la referencian y el
  // historial de la conversación se quedaría sin el texto que se mandó.
  await reiniciarPanelDeMeta();
  const superviviente = `superviviente_${stamp}`;
  await metaYaTenia([{ name: superviviente, language: "es_MX", status: "APPROVED" }]);
  const syncAusentes = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", syncAusentes.res.ok, JSON.stringify(syncAusentes.json));
  ok("el sync reporta las que ya no están en Meta", (syncAusentes.json?.missing ?? 0) >= 30, JSON.stringify(syncAusentes.json));

  const trasBorrado = (await api("/api/templates")).json?.templates ?? [];
  const unaDelLote = trasBorrado.find((t) => t.name === lote[0]);
  ok("la plantilla borrada en Meta SIGUE en el CRM", unaDelLote !== undefined);
  ok("y queda marcada con la fecha en que desapareció", Boolean(unaDelLote?.missingSince), JSON.stringify(unaDelLote));
  ok("y deja de ser enviable aunque siga approved", unaDelLote?.status === "approved" && !enviable(unaDelLote));
  ok("el que sí sigue en Meta no se marca", trasBorrado.find((t) => t.name === superviviente)?.missingSince === null);

  const envioAusente = await api(`/api/conversations/${convId}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: unaDelLote?.id, variables: [] }),
  });
  ok("enviar una ausente → 422 diciendo que ya no existe en Meta", envioAusente.res.status === 422 && /ya no existe/.test(envioAusente.json?.error?.message ?? ""), JSON.stringify(envioAusente.json));

  const reaparece = await metaYaTenia([{ name: lote[0], language: "es_MX", status: "APPROVED" }]);
  ok("Meta vuelve a listarla", reaparece.res.ok);
  await api("/api/templates/sync", { method: "POST" });
  const recuperada = await findTemplate(lote[0]);
  ok("si vuelve a Meta, deja de estar marcada", recuperada?.missingSince === null, JSON.stringify(recuperada));

  console.log("\n== 027: estados de Meta que NO son APPROVED bloquean el envío ==");
  // El caso del issue: Meta pausa una plantilla por baja calidad. Antes su
  // estado no se sabía leer, la fila se quedaba `approved`, aparecía en el
  // selector, y el fallo llegaba al pulsar Enviar como error de Meta.
  const pausable = `pausable_${stamp}`;
  await metaYaTenia([{ name: pausable, language: "es_MX", status: "APPROVED" }]);
  await api("/api/templates/sync", { method: "POST" });
  const antesDePausar = await findTemplate(pausable);
  ok("nace aprobada y enviable", enviable(antesDePausar), JSON.stringify(antesDePausar));

  await metaYaTenia([{ name: pausable, language: "es_MX", status: "PAUSED" }]);
  await api("/api/templates/sync", { method: "POST" });
  const trasPausar = await findTemplate(pausable);
  ok("tras sincronizar, el estado crudo de Meta queda guardado", trasPausar?.metaStatus === "PAUSED", JSON.stringify(trasPausar));
  ok("y deja de ser enviable", !enviable(trasPausar), JSON.stringify(trasPausar));
  // El ciclo de aprobación NO se falsea: se aprobó, y eso sigue siendo cierto.
  ok("sin inventarle una etiqueta al ciclo de aprobación", trasPausar?.status === "approved", JSON.stringify(trasPausar?.status));

  const envioPausable = await api(`/api/conversations/${convId}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: trasPausar?.id, variables: [] }),
  });
  ok("y el envío se rechaza ANTES de gastar la llamada a Meta", !envioPausable.res.ok, `HTTP ${envioPausable.res.status}`);
  ok("diciendo por qué y qué hacer, no 'error de Meta'", /pausó|pausada/i.test(JSON.stringify(envioPausable.json)), JSON.stringify(envioPausable.json));

  // Lo que sostiene el diseño: exigir APPROVED en positivo en vez de excluir
  // una lista de estados malos que se queda corta sola.
  const inventado = `inventado_${stamp}`;
  await metaYaTenia([{ name: inventado, language: "es_MX", status: "ALGO_QUE_META_INVENTE_EN_2027" }]);
  await api("/api/templates/sync", { method: "POST" });
  const conEstadoRaro = await findTemplate(inventado);
  ok("un estado que Meta invente se GUARDA (para poder nombrarlo)", conEstadoRaro?.metaStatus === "ALGO_QUE_META_INVENTE_EN_2027", JSON.stringify(conEstadoRaro));
  ok("y bloquea el envío por defecto en vez de colarse como aprobada", !enviable(conEstadoRaro), JSON.stringify(conEstadoRaro));

  // IN_REVIEW es el nombre nuevo de PENDING en la documentación de Meta.
  const enRevision = `en_revision_${stamp}`;
  await metaYaTenia([{ name: enRevision, language: "es_MX", status: "IN_REVIEW" }]);
  await api("/api/templates/sync", { method: "POST" });
  const laEnRevision = await findTemplate(enRevision);
  ok("IN_REVIEW se traduce a pending", laEnRevision?.status === "pending" && laEnRevision?.metaStatus === "IN_REVIEW", JSON.stringify(laEnRevision));

  // El webhook es el camino RÁPIDO: llega en segundos, mientras que el sync
  // espera a que alguien lo pulse. Antes un evento PAUSED salía por un `return`
  // y no tocaba nada.
  const porWebhook = `webhook_pausa_${stamp}`;
  await metaYaTenia([{ name: porWebhook, language: "es_MX", status: "APPROVED" }]);
  await api("/api/templates/sync", { method: "POST" });
  ok("parte de aprobada", enviable(await findTemplate(porWebhook)));
  const evento = await api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA, name: porWebhook, language: "es_MX", event: "PAUSED", notify: true }),
  });
  ok("el webhook de pausa se entrega", evento.json?.delivered === true, JSON.stringify(evento.json));
  await new Promise((r) => setTimeout(r, 500));
  const trasEvento = await findTemplate(porWebhook);
  ok("el webhook por sí solo ya la bloquea, sin esperar al sync", trasEvento?.metaStatus === "PAUSED" && !enviable(trasEvento), JSON.stringify(trasEvento));

  // Y un rechazo por webhook trae su motivo, sin "NONE".
  const rechazadaWh = `rechazada_wh_${stamp}`;
  await crear(rechazadaWh, "Promo de prueba {{1}}, aprovecha.");
  const rechazo = await api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA, name: rechazadaWh, language: "es_MX", event: "REJECTED", reason: "TAG_CONTENT_MISMATCH", notify: true }),
  });
  ok("el webhook de rechazo se entrega", rechazo.json?.delivered === true, JSON.stringify(rechazo.json));
  await new Promise((r) => setTimeout(r, 500));
  const laRechazada = await findTemplate(rechazadaWh);
  ok("queda rechazada con su motivo", laRechazada?.status === "rejected" && laRechazada?.rejectionReason === "TAG_CONTENT_MISMATCH", JSON.stringify(laRechazada));
  await api("/api/templates/sync", { method: "POST" });
  const laRechazadaTrasSync = await findTemplate(rechazadaWh);
  ok("y el sync no le borra el motivo ni la reanima", laRechazadaTrasSync?.status === "rejected" && Boolean(laRechazadaTrasSync?.rejectionReason), JSON.stringify(laRechazadaTrasSync));

  console.log("\n== 027: camino infeliz — Meta caído no se disfraza de \"Todo al día\" ==");
  // Un WABA que el mock atiende con 503 (como el "service temporarily
  // unavailable" real, que además viene etiquetado OAuthException). Ni el sync
  // ni la creación pueden fingir éxito, y la base no se toca. Se vuelve al WABA
  // de verdad al final para dejar todo como estaba.
  await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: `${WABA}-caido`, phoneNumberId: PN, token: "tok-tpl" }),
  });
  const syncRoto = await api("/api/templates/sync", { method: "POST" });
  ok(
    "con Meta caído el sync responde 503 meta_unavailable, no éxito",
    syncRoto.res.status === 503 && syncRoto.json?.error?.code === "meta_unavailable",
    `HTTP ${syncRoto.res.status} ${JSON.stringify(syncRoto.json)}`
  );
  const crearRoto = await crear(`meta_caido_${stamp}`, "Hola {{1}}, ¿seguimos?");
  ok(
    "y crear tampoco finge: 503 sin tocar la base",
    crearRoto.res.status === 503 && (await findTemplate(`meta_caido_${stamp}`)) === undefined,
    JSON.stringify(crearRoto.json)
  );
  const trasCaida = (await api("/api/templates")).json?.templates ?? [];
  ok("la lista local sigue respondiendo (lo que se ve es local y viejo)", trasCaida.length > 0);
  const reconectar = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: "tok-tpl" }),
  });
  ok("reconectado al WABA real para dejar la base como estaba", reconectar.res.ok);

  console.log(`\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
