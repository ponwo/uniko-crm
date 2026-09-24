/**
 * Self-test E2E de comportamiento — conduce la app real en localhost con los
 * mocks (wa-mock + ai-mock) por las superficies de usuario, en vez de darle
 * el guion al humano. Cubre tests/e2e/us-bsuid.md y tests/e2e/us-bot-api.md.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      BOT_API_KEY configurada y BD migrada
 *   2) node --env-file=.env scripts/e2e-selftest.mjs
 *
 * Sale con código 1 si algún check falla (apto para CI o para el gate previo
 * a declarar "Hecho").
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
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

function bot(path, opts = {}) {
  return api(path, {
    ...opts,
    headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PN = "PN-E2E-1";

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error(
      "BOT_API_KEY ausente o corta (<16): los checks de /api/bot/* no pueden correr."
    );
    process.exit(1);
  }

  console.log("== Setup: registro/login + conexión WhatsApp ==");
  const email = "e2e@uniko.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Re-corrida: el registro se cierra tras la primera organización.
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión WhatsApp guardada (vía wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json)
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  console.log("\n== us-bsuid: inbound sin wa_id ==");
  const inb1 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  ok("inbound BSUID entregado", inb1.res.ok, JSON.stringify(inb1.json));
  await sleep(1200);

  let convs = (await api("/api/conversations")).json?.conversations ?? [];
  const bsuidConv = convs.find((c) => c.contact.name === "Dueña Dental");
  ok("conversación con nombre de perfil (no el BSUID crudo)", !!bsuidConv);
  ok("contacto BSUID sin teléfono", bsuidConv?.contact.phone === null);

  const reply = await api(`/api/conversations/${bsuidConv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "¡Hola! Te atendemos enseguida" }),
  });
  ok("respuesta a contacto BSUID enviable", reply.res.ok, JSON.stringify(reply.json));

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el destinatario del envío es el BSUID",
    outbox.some((o) => o.to === "bsu_e2e_1"),
    JSON.stringify(outbox.map((o) => o.to))
  );

  // Idempotencia: re-entrega del mismo wa_message_id
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  await sleep(800);
  const msgs =
    (await api(`/api/conversations/${bsuidConv?.id}/messages`)).json?.messages ??
    [];
  const inCount = msgs.filter((m) => m.direction === "in").length;
  ok("webhook duplicado no duplica mensajes", inCount === 1, `in=${inCount}`);

  console.log("\n== us-bsuid: reconciliación 521/52 ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214621349768",
      name: "Kevin MX",
      text: "uno",
    }),
  });
  await sleep(800);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: "524621349768", text: "dos" }),
  });
  await sleep(800);
  const contacts =
    (await api("/api/contacts?q=Kevin%20MX")).json?.contacts ?? [];
  ok(
    "521 y 52 resuelven a UN solo contacto",
    contacts.length === 1,
    `n=${contacts.length}`
  );

  const mxConv = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Kevin MX"
  );
  ok("el contacto reconciliado conserva su conversación", !!mxConv);

  // Issue #35: un destinatario argentino llega como `549` + 10 dígitos y hay
  // que ENVIARLE sin el 9. La identidad, en cambio, conserva lo que Meta
  // reporta: si se reescribiera, dejaría de casar con el `wa_id` de cada
  // webhook y el contacto se partiría en dos.
  console.log("\n== us-bsuid: destinatario argentino (549 → 54) ==");
  const AR_REPORTADO = "5491122334455";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: AR_REPORTADO,
      name: "Lead AR",
      text: "hola desde Argentina",
      waMessageId: "wamid.e2e.ar.1",
    }),
  });
  await sleep(1200);
  const convAr = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Lead AR"
  );
  ok("la conversación argentina se creó", Boolean(convAr));
  ok(
    "la identidad guardada conserva el 9 que reporta Meta",
    convAr?.contact.phone === AR_REPORTADO,
    `phone=${convAr?.contact.phone}`
  );

  if (convAr) {
    // Se cuenta lo que ya había en vez de vaciar el outbox: el DELETE del
    // wa-mock reinicia su contador de wa_message_id, y en una RE-CORRIDA eso
    // choca con los mensajes que ya están en la base (unique) y tumba el envío
    // con un 500 que no tiene nada que ver con lo que se está probando.
    const outboxAntes =
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
    const envioAr = await api(`/api/conversations/${convAr.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "respuesta a Argentina" }),
    });
    ok("el mensaje a Argentina se envía", envioAr.res.ok, `status=${envioAr.res.status}`);
    const outboxAr = (
      (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []
    ).slice(outboxAntes);
    ok(
      "por el cable viaja SIN el 9 (lo que la lista de permitidos acepta)",
      outboxAr.some((o) => o.to === "541122334455"),
      JSON.stringify(outboxAr.map((o) => o.to))
    );
    ok(
      "…y nunca con el 9, que es lo que devolvía 131030",
      !outboxAr.some((o) => o.to === AR_REPORTADO),
      JSON.stringify(outboxAr.map((o) => o.to))
    );
  }

  console.log("\n== us-bot-api: autorización ==");
  const noKey = await api("/api/bot/media/media123");
  ok("media sin API key → 401", noKey.res.status === 401);
  const badKey = await api("/api/bot/media/media123", {
    headers: { "x-api-key": "x".repeat(BOT_KEY.length) },
  });
  ok("media con API key equivocada → 401", badKey.res.status === 401);
  const resetNoKey = await api("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: mxConv?.id }),
  });
  ok("reset sin API key → 401", resetNoKey.res.status === 401);

  console.log("\n== us-bot-api: typing + leído ==");
  const convId = mxConv?.id;
  const outboxBeforeTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const typ = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/typing → ok:true (leído + escribiendo…)",
    typ.res.ok && typ.json?.ok === true,
    JSON.stringify(typ.json)
  );
  const outboxAfterTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "typing NO contamina el outbox",
    outboxAfterTyping === outboxBeforeTyping,
    `antes=${outboxBeforeTyping} después=${outboxAfterTyping}`
  );

  const typ404 = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe" }),
  });
  ok("typing con conversación inexistente → 404", typ404.res.status === 404);

  console.log("\n== us-bot-api: media proxy ==");
  const med = await bot("/api/bot/media/media123");
  const medBytes = med.res.ok ? await med.res.arrayBuffer() : new ArrayBuffer(0);
  ok(
    "GET /api/bot/media/{id} → binario con content-type",
    med.res.ok &&
      medBytes.byteLength > 0 &&
      (med.res.headers.get("content-type") ?? "").includes("image"),
    `status=${med.res.status} bytes=${medBytes.byteLength}`
  );
  const medBad = await bot("/api/bot/media/no-es-media");
  ok(
    "mediaId que Graph no reconoce → error tipado, no 500",
    medBad.res.status === 404 || medBad.res.status === 502,
    `status=${medBad.res.status}`
  );

  console.log("\n== us-bot-api: perfil del agente + knowledge base ==");
  const profNoKey = await api("/api/bot/profile");
  ok("perfil sin API key → 401", profNoKey.res.status === 401);

  const putProf = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({
      name: "Sofi",
      tone: "cálido y directo",
      instructions: "Vendemos limpiezas dentales.",
      escalationRules: "Urgencias de dolor → humano.",
      greeting: "¡Hola! Soy Sofi",
      enabled: false,
    }),
  });
  ok("perfil guardado desde la pantalla Agente", putProf.res.ok);
  const kbQa = await api("/api/kb", {
    method: "POST",
    body: JSON.stringify({
      kind: "qa",
      question: "¿Cuánto cuesta?",
      answer: "$800.",
    }),
  });
  ok("entrada de KB creada desde la pantalla", kbQa.res.ok, JSON.stringify(kbQa.json));

  const prof = await bot("/api/bot/profile");
  ok(
    "GET /api/bot/profile → 200 con el perfil de la pantalla",
    prof.res.ok && prof.json?.profile?.name === "Sofi",
    JSON.stringify(prof.json?.profile)
  );
  ok(
    "el knowledge base viaja renderizado (P:/R:)",
    typeof prof.json?.kb === "string" && prof.json.kb.includes("P: ¿Cuánto cuesta?"),
    JSON.stringify(prof.json?.kb)
  );
  ok(
    "`enabled` NO viaja: gobierna la IA in-process, no al bot externo",
    prof.json?.profile && !("enabled" in prof.json.profile)
  );
  ok("`resources` presente y vacío", Array.isArray(prof.json?.resources));

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ tone: "seco y breve" }),
  });
  const profAgain = await bot("/api/bot/profile");
  ok(
    "editar el tono se refleja al instante (sin caché)",
    profAgain.json?.profile?.tone === "seco y breve",
    JSON.stringify(profAgain.json?.profile?.tone)
  );

  console.log("\n== us-bot-api: contexto conversacional ==");
  const ctxNoKey = await api(`/api/bot/context?conversationId=${convId}`);
  ok("contexto sin API key → 401", ctxNoKey.res.status === 401);

  const ctx = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "GET /api/bot/context por conversationId → 200",
    ctx.res.ok && ctx.json?.conversation?.id === convId,
    JSON.stringify(ctx.json?.conversation)
  );
  ok(
    "trae la identidad estable del contacto (no solo el teléfono)",
    typeof ctx.json?.contact?.waIdentity === "string" &&
      ctx.json.contact.waIdentity.length > 0
  );
  ok(
    "trae la etapa del lead en el pipeline",
    typeof ctx.json?.lead?.stageName === "string",
    JSON.stringify(ctx.json?.lead)
  );
  ok(
    "la ventana de 24 h viaja abierta tras un entrante reciente",
    ctx.json?.conversation?.windowOpen === true &&
      ctx.json?.conversation?.windowRemainingMs > 0,
    JSON.stringify(ctx.json?.conversation)
  );

  const ctxByIdentity = await bot(
    `/api/bot/context?waIdentity=${encodeURIComponent(ctx.json.contact.waIdentity)}`
  );
  ok(
    "resolver por waIdentity da la MISMA conversación",
    ctxByIdentity.json?.conversation?.id === convId,
    JSON.stringify(ctxByIdentity.json?.conversation?.id)
  );

  const ctxSinArgs = await bot("/api/bot/context");
  ok("contexto sin waIdentity ni conversationId → 422", ctxSinArgs.res.status === 422);
  const ctx404 = await bot("/api/bot/context?conversationId=cv_no_existe");
  ok("contexto de una conversación inexistente → 404", ctx404.res.status === 404);

  console.log("\n== us-bot-api: ficha de calificación ==");
  const fichaNoKey = await api("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId, ficha: { rubro: "x" } }),
  });
  ok("ficha sin API key → 401", fichaNoKey.res.status === 401);

  const f1 = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { rubro: "dentista", geo: "Querétaro", calificado: true },
    }),
  });
  ok(
    "PUT /api/bot/ficha → 200 con la ficha completa",
    f1.res.ok && f1.json?.ficha?.rubro === "dentista",
    JSON.stringify(f1.json)
  );
  ok(
    "las claves las pone el negocio: el CRM guarda lo que le manden",
    f1.json?.ficha?.geo === "Querétaro" && f1.json?.ficha?.calificado === true,
    JSON.stringify(f1.json?.ficha)
  );

  const ctxConFicha = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "la ficha viaja en el contexto del siguiente turno",
    ctxConFicha.json?.contact?.ficha?.rubro === "dentista",
    JSON.stringify(ctxConFicha.json?.contact?.ficha)
  );

  const f2 = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { presupuesto: "20 mil", geo: null },
    }),
  });
  ok(
    "merge campo a campo: lo ausente se conserva",
    f2.json?.ficha?.rubro === "dentista" && f2.json?.ficha?.presupuesto === "20 mil",
    JSON.stringify(f2.json?.ficha)
  );
  ok(
    "null explícito borra la clave",
    f2.json?.ficha && !("geo" in f2.json.ficha),
    JSON.stringify(f2.json?.ficha)
  );

  const fBasura = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { anidado: { a: 1 }, vacío: "", bueno: "  sí  " },
    }),
  });
  ok(
    "lo que no se entiende se ignora sin 422 (no se le tiran datos al bot)",
    fBasura.res.ok &&
      fBasura.json?.ficha?.bueno === "sí" &&
      !("anidado" in fBasura.json.ficha) &&
      !("vacío" in fBasura.json.ficha),
    JSON.stringify(fBasura.json?.ficha)
  );

  const fNoConv = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: "cv_no_existe", ficha: { a: "b" } }),
  });
  ok("ficha de conversación inexistente → 404", fNoConv.res.status === 404);
  const fSinFicha = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok("cuerpo sin `ficha` → 422", fSinFicha.res.status === 422);

  console.log("\n== us-bot-api: el bot envía a través del CRM ==");
  const sendNoKey = await api("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "hola" }),
  });
  ok("envío sin API key → 401", sendNoKey.res.status === 401);

  const outboxBeforeBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const botSend = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "Hola, soy el bot." }),
  });
  ok(
    "POST /api/bot/messages → 200 con messageId",
    botSend.res.ok && typeof botSend.json?.messageId === "string",
    JSON.stringify(botSend.json)
  );
  const outboxAfterBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "el mensaje salió de verdad por el canal de WhatsApp",
    outboxAfterBot === outboxBeforeBot + 1,
    `antes=${outboxBeforeBot} después=${outboxAfterBot}`
  );
  const botMsg = ((await api(`/api/conversations/${convId}/messages`)).json
    ?.messages ?? []).find((m) => m.id === botSend.json?.messageId);
  ok(
    "queda en la bandeja marcado como IA (aiGenerated + origin=ai)",
    botMsg?.aiGenerated === true && botMsg?.origin === "ai",
    JSON.stringify({ aiGenerated: botMsg?.aiGenerated, origin: botMsg?.origin })
  );
  const sendNoConv = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", text: "hola" }),
  });
  ok("envío a conversación inexistente → 404", sendNoConv.res.status === 404);
  const sendVacio = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "" }),
  });
  ok("texto vacío → 422 (no se manda un mensaje en blanco)", sendVacio.res.status === 422);

  console.log("\n== us-bot-api: el bot pide un humano ==");
  const hoNoKey = await api("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  ok("handoff sin API key → 401", hoNoKey.res.status === 401);

  const ho = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "hostilidad" }),
  });
  ok("POST /api/bot/handoff → 200", ho.res.ok && ho.json?.ok === true);
  await sleep(300);
  let convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "la conversación queda pausada y con su motivo",
    convTrasHandoff?.aiEnabled === false &&
      !!convTrasHandoff?.handoffAt &&
      convTrasHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      aiEnabled: convTrasHandoff?.aiEnabled,
      reason: convTrasHandoff?.handoffReason,
    })
  );
  const primerHandoffAt = convTrasHandoff?.handoffAt;

  const hoRepe = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "repetir el handoff es idempotente: no pisa la hora ni el motivo original",
    hoRepe.res.ok &&
      convTrasHandoff?.handoffAt === primerHandoffAt &&
      convTrasHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      antes: primerHandoffAt,
      ahora: convTrasHandoff?.handoffAt,
      reason: convTrasHandoff?.handoffReason,
    })
  );

  const hoNoConv = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", reason: "cliente" }),
  });
  ok("handoff de conversación inexistente → 404", hoNoConv.res.status === 404);

  // El handoff jamás debe perderse por un motivo que no esté en el catálogo:
  // el bot se quedaría hablándole a alguien que pidió un humano.
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoRaro = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "porque sí" }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "un motivo fuera del catálogo NO tira el handoff (cae a 'modelo')",
    hoRaro.res.ok &&
      convTrasHandoff?.aiEnabled === false &&
      convTrasHandoff?.handoffReason === "modelo",
    JSON.stringify({
      status: hoRaro.res.status,
      reason: convTrasHandoff?.handoffReason,
    })
  );

  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoSinReason = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "sin motivo también pausa (cae a 'modelo')",
    hoSinReason.res.ok && convTrasHandoff?.handoffReason === "modelo",
    JSON.stringify(convTrasHandoff?.handoffReason)
  );
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);

  console.log("\n== us-bot-api: IA pausada y reset ==");
  const pause = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("IA pausada desde la bandeja", pause.res.ok, JSON.stringify(pause.json));

  const typPaused = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "typing con IA pausada → ok:false ai_paused (no toca Meta)",
    typPaused.res.ok &&
      typPaused.json?.ok === false &&
      typPaused.json?.reason === "ai_paused",
    JSON.stringify(typPaused.json)
  );

  const outboxBeforePaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const sendPaused = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "¿sigo yo?" }),
  });
  ok(
    "el bot NO habla sobre una conversación tomada por un humano → 409 ai_paused",
    sendPaused.res.status === 409 &&
      sendPaused.json?.error?.code === "ai_paused",
    JSON.stringify(sendPaused.json)
  );
  const outboxAfterPaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "y el rechazo ocurre ANTES de tocar Meta",
    outboxAfterPaused === outboxBeforePaused,
    `antes=${outboxBeforePaused} después=${outboxAfterPaused}`
  );

  const msgsBeforeReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  const rst = await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/reset → ok:true",
    rst.res.ok && rst.json?.ok === true,
    JSON.stringify(rst.json)
  );
  await sleep(400);
  convs = (await api("/api/conversations")).json?.conversations ?? [];
  const afterReset = convs.find((c) => c.id === convId);
  ok(
    "reset reactiva la IA (sale del handoff)",
    afterReset?.aiEnabled === true && !afterReset?.handoffAt,
    JSON.stringify({
      aiEnabled: afterReset?.aiEnabled,
      handoffAt: afterReset?.handoffAt,
    })
  );
  const msgsAfterReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  ok(
    "el reset conserva el historial (auditoría)",
    msgsAfterReset === msgsBeforeReset,
    `antes=${msgsBeforeReset} después=${msgsAfterReset}`
  );

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
  const detail = (await api(`/api/contacts/${afterReset?.contact.id}`)).json;
  ok(
    "reset regresa el lead a la primera etapa",
    !detail?.lead || detail?.stage?.id === firstStage?.id,
    `etapa=${detail?.stage?.name} esperada=${firstStage?.name}`
  );

  console.log("\n== 008: paridad inbox — echoes de coexistence (US1) ==");
  const LEAD = "5214627008001"; // canónica: 524627008001

  // Un inbound primero: la conversación existe y la ventana queda abierta.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 008",
      text: "hola, quiero informes",
      waMessageId: "wamid.e2e.008.in.1",
    }),
  });
  await sleep(1200);
  const findConv008 = async () =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008001"
    );
  let conv008 = await findConv008();
  ok("conversación del lead 008 creada", Boolean(conv008), "sin conversación");
  const inboundAtBefore = conv008?.lastInboundAt;

  // Echo: el dueño contesta A MANO desde la app del teléfono.
  const echo1 = await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  ok("echo entregado al webhook", echo1.res.ok, JSON.stringify(echo1.json));
  await sleep(900);

  const msgs1 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const manual1 = msgs1.find((m) => m.text === "te contesto yo, dame un minuto");
  ok(
    "el mensaje manual aparece como saliente origin=manual",
    manual1?.direction === "out" && manual1?.origin === "manual" && manual1?.status === "sent",
    JSON.stringify(manual1)
  );

  conv008 = await findConv008();
  ok(
    "la IA quedó pausada con handoff manual_reply",
    conv008?.aiEnabled === false && conv008?.handoffReason === "manual_reply",
    JSON.stringify({ aiEnabled: conv008?.aiEnabled, reason: conv008?.handoffReason })
  );
  ok(
    "el echo NO tocó la ventana de 24 h (lastInboundAt intacto)",
    conv008?.lastInboundAt === inboundAtBefore,
    `${inboundAtBefore} → ${conv008?.lastInboundAt}`
  );

  // Idempotencia: el mismo echo otra vez no duplica.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  await sleep(700);
  const msgs2 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo duplicado (mismo wamid) no duplica el mensaje",
    msgs2.filter((m) => m.text === "te contesto yo, dame un minuto").length === 1
  );

  // Variante defensiva: echoes bajo la clave `messages`.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "segundo mensaje manual",
      waMessageId: "wamid.e2e.008.echo.2",
      useMessagesKey: true,
    }),
  });
  await sleep(700);
  const msgs3 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo bajo la clave `messages` también se ingiere (parser tolerante)",
    msgs3.some((m) => m.text === "segundo mensaje manual" && m.origin === "manual")
  );

  // Echo hacia un número SIN conversación previa → la crea.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: "5214627008002",
      text: "hola, te escribo del anuncio",
      waMessageId: "wamid.e2e.008.echo.3",
    }),
  });
  await sleep(700);
  const convNew = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524627008002"
  );
  ok("echo a número nuevo crea contacto y conversación", Boolean(convNew));

  // Reactivación desde el CRM (flujo existente de handoff).
  const react = await api(`/api/conversations/${conv008.id}`, {
    method: "PATCH",
    body: JSON.stringify({ reactivate: true }),
  });
  conv008 = await findConv008();
  ok(
    "reactivar la IA desde el CRM limpia el handoff",
    react.res.ok && conv008?.aiEnabled === true && !conv008?.handoffReason
  );

  console.log("\n== 008: enviar adjuntos desde el composer (US2) ==");
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
  const mediaForm = new FormData();
  mediaForm.set(
    "file",
    new Blob([JPEG_BYTES], { type: "image/jpeg" }),
    "local.jpg"
  );
  mediaForm.set("caption", "mira nuestro local");
  const upRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: mediaForm,
  });
  const upJson = await upRes.json().catch(() => null);
  ok("imagen con caption enviada (201)", upRes.status === 201, JSON.stringify(upJson));

  const msgs4 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentImg = msgs4.find((m) => m.media?.caption === "mira nuestro local");
  ok(
    "el saliente con imagen trae asset disponible y origin=operator",
    sentImg?.type === "image" &&
      sentImg?.origin === "operator" &&
      sentImg?.media?.fetchStatus === "available",
    JSON.stringify(sentImg)
  );

  const imgBin = await fetch(`${BASE}/api/media/${sentImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok(
    "GET /api/media/{id} sirve el binario con su content-type",
    imgBin.ok && (imgBin.headers.get("content-type") ?? "").includes("image/jpeg")
  );

  const outbox008 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el envío llegó a Graph como type=image con media id subido",
    outbox008.some((o) => o.type === "image" && JSON.stringify(o.body).includes("media-up-"))
  );

  // Lote de adjuntos: el compositor sube varios archivos uno tras otro, en el
  // orden elegido y con el pie solo en el primero (cada archivo es un mensaje
  // propio en WhatsApp). Aquí se conduce ese mismo bucle contra la API.
  const loteNombres = ["lote-1.jpg", "lote-2.jpg", "lote-3.jpg"];
  const loteIds = [];
  for (const [i, nombre] of loteNombres.entries()) {
    const f = new FormData();
    f.set("file", new Blob([JPEG_BYTES], { type: "image/jpeg" }), nombre);
    if (i === 0) f.set("caption", "lote: pie del primero");
    const r = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
      method: "POST",
      headers: { cookie, origin: BASE },
      body: f,
    });
    const j = await r.json().catch(() => null);
    if (r.status === 201 && j?.messageId) loteIds.push(j.messageId);
  }
  ok("lote de 3 imágenes seguidas: las 3 salen (201)", loteIds.length === 3);
  const msgsLote = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const enHilo = loteIds.map((id) => msgsLote.find((m) => m.id === id));
  ok(
    "las 3 aparecen en el hilo como imagen saliente disponible",
    enHilo.every(
      (m) => m?.type === "image" && m.direction === "out" && m.media?.fetchStatus === "available"
    ),
    JSON.stringify(enHilo.map((m) => m?.media))
  );
  const posiciones = enHilo.map((m) => msgsLote.indexOf(m));
  ok(
    "el hilo conserva el orden en que se eligieron",
    posiciones.every((p, i) => p >= 0 && (i === 0 || p > posiciones[i - 1])),
    JSON.stringify(posiciones)
  );
  ok(
    "el pie va solo en la primera del lote",
    enHilo[0]?.media?.caption === "lote: pie del primero" &&
      enHilo.slice(1).every((m) => !m?.media?.caption)
  );
  const outboxLote = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió un type=image por cada archivo del lote",
    outboxLote.filter((o) => o.type === "image").length >= 4
  );

  // Camino infeliz: archivo que excede el límite (imagen > 5 MB) → 413 previo.
  const bigForm = new FormData();
  bigForm.set(
    "file",
    new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }),
    "grande.png"
  );
  const bigRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: bigForm,
  });
  ok("imagen de 6 MB → 413 too_large ANTES de enviar", bigRes.status === 413);

  // Ubicación (payload estructurado, sin archivo).
  const locRes = await api(`/api/conversations/${conv008.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina Central" },
    }),
  });
  ok("ubicación enviada", locRes.res.ok, JSON.stringify(locRes.json));
  const msgs5 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentLoc = msgs5.find((m) => m.type === "location" && m.direction === "out");
  ok(
    "la ubicación viaja como payload (lat/long/name) sin binario",
    sentLoc?.media?.kind === "location" && sentLoc?.media?.payload?.latitude === 21.019,
    JSON.stringify(sentLoc?.media)
  );
  const outboxLoc = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió type=location",
    outboxLoc.some((o) => o.type === "location")
  );

  console.log("\n== 008: previews de adjuntos entrantes (US3) ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "media-e2e-img-1",
      caption: "foto de mi negocio",
      waMessageId: "wamid.e2e.008.in.img",
    }),
  });
  await sleep(1600); // ingesta + descarga in-process del binario
  const msgs6 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inImg = msgs6.find((m) => m.media?.caption === "foto de mi negocio");
  ok(
    "imagen entrante queda disponible tras la descarga in-process",
    inImg?.direction === "in" &&
      inImg?.media?.kind === "image" &&
      inImg?.media?.fetchStatus === "available",
    JSON.stringify(inImg?.media)
  );
  const inImgBin = await fetch(`${BASE}/api/media/${inImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok("el binario entrante se sirve desde el volumen local", inImgBin.ok);

  // Ubicación entrante: payload directo, sin binario (404 en /api/media).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "location",
      location: { latitude: 20.5, longitude: -100.8, name: "Mi taller" },
      waMessageId: "wamid.e2e.008.in.loc",
    }),
  });
  await sleep(900);
  const msgs7 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inLoc = msgs7.find((m) => m.type === "location" && m.direction === "in");
  ok(
    "ubicación entrante trae payload directo",
    inLoc?.media?.payload?.name === "Mi taller",
    JSON.stringify(inLoc?.media)
  );

  // Camino infeliz: media cuya descarga falla (metadata sin url) → failed,
  // el mensaje se conserva y /api/media responde 410.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "broken-no-url",
      waMessageId: "wamid.e2e.008.in.broken",
    }),
  });
  await sleep(1600);
  const msgs8 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const broken = msgs8.find((m) => m.id !== inImg?.id && m.media?.fetchStatus === "failed");
  ok(
    "descarga fallida degrada a failed sin perder el mensaje",
    Boolean(broken),
    JSON.stringify(msgs8.filter((m) => m.media).map((m) => m.media))
  );
  if (broken) {
    const goneRes = await fetch(`${BASE}/api/media/${broken.media.assetId}`, {
      headers: { cookie, origin: BASE },
    });
    ok("asset fallido → 410 gone en /api/media", goneRes.status === 410);
  }

  // Echo CON adjunto (AC-5 de US1): la foto que el dueño mandó desde el cel.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      type: "image",
      mediaId: "media-e2e-echo-img",
      caption: "así quedaría tu logo",
      waMessageId: "wamid.e2e.008.echo.img",
    }),
  });
  await sleep(1600);
  const msgs9 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const echoImg = msgs9.find((m) => m.media?.caption === "así quedaría tu logo");
  ok(
    "echo con imagen: manual + asset descargado y previsualizable",
    echoImg?.origin === "manual" && echoImg?.media?.fetchStatus === "available",
    JSON.stringify(echoImg?.media)
  );

  await agendaChecks();
  await inventarioChecks();
  await atribucionChecks();

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

/* ============================================================
 * 015 — Motor de agenda universal (tests/e2e/us-agenda.md)
 *
 * Cubre las dos configuraciones de la bandera, las dos garantías
 * innegociables con sus CÓDIGOS EXACTOS, la carrera del hueco, el enlace
 * pendiente cuando el proveedor falla, y el sandbox del Laboratorio.
 * ============================================================ */

async function agendaChecks() {
  const encendida = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.AGENDA ?? "").trim()
  );

  console.log("\n== 015: la bandera de la agenda ==");
  const rutas = [
    "/api/calendar/settings",
    "/api/calendar/availability",
    "/api/bookings",
  ];

  if (!encendida) {
    // Con la bandera apagada la agenda NO EXISTE: ni rutas de operador, ni de
    // servicio, ni pantallas. Es la mitad del contrato que casi nunca se
    // prueba, y la que toda instancia normal usa.
    for (const ruta of rutas) {
      const { res } = await api(ruta);
      ok(`${ruta} → 404 con la agenda apagada`, res.status === 404, `status=${res.status}`);
    }
    const botAvail = await bot("/api/bot/availability?conversationId=x");
    ok(
      "/api/bot/availability → 404 con la agenda apagada",
      botAvail.res.status === 404,
      `status=${botAvail.res.status}`
    );
    const page = await fetch(`${BASE}/bookings`, { headers: { cookie } });
    ok("la pantalla /bookings no existe", page.status === 404, `status=${page.status}`);
    console.log("  (agenda apagada: el resto de los checks de 015 no aplican)");
    return;
  }

  for (const ruta of rutas) {
    const { res } = await api(ruta);
    ok(`${ruta} responde con la agenda encendida`, res.ok, `status=${res.status}`);
  }

  console.log("\n== 015: configuración de la agenda (US2) ==");
  const defaults = (await api("/api/calendar/settings")).json?.settings;
  ok(
    "una instancia sin configurar da defaults usables, no 404",
    defaults?.slotMinutes === 30 && defaults?.connector === "enlace-fijo",
    JSON.stringify(defaults)
  );

  const SALA = "https://meet.ejemplo.test/sala-fija";
  const guardado = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({
      weeklyHours: {
        mon: [{ start: "09:00", end: "18:00" }],
        tue: [{ start: "09:00", end: "18:00" }],
        wed: [{ start: "09:00", end: "18:00" }],
        thu: [{ start: "09:00", end: "18:00" }],
        fri: [{ start: "09:00", end: "18:00" }],
        sat: [{ start: "09:00", end: "18:00" }],
        sun: [{ start: "09:00", end: "18:00" }],
      },
      slotMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 7,
      connector: "enlace-fijo",
      meetingLink: SALA,
    }),
  });
  ok("se guarda el horario y la sala fija", guardado.res.ok, `status=${guardado.res.status}`);

  const tzMala = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ timezone: "Marte/Olympus" }),
  });
  ok(
    "una zona horaria inventada se rechaza (422) en vez de romper el motor",
    tzMala.res.status === 422,
    `status=${tzMala.res.status}`
  );

  const disp = (await api("/api/calendar/availability")).json?.slots ?? [];
  ok("hay huecos ofrecibles tras configurar", disp.length > 0, `slots=${disp.length}`);
  ok(
    "cada hueco trae el día EN PALABRAS, no solo la hora",
    Boolean(disp[0]?.dayLabel && disp[0]?.time),
    JSON.stringify(disp[0])
  );

  console.log("\n== 015: las dos garantías (US3) ==");
  const LEAD_A = "5214627015001";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD_A,
      name: "Lead agenda A",
      text: "quiero agendar",
      waMessageId: "wamid.e2e.015.a.1",
    }),
  });
  const LEAD_B = "5214627015002";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD_B,
      name: "Lead agenda B",
      text: "yo también quiero",
      waMessageId: "wamid.e2e.015.b.1",
    }),
  });
  await sleep(1500);

  const convsAgenda = (await api("/api/conversations")).json?.conversations ?? [];
  const convA = convsAgenda.find((c) => c.contact.phone === "524627015001");
  const convB = convsAgenda.find((c) => c.contact.phone === "524627015002");
  ok("dos conversaciones de prueba listas", Boolean(convA && convB));
  if (!convA || !convB) return;

  const ofertaA = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const slotsA = ofertaA.json?.slots ?? [];
  ok("ofrecer horarios devuelve huecos", slotsA.length > 0, `slots=${slotsA.length}`);
  ok(
    "el reparto cubre más de un día (no todo hoy)",
    (ofertaA.json?.diasConAgenda ?? []).length > 1,
    JSON.stringify(ofertaA.json?.diasConAgenda)
  );

  // GARANTÍA 1: un instante libre pero JAMÁS ofrecido se rechaza.
  const noOfrecido = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({
      conversationId: convA.id,
      // Un minuto después de un hueco real: válido, libre, y nunca ofrecido.
      startUtc: new Date(Date.parse(slotsA[0].startUtc) + 60_000).toISOString(),
    }),
  });
  ok(
    "horario no ofrecido → 409 slot_not_offered (código EXACTO)",
    noOfrecido.res.status === 409 &&
      noOfrecido.json?.error?.code === "slot_not_offered",
    `status=${noOfrecido.res.status} body=${JSON.stringify(noOfrecido.json)}`
  );
  ok(
    "y devuelve lo que SÍ se ofreció, para re-ofrecer sin inventar",
    (noOfrecido.json?.slots ?? []).length > 0
  );

  // Camino feliz: 201 EXACTO, no 200.
  const elegido = slotsA[0].startUtc;
  const creada = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({ conversationId: convA.id, startUtc: elegido }),
  });
  ok(
    "reservar responde 201 Created (NO 200): es contrato",
    creada.res.status === 201,
    `status=${creada.res.status}`
  );
  ok(
    "la respuesta trae etiqueta y el enlace de la sala fija",
    creada.json?.label && creada.json?.meetingLink === SALA,
    JSON.stringify(creada.json)
  );
  ok("el enlace no queda pendiente con el conector soberano", creada.json?.linkPending === false);

  const dispTrasReserva = (await api("/api/calendar/availability")).json?.slots ?? [];
  ok(
    "el hueco reservado desaparece de la disponibilidad",
    !dispTrasReserva.some((s) => s.startUtc === elegido)
  );

  const lista = (await api("/api/bookings")).json?.bookings ?? [];
  ok(
    "la cita aparece en Citas, marcada como agendada por la IA",
    lista.some((b) => b.id === creada.json?.bookingId && b.source === "ai"),
    JSON.stringify(lista.map((b) => ({ id: b.id, source: b.source })))
  );

  // GARANTÍA 2: la carrera. B tenía el mismo hueco ofrecido y llega tarde.
  const ofertaB = await bot(
    `/api/bot/availability?conversationId=${convB.id}&limit=12&perDay=3&days=5`
  );
  // Se le ofrece a B exactamente el hueco que A acaba de tomar: se simula la
  // oferta previa a la reserva de A, que es como ocurre en la vida real.
  const tomado = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({ conversationId: convB.id, startUtc: elegido }),
  });
  ok(
    "el hueco ya tomado → 409 (nunca una segunda cita)",
    tomado.res.status === 409,
    `status=${tomado.res.status} body=${JSON.stringify(tomado.json)}`
  );
  ok(
    "el sobre del error va ANIDADO y `slots` es HERMANO",
    typeof tomado.json?.error?.code === "string" && Array.isArray(tomado.json?.slots),
    JSON.stringify(tomado.json)
  );

  const listaTrasCarrera = (await api("/api/bookings")).json?.bookings ?? [];
  const activasEnElHueco = listaTrasCarrera.filter(
    (b) =>
      b.scheduledAtUtc === elegido &&
      (b.status === "agendada" || b.status === "realizada")
  );
  ok(
    "CERO doble-agendamiento: una sola cita activa en ese instante",
    activasEnElHueco.length === 1,
    `activas=${activasEnElHueco.length}`
  );

  // Las alternativas del 409 ya son la oferta vigente: reservables de una.
  const alternativa = (tomado.json?.slots ?? [])[0];
  if (alternativa) {
    const conAlternativa = await bot("/api/bot/bookings", {
      method: "POST",
      body: JSON.stringify({
        conversationId: convB.id,
        startUtc: alternativa.startUtc,
      }),
    });
    ok(
      "una alternativa del 409 se reserva de inmediato (201)",
      conAlternativa.res.status === 201,
      `status=${conAlternativa.res.status}`
    );
  } else {
    ok("el 409 trajo alternativas frescas", false, "lista vacía");
  }

  // Reprogramar por la superficie del bot: 200, no 201.
  const ofertaMover = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const destino = (ofertaMover.json?.slots ?? [])[0];
  if (destino) {
    const movida = await bot("/api/bot/bookings", {
      method: "PATCH",
      body: JSON.stringify({
        conversationId: convA.id,
        startUtc: destino.startUtc,
      }),
    });
    ok(
      "reprogramar responde 200 (NO 201): no crea un recurso nuevo",
      movida.res.status === 200,
      `status=${movida.res.status}`
    );
  }

  console.log("\n== 015: el operador y el enlace pendiente (US4) ==");
  const bookingId = creada.json?.bookingId;
  const cancelada1 = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel" }),
  });
  const cancelada2 = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel" }),
  });
  ok(
    "cancelar dos veces no falla (idempotente)",
    cancelada1.res.ok && cancelada2.res.ok,
    `${cancelada1.res.status}/${cancelada2.res.status}`
  );

  const reintentoInvalido = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "retry_link" }),
  });
  ok(
    "reintentar el enlace de una cita que sí lo tiene → 422",
    reintentoInvalido.res.status === 422,
    `status=${reintentoInvalido.res.status}`
  );

  // El conector caído: la cita SE CREA igual, con el enlace pendiente.
  await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ connector: "zoom" }),
  });
  const ofertaPend = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const slotPend = (ofertaPend.json?.slots ?? [])[0];
  if (slotPend) {
    const sinProveedor = await bot("/api/bot/bookings", {
      method: "POST",
      body: JSON.stringify({
        conversationId: convA.id,
        startUtc: slotPend.startUtc,
      }),
    });
    ok(
      "con el proveedor sin conectar, la cita SE CREA igual (201)",
      sinProveedor.res.status === 201,
      `status=${sinProveedor.res.status}`
    );
    ok(
      "…y avisa que el enlace queda pendiente, en vez de prometerlo",
      sinProveedor.json?.linkPending === true &&
        sinProveedor.json?.meetingLink === null,
      JSON.stringify(sinProveedor.json)
    );

    const listaPend = (await api("/api/bookings")).json?.bookings ?? [];
    ok(
      "la cita sin enlace se ve como tal en Citas",
      listaPend.some(
        (b) => b.id === sinProveedor.json?.bookingId && b.linkPending === true
      )
    );
  }

  // Se restaura el conector soberano para no dejar la instancia a medias.
  await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ connector: "enlace-fijo" }),
  });

  console.log("\n== 015: conector Zoom contra su mock ==");
  const zoomMockUp = await fetch(`${BASE}/api/dev/zoom-mock/_state`);
  if (!zoomMockUp.ok) {
    console.log("  (zoom-mock no disponible: se omiten los checks del conector)");
  } else {
    await fetch(`${BASE}/api/dev/zoom-mock/_reset`, { method: "POST" });

    const malas = await api("/api/settings/zoom", {
      method: "PUT",
      body: JSON.stringify({
        accountId: "acc",
        clientId: "cli",
        clientSecret: "secreto-invalid",
      }),
    });
    ok(
      "credenciales que el proveedor rechaza NO se guardan (422)",
      malas.res.status === 422,
      `status=${malas.res.status}`
    );
    ok(
      "…y la conexión sigue sin existir",
      (await api("/api/settings/zoom")).json?.connection === null
    );

    const buenas = await api("/api/settings/zoom", {
      method: "PUT",
      body: JSON.stringify({
        accountId: "acc",
        clientId: "cli",
        clientSecret: "secreto-bueno",
      }),
    });
    ok("credenciales válidas se guardan", buenas.res.ok, `status=${buenas.res.status}`);
    ok(
      "hacia el navegador solo salen los últimos 4 del secreto",
      buenas.json?.connection?.secretLast4 === "ueno" &&
        !JSON.stringify(buenas.json).includes("secreto-bueno"),
      JSON.stringify(buenas.json)
    );

    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ connector: "zoom" }),
    });
    const ofertaZoom = await bot(
      `/api/bot/availability?conversationId=${convB.id}&limit=12&perDay=3&days=5`
    );
    const slotZoom = (ofertaZoom.json?.slots ?? [])[0];
    if (slotZoom) {
      const conZoom = await bot("/api/bot/bookings", {
        method: "POST",
        body: JSON.stringify({
          conversationId: convB.id,
          startUtc: slotZoom.startUtc,
        }),
      });
      ok(
        "agendar con Zoom crea la reunión y devuelve su enlace",
        conZoom.res.status === 201 &&
          typeof conZoom.json?.meetingLink === "string" &&
          conZoom.json.meetingLink.includes("zoom.mock"),
        JSON.stringify(conZoom.json)
      );

      const estado = await (await fetch(`${BASE}/api/dev/zoom-mock/_state`)).json();
      ok(
        "el proveedor recibió la reunión con su tema y su hora",
        estado.meetings?.length === 1 &&
          estado.meetings[0].topic.startsWith("Cita —"),
        JSON.stringify(estado.meetings)
      );

      // Cancelar borra la reunión en el proveedor.
      await api(`/api/bookings/${conZoom.json.bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      });
      const estado2 = await (await fetch(`${BASE}/api/dev/zoom-mock/_state`)).json();
      ok(
        "cancelar la cita borra la reunión en el proveedor",
        (estado2.deleted ?? []).length === 1,
        JSON.stringify(estado2)
      );
    }

    await api("/api/settings/zoom", { method: "DELETE" });
    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ connector: "enlace-fijo" }),
    });
  }

  // Google: «Probar» con el scope que pide la guía. El mock responde 403 a
  // calendars.get —como Google con `calendar.events`— así que si la prueba de
  // conexión vuelve a usarlo, aquí sale rojo (hallazgo 2026-09-17 en LanCo).
  console.log("\n== 015: conector Google contra su mock ==");
  const googleMockUp = await fetch(`${BASE}/api/dev/google-mock/_state`);
  if (!googleMockUp.ok) {
    console.log("  (google-mock no disponible: se omiten los checks del conector)");
  } else {
    await fetch(`${BASE}/api/dev/google-mock/_reset`, { method: "POST" });
    const revocado = await api("/api/settings/google", {
      method: "PUT",
      body: JSON.stringify({
        clientId: "cli.apps.googleusercontent.com",
        clientSecret: "secreto-google",
        refreshToken: "ref-invalid",
      }),
    });
    ok(
      "un refresh token revocado NO se guarda (422) y el error explica el modo prueba",
      revocado.res.status === 422 && /modo prueba/.test(JSON.stringify(revocado.json)),
      `status=${revocado.res.status} ${JSON.stringify(revocado.json)}`
    );
    const conectado = await api("/api/settings/google", {
      method: "PUT",
      body: JSON.stringify({
        clientId: "cli.apps.googleusercontent.com",
        clientSecret: "secreto-google",
        refreshToken: "ref-bueno",
      }),
    });
    // El mock da 403 a calendars.get: un 200 aquí prueba que «Probar» pasó
    // por events.list, el único camino que `calendar.events` autoriza.
    ok(
      "con calendar.events, «Probar» conecta (events.list; calendars.get daría 403)",
      conectado.res.ok && conectado.json?.connection?.status === "connected",
      `status=${conectado.res.status} ${JSON.stringify(conectado.json)}`
    );
    ok(
      "hacia el navegador solo salen los últimos 4 del secreto de Google",
      conectado.json?.connection?.secretLast4 === "ogle" &&
        !JSON.stringify(conectado.json).includes("secreto-google") &&
        !JSON.stringify(conectado.json).includes("ref-bueno"),
      JSON.stringify(conectado.json)
    );
    await api("/api/settings/google", { method: "DELETE" });
  }

  /* ---------- El agente INCLUIDO ofrece y agenda solo (FR-023, FR-025) ---------- */
  //
  // Hasta aquí la agenda se ejercitaba solo por /api/bot/* (cerebro externo, que
  // manda el ISO exacto). El agente incluido con LLM real fallaba en LanCo
  // (2026-09-17): ofrecía bien y después re-ofrecía en bucle, porque el modelo
  // nunca veía el instante exacto de lo ofrecido. Este tramo conduce ese camino
  // por wa-mock: el ai-mock solo reserva si el prompt trae el bloque HORARIOS
  // OFRECIDOS, así que si ese contexto deja de viajar, la cita no aparece.
  console.log("\n== 015: el agente incluido ofrece y agenda (FR-023/FR-025) ==");
  {
    const coalesce = Number(process.env.AGENT_COALESCE_MS ?? 6000);
    const ventana = coalesce + 8000;
    const alCable = (lead) => (lead.startsWith("521") ? `52${lead.slice(3)}` : lead);
    const outboxDe = async (to) =>
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter(
        (o) => o.to === to || o.to === alCable(to)
      );
    const textoDe = (o) => o?.body?.text?.body ?? JSON.stringify(o?.body ?? "");
    /**
     * Manda un inbound y espera la PRIMERA respuesta del agente a ese lead.
     * Devuelve también cuánto tardó: un `null` sin el tiempo no deja
     * distinguir "el agente no contestó" de "contestó fuera de la ventana",
     * que son dos diagnósticos muy distintos.
     */
    async function decir(lead, texto, n, nombre = "Lead agenda C") {
      const antes = (await outboxDe(lead)).length;
      const t0 = Date.now();
      await api("/api/dev/wa-mock/inbound", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: PN,
          from: lead,
          name: nombre,
          text: texto,
          waMessageId: `wamid.e2e.015.agente.${n}`,
        }),
      });
      const hasta = Date.now() + ventana;
      while (Date.now() < hasta) {
        const ahora = await outboxDe(lead);
        if (ahora.length > antes) {
          return { text: textoDe(ahora[ahora.length - 1]), ms: Date.now() - t0 };
        }
        await sleep(400);
      }
      return { text: null, ms: Date.now() - t0 };
    }

    const perfilAntes = (await api("/api/agent/profile")).json?.profile;
    await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });

    // Turno de descarte: el PRIMER turno del agente en la corrida paga el
    // arranque en frío (el pipeline y el proveedor entran por primera vez), y
    // con el debounce encima se come la ventana. Se paga aquí, fuera de los
    // checks, para que lo que se mide sea el comportamiento y no el arranque.
    const calentar = await decir("5214627015009", "hola", "0", "Lead calentamiento");
    console.log(`  (turno de calentamiento: ${calentar.ms} ms)`);

    const LEAD_C = "5214627015003";
    // El primer hueco libre ANTES de ofrecer: es el que "el primero" debe reservar.
    const primeroLibre = ((await api("/api/calendar/availability")).json?.slots ?? [])[0];

    const oferta = await decir(LEAD_C, "Hola, quiero agendar una cita", "1");
    ok(
      "«quiero agendar una cita» → el agente ofrece horarios reales (offer_slots)",
      typeof oferta.text === "string" && oferta.text.includes("•"),
      JSON.stringify(oferta)
    );
    const reserva = await decir(LEAD_C, "El primer horario, agéndamelo por favor", "2");
    ok(
      "«el primer horario» → el agente agenda copiando el ISO ofrecido (book_slot)",
      typeof reserva.text === "string" && /queda agendado|Te agendé/i.test(reserva.text),
      JSON.stringify(reserva)
    );
    ok(
      "…y comparte la sala fija en la confirmación",
      typeof reserva.text === "string" && reserva.text.includes(SALA),
      JSON.stringify(reserva)
    );
    console.log(`  (turnos de agenda: ${oferta.ms} ms y ${reserva.ms} ms)`);
    const citaC = ((await api("/api/bookings")).json?.bookings ?? []).find(
      (b) => b.contact?.name === "Lead agenda C" && b.status === "agendada"
    );
    ok(
      "la cita existe en Citas, agendada por la IA, en el primer hueco que se ofreció",
      citaC?.source === "ai" &&
        Boolean(primeroLibre) &&
        citaC?.scheduledAtUtc === primeroLibre?.startUtc,
      JSON.stringify({ citaC, primeroLibre })
    );

    /* -- El cliente no elige del menú: pide SU hora (ajuste 2026-09-23) -- */
    //
    // Medido en vivo en LanCo con un cliente real: tras ver tres horarios pidió
    // «para mañana a las 11am». Las 11:00 estaban LIBRES, pero el catálogo solo
    // registraba tres huecos por día, así que no había ISO que copiar y el
    // agente le contestó que no había disponibilidad. Si el catálogo vuelve a
    // ser ralo, este check se pone rojo.
    const libres = (await api("/api/calendar/availability")).json?.slots ?? [];
    const dia0 = libres[0]?.dayIso;
    const delDia = libres.filter((s) => s.dayIso === dia0);
    if (delDia.length > 4) {
      const pedido = delDia[Math.min(5, delDia.length - 1)];
      const LEAD_D = "5214627015004";
      async function decirD(texto, n) {
        const antes = (await outboxDe(LEAD_D)).length;
        await api("/api/dev/wa-mock/inbound", {
          method: "POST",
          body: JSON.stringify({
            phoneNumberId: PN,
            from: LEAD_D,
            name: "Lead agenda D",
            text: texto,
            waMessageId: `wamid.e2e.015.hora.${n}`,
          }),
        });
        const hasta = Date.now() + ventana;
        while (Date.now() < hasta) {
          const ahora = await outboxDe(LEAD_D);
          if (ahora.length > antes) return textoDe(ahora[ahora.length - 1]);
          await sleep(400);
        }
        return null;
      }

        // AGENDA_MODEL (ajuste 2026-09-23): el modelo bueno SOLO en la ventana
      // de elegir horario. Es una promesa de costo, así que se comprueba con
      // el modelo que el ai-mock recibió en cada turno, no de palabra.
      const AGENDA_MODEL = (process.env.AGENDA_MODEL ?? "").trim();
      const MODELO_BASE = (process.env.OPENROUTER_MODEL ?? "").trim();
      await fetch(`${BASE}/api/dev/ai-mock/_state`, { method: "POST" });

      const menu = await decirD("Hola, quiero agendar una cita", "1");
      ok(
        "el menú avisa de que hay más horarios que los tres que enseña",
        typeof menu === "string" && /otra hora|otro d[ií]a/i.test(menu),
        JSON.stringify(menu)
      );
      const trasMenu = (await (await fetch(`${BASE}/api/dev/ai-mock/_state`)).json())
        .lastModel;
      const respuesta = await decirD(`Mejor a las ${pedido.time}`, "2");
      const trasElegir = (await (await fetch(`${BASE}/api/dev/ai-mock/_state`)).json())
        .lastModel;
      if (AGENDA_MODEL) {
        ok(
          "el turno de ENTRADA no paga el modelo de agenda",
          trasMenu === MODELO_BASE,
          JSON.stringify({ trasMenu, MODELO_BASE })
        );
        ok(
          "el turno de ELEGIR horario sí lo usa (AGENDA_MODEL)",
          trasElegir === AGENDA_MODEL,
          JSON.stringify({ trasElegir, AGENDA_MODEL })
        );
      } else {
        ok(
          "sin AGENDA_MODEL, todos los turnos usan el modelo de siempre",
          trasMenu === MODELO_BASE && trasElegir === MODELO_BASE,
          JSON.stringify({ trasMenu, trasElegir, MODELO_BASE })
        );
      }
      ok(
        "una hora libre FUERA del menú se agenda, no se rechaza",
        typeof respuesta === "string" && /queda agendado|Te agendé/i.test(respuesta),
        JSON.stringify({ pidio: pedido.time, respuesta })
      );
      ok(
        "…y NUNCA se le dice al cliente que no hay disponibilidad",
        typeof respuesta === "string" &&
          !/no hay disponibilidad|no tengo disponibilidad|est[áa] ocupad|lleno/i.test(respuesta),
        JSON.stringify(respuesta)
      );
      const citaD = ((await api("/api/bookings")).json?.bookings ?? []).find(
        (b) => b.contact?.name === "Lead agenda D" && b.status === "agendada"
      );
      ok(
        "la cita quedó en la hora que pidió el cliente, no en la del menú",
        citaD?.scheduledAtUtc === pedido.startUtc,
        JSON.stringify({ pedido, citaD })
      );
    } else {
      console.log("  (quedan pocos huecos hoy: se omite el check de «pide su hora»)");
    }

    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: perfilAntes?.enabled ?? false }),
    });
  }

  // El sandbox del Laboratorio (una cita de prueba jamás llega a un conector)
  // NO se verifica aquí: las conversaciones del Laboratorio no son alcanzables
  // desde la API pública —a propósito—, así que desde fuera solo podría
  // observarse por ausencia, que es una prueba débil. Vive en
  // `tests/unit/agenda-sandbox.test.ts`, que afirma lo que de verdad importa:
  // que el conector no se llama, ni al crear, ni al reprogramar, ni al
  // cancelar.
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});

/* ============================================================
 * 026 — Conector INVENTARIO (tests/e2e/us-inventario.md)
 *
 * La bandera `INVENTARIO` decide qué mitad corre: apagada, se afirma que el
 * conector NO EXISTE (404, ni acción, ni prompt); encendida, el botón con su
 * pase, el agente consultando al stock-mock (feliz e infeliz) y el estado en
 * Ajustes. Ambas mitades corren en la matriz de CI.
 * ============================================================ */
async function inventarioChecks() {
  const encendida = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.INVENTARIO ?? "").trim()
  );
  const STOCK = (process.env.STOCK_BASE_URL ?? "").replace(/\/+$/, "");
  // El agente junta ráfagas con un debounce: se sondea, no se duerme.
  const coalesce = Number(process.env.AGENT_COALESCE_MS ?? 6000);
  const ventana = coalesce + 8000;

  // El CRM normaliza 521… → 52… (identity.ts): por el cable sale sin el 1.
  const alCable = (lead) => (lead.startsWith("521") ? `52${lead.slice(3)}` : lead);
  const outboxDe = async (to) =>
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter(
      (o) => o.to === to || o.to === alCable(to)
    );
  // Un texto sale como `text.body`; la foto del producto (§4) lleva el texto
  // como pie de la imagen: para el guion, el "texto" de ese mensaje es su pie.
  const textoDe = (o) =>
    o?.body?.text?.body ?? o?.body?.image?.caption ?? JSON.stringify(o?.body ?? "");
  /** Manda un inbound y espera la PRIMERA respuesta del agente a ese lead. */
  async function preguntar(lead, texto, n) {
    const antes = (await outboxDe(lead)).length;
    const t0 = Date.now();
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: lead,
        name: `Lead inventario ${n}`,
        text: texto,
        waMessageId: `wamid.e2e.026.${n}`,
      }),
    });
    const hasta = Date.now() + ventana;
    while (Date.now() < hasta) {
      const ahora = await outboxDe(lead);
      if (ahora.length > antes) {
        return { text: textoDe(ahora[ahora.length - 1]), ms: Date.now() - t0 };
      }
      await sleep(400);
    }
    return { text: null, ms: Date.now() - t0 };
  }

  console.log("\n== 026: la bandera del conector de inventario ==");
  const rutas = ["/api/inventario/sso", "/api/inventario/status"];
  if (!encendida) {
    for (const ruta of rutas) {
      const res = (await api(ruta, { redirect: "manual" })).res;
      ok(`${ruta} → 404 con el conector apagado`, res.status === 404, `status=${res.status}`);
    }
    const pagina = await fetch(`${BASE}/settings/inventario`, {
      headers: { cookie },
      redirect: "manual",
    });
    ok("/settings/inventario → 404 con el conector apagado", pagina.status === 404, `status=${pagina.status}`);

    const perfilAntes = (await api("/api/agent/profile")).json?.profile;
    await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    const r = await preguntar("5214627026900", "¿tienen playera negra?", "off.1");
    ok(
      "apagado: '¿tienen playera negra?' recibe el eco de siempre (el agente no conoce check_stock)",
      typeof r.text === "string" && r.text.includes("Respuesta de prueba"),
      JSON.stringify(r)
    );
    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: perfilAntes?.enabled ?? false }),
    });
    console.log("  (conector apagado: el resto de los checks de 026 no aplican)");
    return;
  }

  const mockUp = await fetch(`${STOCK}/_state`);
  if (!mockUp.ok) {
    ok("stock-mock disponible en STOCK_BASE_URL", false, `${STOCK}/_state → ${mockUp.status}`);
    return;
  }
  const modo = (mode) =>
    fetch(`${STOCK}/_mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  const reset = () => fetch(`${STOCK}/_reset`, { method: "POST" });
  await reset();

  /* ---------- US2: el agente consulta existencias reales ---------- */
  console.log("\n== 026: check_stock del agente (US2) ==");
  const perfilAntes = (await api("/api/agent/profile")).json?.profile;
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });

  const casos = [
    ["5214627026001", "¿tienen playera negra?", "Playera negra (PLY-NEG): 7 pieza — $199 MXN", "un producto: nombre, SKU, existencia, unidad y precio"],
    ["5214627026002", "¿tienen gorra?", "Gorra (GOR-01): 3 pieza — sin precio", "sin precio; la gorra inactiva no aparece"],
    ["5214627026003", "¿tienen playera blanca?", "Playera blanca (PLY-BLA): agotado", "agotado"],
    ["5214627026004", "¿tienen zapatos?", "No encontré productos para «zapatos»", "sin coincidencias"],
    ["5214627026005", "¿cuánto cuesta la PLY-NEG?", "$199 MXN", "SKU exacto → precio"],
  ];
  let i = 0;
  for (const [lead, pregunta, esperado, titulo] of casos) {
    const r = await preguntar(lead, pregunta, `us2.${++i}`);
    ok(`${titulo}`, typeof r.text === "string" && r.text.includes(esperado), JSON.stringify(r));
  }
  const gorra = await outboxDe("5214627026002");
  ok(
    "la gorra inactiva (GOR-02) nunca aparece",
    !gorra.some((o) => textoDe(o).includes("GOR-02"))
  );
  ok(
    "la frase del modelo precede a los datos",
    (await outboxDe("5214627026001")).some((o) => textoDe(o).startsWith("Déjame revisar.\n"))
  );

  /* ---------- Tallas (contrato §4 "Forma exacta", FR-1122..FR-1126, SC-009) ---------- */
  console.log("\n== 026: tallas en check_stock ==");
  const tallas = [
    ["5214627026011", "¿tienen playera roja?", "Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1", "modelo sin talla pedida: una línea con cada talla en orden, agotadas incluidas"],
    ["5214627026012", "¿tienen playera roja en G?", "Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN", "talla pedida con existencia"],
    ["5214627026013", "¿tienen playera roja en M?", "Playera roja (PLY-ROJ) talla M: agotada — $219 MXN. Con existencia: CH 4, G 7, XG 1", "talla pedida agotada: ofrece las que sí hay"],
    ["5214627026014", "¿tienen playera roja en XXG?", "Playera roja (PLY-ROJ) no viene en talla XXG. Tallas: CH 4, M agotada, G 7, XG 1", "talla que el modelo no tiene"],
    ["5214627026015", "¿cuánto cuesta la PLY-ROJ-G?", "Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN", "SKU exacto de una talla"],
  ];
  let t = 0;
  for (const [lead, pregunta, esperado, titulo] of tallas) {
    const r = await preguntar(lead, pregunta, `tallas.${++t}`);
    ok(`${titulo}`, typeof r.text === "string" && r.text.includes(esperado), JSON.stringify(r));
  }
  const rojaOut = await outboxDe("5214627026011");
  ok(
    "el modelo sin foto sale como texto; ninguna cifra la redactó el modelo (la frase precede a los datos)",
    rojaOut.length === 1 && rojaOut[0].type === "text" && textoDe(rojaOut[0]).startsWith("Déjame revisar.\n"),
    JSON.stringify(rojaOut.map((o) => [o.type, textoDe(o)]))
  );

  /* ---------- 028: respuesta por talla y fotos por producto (FR-1301..FR-1309) ---------- */
  console.log("\n== 028: respuesta por talla y fotos por producto ==");
  /**
   * Un turno de la 028 puede ser VARIOS mensajes: se espera al primero y luego a que
   * el outbox del lead deje de crecer (1.5 s sin novedad), y se devuelven todos.
   */
  async function preguntarVarios(lead, texto, n, esperados = 0) {
    const antes = (await outboxDe(lead)).length;
    const t0 = Date.now();
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: lead,
        name: `Lead inventario ${n}`,
        text: texto,
        waMessageId: `wamid.e2e.028.${n}`,
      }),
    });
    const hasta = Date.now() + ventana;
    let vistos = antes;
    let quieto = 0;
    while (Date.now() < hasta) {
      const ahora = (await outboxDe(lead)).length;
      if (ahora > vistos) {
        vistos = ahora;
        quieto = Date.now();
      }
      // Con `esperados`, se espera a que lleguen todos (una foto lenta tarda 5 s en
      // degradar a texto); sin él, a 1.5 s sin novedad tras el primero.
      if (esperados > 0 ? vistos - antes >= esperados : vistos > antes && Date.now() - quieto > 1500) {
        break;
      }
      await sleep(300);
    }
    const todos = await outboxDe(lead);
    return { salientes: todos.slice(antes), ms: Date.now() - t0 };
  }
  const resumen = (salientes) => salientes.map((o) => [o.type, textoDe(o), o.body?.image?.link ?? null]);
  const ORIGEN = new URL(STOCK).origin;
  const fotoDe = (path) => `${ORIGEN}${path}`;

  // US1.1 — talla pedida, varios modelos, en plural: solo los con existencia en G.
  const enG = await preguntarVarios("5214627028001", "¿tienen playeras en G?", "us1.G", 3);
  ok(
    "«playeras en G» (plural): tres salientes en orden — negra (imagen, talla única), roja (texto, sin foto), gris (imagen)",
    resumen(enG.salientes).length === 3 &&
      enG.salientes[0].type === "image" &&
      enG.salientes[0].body?.image?.link === fotoDe("/icon-192.png") &&
      textoDe(enG.salientes[0]) === "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN" &&
      enG.salientes[1].type === "text" &&
      textoDe(enG.salientes[1]) === "Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN" &&
      enG.salientes[2].type === "image" &&
      enG.salientes[2].body?.image?.link === fotoDe("/icon-512.png?m=grs") &&
      textoDe(enG.salientes[2]) === "Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN",
    JSON.stringify(resumen(enG.salientes))
  );
  ok(
    "ningún saliente menciona agotados, «no viene» ni otras tallas; la URL de la foto no va en ningún texto",
    enG.salientes.every((o) => !/agotad|no viene|Tallas:|icon-/.test(textoDe(o))),
    JSON.stringify(resumen(enG.salientes))
  );

  // US1.2 — en M: roja y gris agotadas en M, azul y amarilla sin M ⇒ solo negra y verde.
  const enM = await preguntarVarios("5214627028002", "¿tienen playeras en M?", "us1.M", 2);
  ok(
    "«playeras en M»: negra (imagen) y verde (imagen, talla M: 10 pieza); las demás no se mencionan",
    resumen(enM.salientes).map((r) => r[0]).join(",") === "image,image" &&
      textoDe(enM.salientes[1]) === "Playera verde (PLA-VRD) talla M: 10 pieza — $200 MXN" &&
      enM.salientes[1].body?.image?.link === fotoDe("/icon-192.png?m=vrd") &&
      !enM.salientes.some((o) => /roja|gris|azul|amarilla/i.test(textoDe(o))),
    JSON.stringify(resumen(enM.salientes))
  );

  // US1.3 — equivalencia con varios: «extra chica» ⇒ XCH (solo la azul la trae).
  const enXCH = await preguntarVarios("5214627028003", "¿tienen playeras en extra chica?", "us1.XCH", 2);
  ok(
    "«playeras en extra chica» ⇒ XCH: negra (imagen) y azul (imagen, talla XCH: 1 pieza — $800 MXN)",
    resumen(enXCH.salientes).map((r) => r[0]).join(",") === "image,image" &&
      textoDe(enXCH.salientes[1]) === "Playera azul (PLA-AZL) talla XCH: 1 pieza — $800 MXN",
    JSON.stringify(resumen(enXCH.salientes))
  );

  // US1.4 — ninguno con existencia en la talla: una frase, sin fotos, con la consulta tal cual.
  const en40 = await preguntarVarios("5214627028004", "¿tienen pantalones en 40?", "us1.40");
  ok(
    "«pantalones en 40»: un solo texto «Por ahora no tengo pantalones en talla 40.» (y el plural encontró los pantalones)",
    resumen(en40.salientes).length === 1 &&
      en40.salientes[0].type === "text" &&
      textoDe(en40.salientes[0]) === "Déjame revisar.\nPor ahora no tengo pantalones en talla 40.",
    JSON.stringify(resumen(en40.salientes))
  );

  // US1.5 — talla numérica con existencia en los dos: uno con foto, otro sin.
  const en32 = await preguntarVarios("5214627028005", "¿tienen pantalones en 32?", "us1.32", 2);
  ok(
    "«pantalones en 32»: azul (imagen, talla 32: 4 pieza) y negro (texto, talla 32: 1 pieza)",
    resumen(en32.salientes).map((r) => r[0]).join(",") === "image,text" &&
      textoDe(en32.salientes[0]) === "Déjame revisar.\nPantalón azul (PAN-AZ) talla 32: 4 pieza — $650 MXN" &&
      textoDe(en32.salientes[1]) === "Pantalón negro (PAN-NG) talla 32: 1 pieza — $650 MXN",
    JSON.stringify(resumen(en32.salientes))
  );

  // El hilo del Inbox conserva cada imagen con su URL y su pie (FR-1305 + persistencia de la 026).
  // Ajuste 2026-09-17 (FR-1314/FR-1315): el mock reporta `sent` de cada imagen como Meta y el
  // motor esperó ese estado antes del siguiente mensaje: las imágenes quedan `sent`, no `pending`.
  await sleep(700);
  const hiloG = await hiloDe("Lead inventario us1.G");
  const salidasG = hiloG.mensajes.filter((m) => m.direction === "out");
  ok(
    "el hilo del Inbox de «playeras en G» tiene 3 salidas IA: image · text · image, con URL y pie, sin failed",
    salidasG.length === 3 &&
      salidasG.map((m) => m.type).join(",") === "image,text,image" &&
      salidasG.every((m) => m.aiGenerated === true && m.status !== "failed") &&
      salidasG[0]?.media?.payload?.url === fotoDe("/icon-192.png") &&
      salidasG[2]?.media?.payload?.url === fotoDe("/icon-512.png?m=grs") &&
      salidasG[2]?.media?.caption === salidasG[2]?.text,
    JSON.stringify(salidasG.map((m) => [m.type, m.text, m.media?.payload?.url, m.status]))
  );
  ok(
    "orden garantizado (FR-1314): las dos imágenes quedaron `sent` (el motor esperó el estado de la primera antes de seguir) y el outbox va negra · roja · gris",
    salidasG.filter((m) => m.type === "image").every((m) => m.status === "sent") &&
      enG.salientes.map((o) => o.type).join(",") === "image,text,image",
    JSON.stringify(salidasG.map((m) => [m.type, m.status]))
  );

  // US4 — una foto falla: esa línea sale como texto, en su lugar; las demás con foto (FR-1306).
  const modoImagen = (mode, link) =>
    api("/api/dev/wa-mock/media-mode", { method: "POST", body: JSON.stringify(link ? { mode, link } : { mode }) });
  await modoImagen("reject", "m=grs");
  const rechazoG = await preguntarVarios("5214627028006", "¿tienen playeras en G?", "us4.reject", 3);
  ok(
    "Meta rechaza SOLO la foto de la gris: negra (imagen) · roja (texto) · gris (TEXTO con su línea), en ese orden",
    resumen(rechazoG.salientes).map((r) => r[0]).join(",") === "image,text,text" &&
      textoDe(rechazoG.salientes[2]) === "Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN" &&
      rechazoG.salientes[0].body?.image?.link === fotoDe("/icon-192.png"),
    JSON.stringify(resumen(rechazoG.salientes))
  );
  const hiloRechazoG = await hiloDe("Lead inventario us4.reject");
  const salidasRechazo = hiloRechazoG.mensajes.filter((m) => m.direction === "out");
  ok(
    "y el hilo no enseña ningún mensaje fallido: 3 salidas (image, text, text), ninguna failed",
    salidasRechazo.length === 3 &&
      salidasRechazo.map((m) => m.type).join(",") === "image,text,text" &&
      salidasRechazo.every((m) => m.status !== "failed"),
    JSON.stringify(salidasRechazo.map((m) => [m.type, m.status]))
  );
  await modoImagen("slow", "m=vrd");
  const lentaM = await preguntarVarios("5214627028007", "¿tienen playeras en M?", "us4.slow", 2);
  ok(
    `Meta tarda SOLO con la foto de la verde: negra (imagen) y verde como texto, dentro del límite (${lentaM.ms} ms)`,
    resumen(lentaM.salientes).map((r) => r[0]).join(",") === "image,text" &&
      textoDe(lentaM.salientes[1]) === "Playera verde (PLA-VRD) talla M: 10 pieza — $200 MXN" &&
      lentaM.ms < coalesce + 5000 + 4000,
    JSON.stringify({ ...lentaM, salientes: resumen(lentaM.salientes) })
  );
  await api("/api/dev/wa-mock/media-mode", { method: "DELETE" });
  // El mock lento termina igual (como Meta): se le deja acabar para que no
  // contamine a los siguientes leads.
  await sleep(7500);

  /* ---------- Foto del producto (contrato §4, FR-1119..FR-1121; varios resultados según la 028) ---------- */
  console.log("\n== 026: foto del producto en check_stock ==");
  // El stock-mock arma image_url con el origen de la petición: la app misma.
  const FOTO = `${new URL(STOCK).origin}/icon-192.png`;
  const mediaMode = (mode) =>
    api("/api/dev/wa-mock/media-mode", { method: "POST", body: JSON.stringify({ mode }) });
  /** Hilo persistido de un lead (lo que ve el operador en el Inbox). */
  async function hiloDe(nombre) {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    const conv = convs.find((c) => c.contact?.name === nombre);
    if (!conv) return { conv: null, mensajes: [] };
    const mensajes = (await api(`/api/conversations/${conv.id}/messages`)).json?.messages ?? [];
    return { conv, mensajes };
  }

  const negra = await outboxDe("5214627026001");
  ok(
    "PLY-NEG (con foto): UN solo mensaje saliente, de tipo image",
    negra.length === 1 && negra[0].type === "image",
    JSON.stringify(negra.map((o) => o.type))
  );
  ok(
    "la imagen va por link = image_url del producto, sin descargar ni proxear",
    negra[0]?.body?.image?.link === FOTO,
    JSON.stringify(negra[0]?.body?.image)
  );
  ok(
    "el texto del turno viaja como pie de la foto (frase del modelo + datos)",
    negra[0]?.body?.image?.caption === "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN",
    JSON.stringify(negra[0]?.body?.image?.caption)
  );
  const gorra1 = await outboxDe("5214627026002");
  ok(
    "producto sin foto (gorra): solo texto, como siempre",
    gorra1.length === 1 && gorra1[0].type === "text",
    JSON.stringify(gorra1.map((o) => o.type))
  );
  // 028 (deroga en parte FR-1119/FR-1111): con varios resultados, un mensaje por modelo
  // CON existencia, en orden, cada uno con su foto; agotados fuera; tope 5 + cierre.
  const varias = await preguntarVarios("5214627026006", "¿tienen playera?", "foto.varias", 6);
  const variasOut = varias.salientes;
  ok(
    "búsqueda con varios resultados (028): un mensaje por modelo con existencia, con su foto; la blanca agotada no aparece; 5 + «Hay más coincidencias»",
    variasOut.length === 6 &&
      variasOut.map((o) => o.type).join(",") === "image,text,image,image,image,text" &&
      textoDe(variasOut[0]) === "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN" &&
      variasOut[0].body?.image?.link === FOTO &&
      textoDe(variasOut[1]) === "Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1" &&
      textoDe(variasOut[5]) === "Hay más coincidencias, ¿me dices cuál te interesa?" &&
      !variasOut.some((o) => textoDe(o).includes("PLY-BLA")) &&
      new Set(variasOut.filter((o) => o.type === "image").map((o) => o.body?.image?.link)).size === 4,
    JSON.stringify(variasOut.map((o) => [o.type, textoDe(o)]))
  );
  ok(
    "image_url nunca aparece en el texto que recibe el cliente",
    [...negra, ...gorra1, ...variasOut].every((o) => !textoDe(o).includes("icon-192")),
  );

  // Lo que ve el operador: el hilo guarda la imagen por URL con el pie como texto.
  const hiloNegra = await hiloDe("Lead inventario us2.1");
  const fotoEnHilo = hiloNegra.mensajes.filter((m) => m.direction === "out").at(-1);
  ok(
    "el hilo del Inbox guarda el mensaje como image con la URL pública y el pie como texto",
    fotoEnHilo?.type === "image" &&
      fotoEnHilo?.media?.kind === "image" &&
      fotoEnHilo?.media?.payload?.url === FOTO &&
      fotoEnHilo?.media?.caption === fotoEnHilo?.text &&
      fotoEnHilo?.aiGenerated === true &&
      fotoEnHilo?.status !== "failed",
    JSON.stringify(fotoEnHilo)
  );
  if (fotoEnHilo?.media?.assetId) {
    const ver = await fetch(`${BASE}/api/media/${fotoEnHilo.media.assetId}`, {
      headers: { cookie },
      redirect: "manual",
    });
    ok(
      "/api/media del asset por URL redirige (302) a la URL pública, sin servir bytes",
      ver.status === 302 && ver.headers.get("location") === FOTO,
      `status=${ver.status} location=${ver.headers.get("location")}`
    );
  }

  // Meta rechaza el link ⇒ solo texto, sin retraso y sin fallo visible.
  await mediaMode("reject");
  const rechazo = await preguntar("5214627026007", "¿tienen playera negra?", "foto.reject");
  const rechazoOut = await outboxDe("5214627026007");
  ok(
    `Meta rechaza la imagen: sale solo el texto (${rechazo.ms} ms) y ninguna imagen`,
    rechazoOut.length === 1 &&
      rechazoOut[0].type === "text" &&
      rechazo.text === "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN",
    JSON.stringify({ tipos: rechazoOut.map((o) => o.type), texto: rechazo.text })
  );
  const hiloRechazo = await hiloDe("Lead inventario foto.reject");
  ok(
    "y el hilo no enseña ningún mensaje fallido (el cliente nunca vio un error)",
    hiloRechazo.mensajes.length > 0 &&
      hiloRechazo.mensajes.every((m) => m.status !== "failed") &&
      hiloRechazo.mensajes.filter((m) => m.direction === "out").length === 1,
    JSON.stringify(hiloRechazo.mensajes.map((m) => [m.direction, m.type, m.status]))
  );

  // Meta tarda más de 5 s ⇒ el texto sale solo dentro del límite.
  await mediaMode("slow");
  const lento = await preguntar("5214627026008", "¿tienen playera negra?", "foto.slow");
  ok(
    `Meta tarda con la imagen: el texto sale solo en ${lento.ms} ms (< coalescencia + 5 s + margen)`,
    typeof lento.text === "string" &&
      lento.text.includes("Playera negra (PLY-NEG)") &&
      (await outboxDe("5214627026008"))[0]?.type === "text" &&
      lento.ms < coalesce + 5000 + 2500,
    JSON.stringify(lento)
  );
  await mediaMode("ok");
  // El mock lento termina igual (como Meta): se le deja acabar para que no
  // contamine a los siguientes leads.
  await sleep(2500);

  // Meta acepta y DESPUÉS reporta failed ⇒ el pie sale como texto, una vez.
  const wamidFoto = negra[0]?.waMessageId;
  const antesRespaldo = (await outboxDe("5214627026001")).length;
  const fallo = await api("/api/dev/wa-mock/status", {
    method: "POST",
    body: JSON.stringify({
      waMessageId: wamidFoto,
      status: "failed",
      errorCode: 131053,
      errorMessage: "Media upload error",
    }),
  });
  await sleep(1200);
  const trasRespaldo = await outboxDe("5214627026001");
  ok(
    "failed tardío de la foto: el texto del pie sale como mensaje de texto",
    fallo.res.ok &&
      trasRespaldo.length === antesRespaldo + 1 &&
      trasRespaldo.at(-1)?.type === "text" &&
      textoDe(trasRespaldo.at(-1)) === negra[0]?.body?.image?.caption,
    JSON.stringify({ status: fallo.res.status, tipos: trasRespaldo.map((o) => o.type) })
  );
  await api("/api/dev/wa-mock/status", {
    method: "POST",
    body: JSON.stringify({ waMessageId: wamidFoto, status: "failed", errorCode: 131053 }),
  });
  await sleep(800);
  ok(
    "un failed repetido no lo manda dos veces (estados monotónicos)",
    (await outboxDe("5214627026001")).length === antesRespaldo + 1
  );
  const hiloTrasFallo = await hiloDe("Lead inventario us2.1");
  ok(
    "en el hilo, la foto queda failed con su motivo y el texto de respaldo va después",
    hiloTrasFallo.mensajes.some((m) => m.type === "image" && m.status === "failed") &&
      hiloTrasFallo.mensajes.at(-1)?.type === "text" &&
      hiloTrasFallo.mensajes.at(-1)?.aiGenerated === true,
    JSON.stringify(hiloTrasFallo.mensajes.map((m) => [m.direction, m.type, m.status]))
  );

  console.log("\n== 026: degradación cuando MS-Stock falla (US2, camino infeliz) ==");
  const modos = ["down", "unauthorized", "slow", "garbage"];
  let j = 0;
  for (const m of modos) {
    await modo(m);
    const r = await preguntar(`521462702610${j}`, "¿tienen playera negra?", `us2.inf.${++j}`);
    const limpio =
      typeof r.text === "string" &&
      r.text.trim() === "Déjame revisar." &&
      !/error|503|unauthorized|timeout|inventario/i.test(r.text);
    ok(
      `modo ${m}: el agente responde solo con la frase del modelo, en ${r.ms} ms (< ${ventana})`,
      limpio && r.ms < ventana,
      JSON.stringify(r)
    );
  }
  await reset();
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: perfilAntes?.enabled ?? false }),
  });

  /* ---------- US1: el botón Inventario y el pase SSO ---------- */
  console.log("\n== 026: botón Inventario → pase SSO (US1) ==");
  const sinSesion = await fetch(`${BASE}/api/inventario/sso`, { redirect: "manual" });
  ok("sin sesión → 401 y sin pase", sinSesion.status === 401, `status=${sinSesion.status}`);

  const yo = (await api("/api/auth/get-session")).json?.user;
  const sso = await api("/api/inventario/sso", { redirect: "manual" });
  const location = sso.res.headers.get("location") ?? "";
  ok(
    "con sesión → 302 a STOCK_BASE_URL/portal/sso?token=",
    sso.res.status === 302 && location.startsWith(`${STOCK}/portal/sso?token=`),
    `status=${sso.res.status} location=${location.slice(0, 60)}`
  );
  const portal = await fetch(location);
  const portalHtml = await portal.text();
  ok(
    "el portal (mock) acepta el pase y saluda por nombre",
    portal.status === 200 && portalHtml.includes(`${yo?.name} desde Uniko`),
    `status=${portal.status} html=${portalHtml.slice(0, 80)}`
  );
  const estado1 = (await (await fetch(`${STOCK}/_state`)).json()).lastSso;
  ok(
    "el pase lleva sub, name, iss=APP_BASE_URL, aud=STOCK_BASE_URL y vida 120 s",
    estado1 &&
      estado1.sub === yo?.id &&
      estado1.name === yo?.name &&
      estado1.iss === BASE &&
      estado1.aud === STOCK &&
      estado1.exp - estado1.iat === 120,
    JSON.stringify(estado1)
  );
  const sso2 = await api("/api/inventario/sso?next=/portal/products/PLY-NEG", { redirect: "manual" });
  await fetch(sso2.res.headers.get("location") ?? "");
  const estado2 = (await (await fetch(`${STOCK}/_state`)).json()).lastSso;
  ok("cada clic emite un pase distinto (jti nuevo)", estado2?.jti && estado2.jti !== estado1?.jti);
  ok("next interno viaja en el pase", estado2?.next === "/portal/products/PLY-NEG", JSON.stringify(estado2?.next));
  const sso3 = await api("/api/inventario/sso?next=https://evil.example", { redirect: "manual" });
  await fetch(sso3.res.headers.get("location") ?? "");
  const estado3 = (await (await fetch(`${STOCK}/_state`)).json()).lastSso;
  ok("next externo NO viaja", estado3 && !("next" in estado3), JSON.stringify(estado3?.next));
  ok(
    "el pase no aparece en ningún cuerpo de respuesta de Uniko",
    !(sso.json && JSON.stringify(sso.json).includes("token="))
  );

  /* ---------- US3: estado del conector ---------- */
  console.log("\n== 026: estado del conector en Ajustes (US3) ==");
  // Este check mide lo que tarda el CONECTOR, no lo que tarda `next dev` en
  // compilar la ruta. Medido el 2026-09-23: el servidor de desarrollo descarta
  // las rutas inactivas, así que a mitad de corrida recompiló esta en 8,1 s y
  // el primer GET tardó 8.901 ms — ya compilada responde en ~100 ms. Calentar
  // al arrancar el arnés no basta (para entonces ya se descartó), así que se
  // hace aquí, pegado a la medición. Un fallo tras esto SÍ es del producto.
  await api("/api/inventario/status");
  const t0 = Date.now();
  const st = await api("/api/inventario/status");
  ok(
    "status → connected en < 5 s",
    st.res.ok && st.json?.status === "connected" && Date.now() - t0 < 5000,
    JSON.stringify(st.json)
  );
  ok("status expone la dirección, nunca la llave ni el secreto", st.json?.baseUrl === STOCK);
  await modo("unauthorized");
  ok("mock unauthorized → status unauthorized", (await api("/api/inventario/status")).json?.status === "unauthorized");
  await modo("down");
  ok("mock down → status unavailable", (await api("/api/inventario/status")).json?.status === "unavailable");
  await reset();

  const secretos = [process.env.STOCK_API_KEY ?? "", process.env.STOCK_SSO_SECRET ?? ""].filter(Boolean);
  const ajustesHtml = await (await fetch(`${BASE}/settings/inventario`, { headers: { cookie } })).text();
  ok(
    "ni la llave ni el secreto aparecen en /settings/inventario ni en status",
    secretos.every((s) => !ajustesHtml.includes(s) && !JSON.stringify(st.json).includes(s))
  );
  ok(
    "/settings/inventario existe y muestra la dirección de MS-Stock",
    ajustesHtml.includes("Probar conexión") && ajustesHtml.includes(STOCK),
    ajustesHtml.slice(0, 120)
  );
}


/* ============================================================
 * 016 — Atribución de anuncios y Conversions API (tests/e2e/us-atribucion.md)
 *
 * Cubre las dos configuraciones de la bandera, la conexión del dataset, la
 * captura del anuncio, los dos eventos con la FORMA de su payload, el dedup,
 * y —lo que más importa— que un fallo de Meta jamás cuesta el movimiento del
 * lead.
 *
 * Los contactos llevan un sufijo por corrida: el dedup de conversiones es
 * permanente por diseño, así que re-correr el arnés contra la MISMA base
 * tiene que estrenar leads o estaría midiendo los de la corrida anterior.
 * ============================================================ */

async function atribucionChecks() {
  const encendida = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.ATRIBUCION ?? "").trim()
  );
  const SUF = String(Date.now()).slice(-6);
  const tel = (n) => `52155${SUF}${n}`;
  const nom = (base) => `${base} ${SUF}`;

  console.log("\n== 016: la bandera de la atribución ==");

  if (!encendida) {
    for (const ruta of ["/api/settings/capi", "/api/settings/capi/events"]) {
      const { res } = await api(ruta);
      ok(
        `${ruta} → 404 con la atribución apagada`,
        res.status === 404,
        `status=${res.status}`
      );
    }
    const put = await api("/api/settings/capi", {
      method: "PUT",
      body: JSON.stringify({ datasetId: "ds-e2e" }),
    });
    ok(
      "PUT /api/settings/capi → 404 con la atribución apagada",
      put.res.status === 404,
      `status=${put.res.status}`
    );
    const page = await fetch(`${BASE}/settings/ads`, { headers: { cookie } });
    ok(
      "la pantalla /settings/ads no existe",
      page.status === 404,
      `status=${page.status}`
    );

    // Y un mensaje que SÍ viene de un anuncio se atiende como cualquier otro:
    // la instancia que no atribuye no se entera del referral, pero tampoco se
    // rompe con él.
    const inb = await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: tel("1"),
        name: nom("Lead con anuncio apagada"),
        text: "vi su anuncio",
        ctwaClid: "clid-apagada",
        waMessageId: `wamid.e2e.016.off.${SUF}`,
      }),
    });
    ok("inbound con anuncio entregado igual", inb.res.ok);
    await sleep(1400);
    const convsOff = (await api("/api/conversations")).json?.conversations ?? [];
    ok(
      "la conversación del anuncio existe (la ingesta no se rompe)",
      convsOff.some((c) => c.contact.name === nom("Lead con anuncio apagada"))
    );
    console.log(
      "  (atribución apagada: el resto de los checks de 016 no aplican)"
    );
    return;
  }

  /* ---------------- US2: conectar el dataset ---------------- */

  console.log("\n== 016: conectar el dataset (US2) ==");
  // Se parte de desconectado: así el primer check afirma lo que dice afirmar
  // aunque el arnés se re-corra sobre la misma base.
  await api("/api/settings/capi", { method: "DELETE" });
  const vacio = await api("/api/settings/capi");
  ok(
    "sin configurar responde 200 con capi: null (no 404)",
    vacio.res.status === 200 && vacio.json?.capi === null,
    JSON.stringify(vacio.json)
  );

  const board0 = (await api("/api/pipeline/board")).json;
  const etapaCalificado = board0.stages.filter((s) => s.kind === "open").at(-1);
  const etapaGanada = board0.stages.find((s) => s.kind === "won");
  const etapaInicial = board0.stages.find((s) => s.kind === "open");

  const etapaAjena = await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e",
      qualifiedStageId: "stg_de_otro_negocio",
    }),
  });
  ok(
    "una etapa que no es del negocio se rechaza con 422 etapa_invalida",
    etapaAjena.res.status === 422 &&
      etapaAjena.json?.error?.code === "etapa_invalida",
    `status=${etapaAjena.res.status} ${JSON.stringify(etapaAjena.json)}`
  );

  const guardado = await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e",
      qualifiedStageId: etapaCalificado.id,
    }),
  });
  ok(
    "se guarda el dataset sin pegar token",
    guardado.res.ok,
    `status=${guardado.res.status}`
  );

  const cfg = (await api("/api/settings/capi")).json?.capi;
  ok(
    "reusó el token de WhatsApp y solo muestra sus últimos 4",
    cfg?.datasetId === "ds-e2e" && cfg?.tokenLast4 === "-e2e",
    JSON.stringify(cfg)
  );
  ok(
    "el token completo NUNCA sale del servidor",
    !JSON.stringify(cfg).includes("tok-e2e"),
    JSON.stringify(cfg)
  );

  /* ---------------- US3 + US4: capturar y calificar ---------------- */

  console.log("\n== 016: del anuncio al lead calificado (US3/US4) ==");
  await api("/api/dev/wa-mock/capi-events", { method: "DELETE" });

  const CLID = `clid-e2e-${SUF}`;
  const NOMBRE_AD = nom("Lead de anuncio");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("2"),
      name: NOMBRE_AD,
      text: "hola, vengo del anuncio",
      ctwaClid: CLID,
      adHeadline: "Kit de verano",
      waMessageId: `wamid.e2e.016.ad.${SUF}.1`,
    }),
  });
  await sleep(1400);

  // Segundo mensaje con OTRO referral: el primero gana y no se sobreescribe.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("2"),
      name: NOMBRE_AD,
      text: "sigo aquí",
      ctwaClid: "clid-que-no-debe-ganar",
      waMessageId: `wamid.e2e.016.ad.${SUF}.2`,
    }),
  });
  await sleep(1200);

  const board1 = (await api("/api/pipeline/board")).json;
  const leadAd = board1.leads.find((l) => l.contact.name === NOMBRE_AD);
  ok("el lead del anuncio existe en el tablero", !!leadAd);

  const mov1 = await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaCalificado.id }),
  });
  ok(
    "el lead se mueve a la etapa calificada",
    mov1.res.ok,
    `status=${mov1.res.status}`
  );
  await sleep(800);

  const act1 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const calificado = act1.find(
    (e) => e.eventName === "QualifiedLead" && e.contactName === NOMBRE_AD
  );
  ok(
    "se reportó QualifiedLead con acuse de Meta",
    calificado?.status === "sent" && !!calificado?.fbTraceId,
    JSON.stringify(calificado)
  );
  ok(
    "la actividad dice de qué anuncio vino",
    calificado?.adHeadline === "Kit de verano",
    JSON.stringify(calificado)
  );

  const capi1 = (await api("/api/dev/wa-mock/capi-events")).json?.capiEvents ?? [];
  const evento1 = capi1.find((e) => e.eventName === "QualifiedLead");
  ok(
    "el evento viajó con el ctwa_clid del PRIMER referral",
    evento1?.ctwaClid === CLID,
    JSON.stringify(evento1?.ctwaClid)
  );
  ok(
    "y con custom_data.lead_stage (lo único reglable en Meta)",
    evento1?.customData?.lead_stage === "qualified",
    JSON.stringify(evento1?.customData)
  );

  // Dedup: sacarlo y volverlo a meter no re-reporta.
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaInicial.id }),
  });
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaCalificado.id }),
  });
  await sleep(800);
  const act2 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const califsDeEste = act2.filter(
    (e) => e.eventName === "QualifiedLead" && e.contactName === NOMBRE_AD
  );
  ok(
    "volver a calificar NO reporta dos veces",
    califsDeEste.length === 1,
    `${califsDeEste.length} filas`
  );

  /* ---------------- US5: la venta ---------------- */

  console.log("\n== 016: la venta (US5) ==");
  const venta = await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stageId: etapaGanada.id,
      amountCents: 45050,
      currency: "MXN",
    }),
  });
  ok("el trato se marca como ganado", venta.res.ok, `status=${venta.res.status}`);
  await sleep(800);

  const act3 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const compra = act3.find(
    (e) => e.eventName === "Purchase" && e.contactName === NOMBRE_AD
  );
  ok("se reportó la venta", compra?.status === "sent", JSON.stringify(compra));

  const capi2 = (await api("/api/dev/wa-mock/capi-events")).json?.capiEvents ?? [];
  const evento2 = capi2.find((e) => e.eventName === "Purchase");
  ok(
    "la venta viajó en UNIDADES de la moneda, no en centavos",
    evento2?.customData?.value === 450.5 &&
      evento2?.customData?.currency === "MXN",
    JSON.stringify(evento2?.customData)
  );

  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaCalificado.id }),
  });
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaGanada.id }),
  });
  await sleep(800);
  const act4 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const comprasDeEste = act4.filter(
    (e) => e.eventName === "Purchase" && e.contactName === NOMBRE_AD
  );
  ok(
    "re-ganar NO manda una segunda compra (a Meta no se le des-envía nada)",
    comprasDeEste.length === 1,
    `${comprasDeEste.length} filas`
  );

  /* ---------------- Los caminos infelices ---------------- */

  console.log("\n== 016: caminos infelices ==");

  // Un lead que no vino de un anuncio: se registra el motivo y nada falla.
  const NOMBRE_ORG = nom("Lead organico");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("3"),
      name: NOMBRE_ORG,
      text: "hola",
      waMessageId: `wamid.e2e.016.org.${SUF}`,
    }),
  });
  await sleep(1400);
  const board2 = (await api("/api/pipeline/board")).json;
  const leadOrg = board2.leads.find((l) => l.contact.name === NOMBRE_ORG);
  await api(`/api/pipeline/leads/${leadOrg.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaCalificado.id }),
  });
  await sleep(800);
  const act5 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const omitido = act5.find((e) => e.contactName === NOMBRE_ORG);
  ok(
    "un lead sin anuncio queda OMITIDO con el motivo escrito",
    omitido?.status === "skipped" && /ctwa_clid/.test(omitido?.error ?? ""),
    JSON.stringify(omitido)
  );

  // Meta rechazando: el 200 mentiroso (events_received: 0).
  const NOMBRE_FAIL = nom("Lead con Meta caido");
  await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e-fail",
      qualifiedStageId: etapaCalificado.id,
    }),
  });
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("4"),
      name: NOMBRE_FAIL,
      text: "vengo del anuncio",
      ctwaClid: `clid-fail-${SUF}`,
      waMessageId: `wamid.e2e.016.fail.${SUF}`,
    }),
  });
  await sleep(1400);
  const board3 = (await api("/api/pipeline/board")).json;
  const leadFail = board3.leads.find((l) => l.contact.name === NOMBRE_FAIL);
  const movFail = await api(`/api/pipeline/leads/${leadFail.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: etapaCalificado.id }),
  });
  ok(
    "con Meta rechazando, el lead SE MUEVE igual",
    movFail.res.ok,
    `status=${movFail.res.status}`
  );
  await sleep(800);
  const board4 = (await api("/api/pipeline/board")).json;
  const leadFail2 = board4.leads.find((l) => l.contact.name === NOMBRE_FAIL);
  ok(
    "y se queda en la etapa a la que lo movieron",
    leadFail2?.stageId === etapaCalificado.id,
    JSON.stringify(leadFail2?.stageId)
  );
  const act6 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const fallido = act6.find((e) => e.contactName === NOMBRE_FAIL);
  ok(
    "la fila queda FALLIDA con lo que dijo Meta (200 pero events_received=0)",
    fallido?.status === "failed" &&
      /events_received=0/.test(fallido?.error ?? ""),
    JSON.stringify(fallido)
  );

  // Desconectar: deja de reportarse, pero la bitácora de lo ya dicho se queda.
  const del = await api("/api/settings/capi", { method: "DELETE" });
  ok("se puede desconectar", del.res.ok);
  const trasBorrar = (await api("/api/settings/capi")).json;
  ok("tras desconectar, no hay configuración", trasBorrar?.capi === null);
  const act7 = (await api("/api/settings/capi/events")).json?.events ?? [];
  ok(
    "los eventos ya reportados NO se borran al desconectar",
    act7.length >= 3,
    `${act7.length} filas`
  );
}
