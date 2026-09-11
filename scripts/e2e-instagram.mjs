/**
 * Self-test E2E de comportamiento — 014: canal de Instagram por Zernio.
 *
 * Conduce la app real en localhost con los mocks: conecta el perfil por la
 * pantalla nueva (Configuración → Instagram) y su API, mete DMs por el webhook
 * como los entrega Zernio —con la forma actual de su doc, `account.accountId`—
 * y responde desde la bandeja, comprobando cada paso por las superficies que
 * usa el operador. Con el canal apagado afirma lo contrario: que no existe.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, ZERNIO_BASE_URL → zernio-mock,
 *      CHANNELS con instagram (y messenger, para el reparto cruzado) y BD migrada
 *   2) node --env-file=.env scripts/e2e-instagram.mjs
 *
 * Sale con código 1 si algún check falla.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const CHANNELS = (process.env.CHANNELS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase());
const IG_ON = CHANNELS.includes("instagram");
const FB_ON = CHANNELS.includes("messenger");

const ACCOUNT = "zernio-ig-account-001";
const FB_ACCOUNT = "zernio-account-001";
const SECRET = "secreto-del-webhook-de-zernio";
const RUN = Date.now().toString(36);
const IGSID = `igsid-${RUN}`;
/** Marca de esta corrida: el arnés se puede repetir sobre la misma base. */
const MARCA = `#${RUN}`;
const NOMBRE = `Ana Pérez ${MARCA}`;

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
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
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

/** Zernio entrega por POST sin cookies; la ruta lleva el segmento secreto. */
async function webhook(payload, { token = VERIFY_TOKEN, signature, route = "ig" } = {}) {
  const body = JSON.stringify(payload);
  return fetch(`${BASE}/api/webhooks/${route}/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-zernio-signature": signature } : {}),
    },
    body,
  });
}

const sign = (payload, secret = SECRET) =>
  createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");

/** Un evento con la forma ACTUAL de la doc: `accountId` canónico, `id` heredado. */
function zernioEvent(over = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    event: "message.received",
    message: {
      id: `zmsg-${Math.random().toString(36).slice(2)}`,
      conversationId: "zconv-ig-001",
      direction: "incoming",
      text: "Hola desde Instagram",
      sentAt: new Date().toISOString(),
      sender: { id: IGSID, name: NOMBRE, username: "ana_perez" },
      ...(over.message ?? {}),
    },
    account: {
      id: ACCOUNT,
      accountId: ACCOUNT,
      platform: "instagram",
      username: "negocio_demo",
      ...(over.account ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(over).filter(([k]) => !["message", "account"].includes(k))
    ),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** La ingesta corre tras responder el webhook: se espera a que aparezca. */
async function waitForConversation(pred, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const { json } = await api("/api/conversations");
    const found = (json?.conversations ?? []).find(pred);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

async function main() {
  if (!VERIFY_TOKEN) {
    console.error("Falta META_WEBHOOK_VERIFY_TOKEN en el entorno");
    process.exit(1);
  }

  console.log("== Setup: registro/login del propietario ==");
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
  ok("registro o login del propietario", su.res.ok);

  // ------------------------------------------------------------------
  if (!IG_ON) {
    console.log("\n== 014: el canal APAGADO no existe (ADR-001) ==");
    const get = await api("/api/settings/instagram");
    ok("GET /api/settings/instagram → 404", get.res.status === 404, String(get.res.status));
    const put = await api("/api/settings/instagram", {
      method: "PUT",
      body: JSON.stringify({ source: "zernio", accountRef: ACCOUNT, token: "sk_test-ok" }),
    });
    ok("PUT /api/settings/instagram → 404", put.res.status === 404, String(put.res.status));
    const page = await fetch(`${BASE}/settings/instagram`, { headers: { cookie } });
    ok("la pantalla /settings/instagram no existe", page.status === 404, String(page.status));
    const settings = await fetch(`${BASE}/settings/whatsapp`, { headers: { cookie } }).then((r) => r.text());
    ok("la pestaña Instagram no aparece en Configuración", !settings.includes('href="/settings/instagram"'));
    const evt = zernioEvent();
    const wh = await webhook(evt, { signature: sign(evt) });
    ok("el webhook de Instagram → 404", wh.status === 404, String(wh.status));
    const info = await api("/api/settings/webhook");
    ok("la URL de callback de Instagram va en null", info.json?.instagramUrl === null);
    const ca = await api("/api/settings/instagram/comment-automation");
    ok("GET /api/settings/instagram/comment-automation → 404", ca.res.status === 404, String(ca.res.status));
    console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
    process.exit(failures ? 1 : 0);
  }

  // ------------------------------------------------------------------
  console.log("\n== La pantalla existe y enseña la URL de callback ==");
  const page = await fetch(`${BASE}/settings/instagram`, { headers: { cookie } });
  ok("GET /settings/instagram → 200", page.status === 200, String(page.status));
  const settings = await fetch(`${BASE}/settings/whatsapp`, { headers: { cookie } }).then((r) => r.text());
  ok("la pestaña Instagram aparece en Configuración", settings.includes('href="/settings/instagram"'));
  const info = await api("/api/settings/webhook");
  ok(
    "la URL de callback de Instagram lleva el segmento secreto",
    typeof info.json?.instagramUrl === "string" && info.json.instagramUrl.endsWith(`/api/webhooks/ig/${VERIFY_TOKEN}`),
    JSON.stringify(info.json?.instagramUrl)
  );

  console.log("\n== Webhook: capas de seguridad ==");
  const wrong = await webhook(zernioEvent(), { token: "token-equivocado" });
  ok("segmento secreto equivocado → 404 sin efectos", wrong.status === 404, String(wrong.status));

  await fetch(`${BASE}/api/dev/zernio-mock/_reset`, { method: "POST" });
  const zstate = async () => fetch(`${BASE}/api/dev/zernio-mock/_state`).then((r) => r.json());

  console.log("\n== 025: Uniko registra su webhook en Zernio al guardar ==");
  // Sin secreto escrito: en base fresca Uniko genera uno; en una re-corrida
  // hereda el que ya guardó la corrida anterior (FR-1002). Ambas son la regla.
  const antes = await api("/api/settings/instagram");
  const fresca = !antes.json?.connection;
  console.log(`  (${fresca ? "base fresca: debe generar secreto" : "re-corrida: debe heredar el secreto ya guardado"})`);
  const primera = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: ACCOUNT, token: "sk_test-ok" }),
  });
  ok("PUT sin secreto → 200 con webhook registrado", primera.res.ok && primera.json?.webhook?.registered === true, JSON.stringify(primera.json));
  ok("…creado (el mock estaba vacío)", primera.json?.webhook?.action === "created", JSON.stringify(primera.json?.webhook));
  ok(fresca ? "…con secreto generado por Uniko" : "…con el secreto heredado de la corrida anterior (no genera otro)", primera.json?.webhook?.generatedSecret === fresca, JSON.stringify(primera.json?.webhook));
  let zs = await zstate();
  const hook0 = zs.webhooks?.[0];
  ok("Zernio tiene UN webhook apuntando a la URL de callback de esta instancia", zs.webhooks?.length === 1 && hook0?.url?.endsWith(`/api/webhooks/ig/${VERIFY_TOKEN}`), JSON.stringify(zs.webhooks));
  ok("…con el evento message.received, activo y el secreto que Uniko guardó", hook0?.events?.includes("message.received") && hook0?.isActive === true && (fresca ? /^[0-9a-f]{48}$/.test(hook0?.secret ?? "") : hook0?.secret === SECRET), JSON.stringify(hook0));
  const generado = hook0?.secret;
  const estado0 = await api("/api/settings/instagram");
  ok("GET del canal dice que el webhook está registrado en Zernio", estado0.json?.zernioWebhook?.status === "registered", JSON.stringify(estado0.json?.zernioWebhook));
  // El secreto generado es el que Uniko guardó: una entrega firmada con él pasa.
  const evtGen = zernioEvent({ message: { id: `zmsg-gen-${RUN}`, text: "firmado con el secreto generado", sender: { id: `igsid-gen-${RUN}`, name: `Gen ${MARCA}` } } });
  const rGen = await webhook(evtGen, { signature: sign(evtGen, generado) });
  ok("una entrega firmada con el secreto generado → 200", rGen.status === 200, String(rGen.status));
  const rGenMal = await webhook(evtGen, { signature: sign(evtGen, "otro") });
  ok("…y con otro secreto → 401 (Uniko sí lo guardó)", rGenMal.status === 401, String(rGenMal.status));

  console.log("\n== Conexión por Zernio (validada contra su API) ==");
  const badZ = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: ACCOUNT, token: "sk_test-invalid" }),
  });
  ok("una API key que Zernio rechaza NO se guarda → 422", badZ.res.status === 422, String(badZ.res.status));

  const noAccount = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", token: "sk_test-ok" }),
  });
  ok("sin accountId no se puede enrutar → 422", noAccount.res.status === 422, String(noAccount.res.status));

  // Las tres causas con nombre: la primera fue la que se llevó la conexión
  // real de LanCo (llave válida, plan sin Inbox) y se reportaba como "llave
  // inválida".
  const sinInbox = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: ACCOUNT, token: "sk_test-sin-inbox" }),
  });
  ok(
    "llave válida sin el Inbox contratado → 422 inbox_required, con mensaje que lo dice",
    sinInbox.res.status === 422 && sinInbox.json?.error?.code === "inbox_required" && /Inbox/.test(sinInbox.json?.error?.message ?? ""),
    JSON.stringify(sinInbox.json)
  );
  const otraPlat = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: FB_ACCOUNT, token: "sk_test-ok" }),
  });
  ok(
    "el accountId de la cuenta de Facebook en la pantalla de Instagram → 422 platform_mismatch",
    otraPlat.res.status === 422 && otraPlat.json?.error?.code === "platform_mismatch",
    JSON.stringify(otraPlat.json)
  );
  const noExiste = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: "zernio-no-existe", token: "sk_test-ok" }),
  });
  ok(
    "un accountId que no es de esa llave → 422 account_not_found",
    noExiste.res.status === 422 && noExiste.json?.error?.code === "account_not_found",
    JSON.stringify(noExiste.json)
  );

  const noIg = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({ source: "meta", token: "IGAA-x" }),
  });
  ok("en modo Meta sin IG_ID → 422", noIg.res.status === 422, String(noIg.res.status));

  // Lo que pide la pantalla en modo Zernio: accountId + API key + secreto.
  // Sin IG_ID, porque Zernio no lo expone.
  const connZ = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({
      source: "zernio",
      igUserId: null,
      accountRef: ACCOUNT,
      token: "sk_test-ok",
      webhookSecret: SECRET,
    }),
  });
  ok("PUT con API key válida y sin IG_ID → 200", connZ.res.ok, JSON.stringify(connZ.json));
  ok("el nombre de la cuenta sale de /accounts de Zernio", connZ.json?.username === "negocio_demo", JSON.stringify(connZ.json));
  ok(fresca ? "guardar con secreto explícito ACTUALIZA el webhook (no crea otro)" : "guardar con el mismo secreto deja el webhook como está (no crea otro)", connZ.json?.webhook?.action === (fresca ? "updated" : "unchanged") && connZ.json?.webhook?.generatedSecret === false, JSON.stringify(connZ.json?.webhook));
  zs = await zstate();
  ok("Zernio sigue con un solo webhook, ahora con el secreto escrito", zs.webhooks?.length === 1 && zs.webhooks?.[0]?.secret === SECRET, JSON.stringify(zs.webhooks));
  const stateZ = await api("/api/settings/instagram");
  ok(
    "la conexión queda en modo zernio con su cuenta",
    stateZ.json?.connection?.source === "zernio" && stateZ.json?.connection?.accountRef === ACCOUNT,
    JSON.stringify(stateZ.json?.connection)
  );
  ok(
    "el token solo enseña su cola",
    stateZ.json?.connection?.tokenLast4 === "t-ok" && !JSON.stringify(stateZ.json).includes("sk_test-ok"),
    JSON.stringify(stateZ.json?.connection)
  );

  console.log("\n== Firma del webhook de Zernio ==");
  const evtFirma = zernioEvent();
  const sinFirma = await webhook(evtFirma);
  ok("sin firma con secreto configurado → 401", sinFirma.status === 401, String(sinFirma.status));
  const malFirmada = await webhook(evtFirma, { signature: "deadbeef" });
  ok("firma inválida → 401", malFirmada.status === 401, String(malFirmada.status));

  console.log("\n== Entrante por Zernio (forma actual: accountId canónico) ==");
  const evt = zernioEvent();
  const okFirma = await webhook(evt, { signature: sign(evt) });
  ok("firma válida → 200", okFirma.status === 200, String(okFirma.status));
  const conv = await waitForConversation((c) => c.contact?.name === NOMBRE);
  ok("la conversación aparece en la bandeja", Boolean(conv));
  ok("con canal instagram", conv?.channel === "instagram", conv?.channel);
  ok("el contacto no tiene teléfono", conv?.contact?.phone == null);
  ok("la ventana de 24 h abre con el entrante", conv?.windowOpen === true);

  console.log("\n== Zernio: formato anterior (solo `id`), duplicados y ruido ==");
  const viejo = zernioEvent({
    account: { id: ACCOUNT, accountId: undefined },
    message: { id: `zmsg-viejo-${RUN}`, text: `segundo mensaje ${MARCA}` },
  });
  delete viejo.account.accountId;
  const okViejo = await webhook(viejo, { signature: sign(viejo) });
  ok("un evento con solo `account.id` sigue enrutando → 200", okViejo.status === 200, String(okViejo.status));
  const dup = { ...evt };
  await webhook(dup, { signature: sign(dup) });
  const salida = zernioEvent({ message: { id: "zmsg-out", direction: "outgoing", text: "respuesta mía" } });
  await webhook(salida, { signature: sign(salida) });
  await sleep(1500);
  const msgs = await api(`/api/conversations/${conv?.id}/messages`);
  const inMsgs = (msgs.json?.messages ?? []).filter((m) => m.direction === "in");
  ok("el mensaje con el formato anterior entró", inMsgs.some((m) => m.text === `segundo mensaje ${MARCA}`));
  ok("el evento repetido NO duplica el mensaje", inMsgs.length === 2, `in=${inMsgs.length}`);
  ok(
    "un `outgoing` de la bandeja de Zernio no se ingiere como entrante",
    !inMsgs.some((m) => m.text === "respuesta mía")
  );

  console.log("\n== Un solo webhook para todas las plataformas ==");
  const fbPorIg = zernioEvent({
    account: { id: FB_ACCOUNT, accountId: FB_ACCOUNT, platform: "facebook" },
    message: { id: `zmsg-fb-${RUN}`, conversationId: "zconv-fb-001", text: `de facebook por la URL de ig ${MARCA}`, sender: { id: `psid-${RUN}`, name: `Pepe FB ${MARCA}` } },
  });
  let fbSecret = null;
  if (FB_ON) {
    console.log("  (025: Messenger se conecta por API sin secreto: debe heredar el de Instagram)");
    const connFb = await api("/api/settings/messenger", {
      method: "PUT",
      body: JSON.stringify({ source: "zernio", accountRef: FB_ACCOUNT, token: "sk_test-ok" }),
    });
    ok("Messenger por Zernio sin secreto → 200, webhook ya servía (unchanged) y sin generar otro secreto", connFb.res.ok && connFb.json?.webhook?.registered === true && connFb.json?.webhook?.action === "unchanged" && connFb.json?.webhook?.generatedSecret === false, JSON.stringify(connFb.json?.webhook));
    zs = await zstate();
    ok("sigue habiendo UN webhook en Zernio para los dos canales", zs.webhooks?.length === 1, JSON.stringify(zs.webhooks?.map((h) => h.url)));
    const fbEvt = zernioEvent({ account: { id: FB_ACCOUNT, accountId: FB_ACCOUNT, platform: "facebook" }, message: { id: `zmsg-fbsec-${RUN}`, conversationId: "zconv-fb-sec", text: "firma compartida", sender: { id: `psid-sec-${RUN}`, name: `Sec ${MARCA}` } } });
    const rFbSec = await webhook(fbEvt, { signature: sign(fbEvt, SECRET), route: "messenger" });
    const rFbNo = await webhook(fbEvt, { route: "messenger" });
    ok("Messenger verifica con el MISMO secreto que Instagram (firmado → 200, sin firma → 401)", rFbSec.status === 200 && rFbNo.status === 401, `${rFbSec.status}/${rFbNo.status}`);
    fbSecret = SECRET;
  }
  const rFb = await webhook(fbPorIg, { signature: sign(fbPorIg, fbSecret ?? SECRET) });
  ok("un evento de Facebook por la URL de Instagram → 200 (no se descarta en silencio)", rFb.status === 200, String(rFb.status));
  if (FB_ON) {
    const convFb = await waitForConversation((c) => c.contact?.name === `Pepe FB ${MARCA}`, 12);
    ok(
      "…y aterriza en la bandeja como Messenger",
      convFb?.channel === "messenger",
      convFb ? convFb.channel : "no apareció (¿Messenger conectado por Zernio en esta base?)"
    );
  } else {
    const todas = await api("/api/conversations");
    ok(
      "…y sin Messenger encendido no entra como Instagram",
      !(todas.json?.conversations ?? []).some((c) => c.contact?.name === `Pepe FB ${MARCA}`)
    );
  }

  console.log("\n== 025: comentario → DM desde la pantalla ==");
  const ca0 = await api("/api/settings/instagram/comment-automation");
  ok("GET → disponible (Zernio) y sin automatización aún", ca0.json?.available === true && ca0.json?.automation === null, JSON.stringify(ca0.json));
  const caBad = await api("/api/settings/instagram/comment-automation", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, keywords: ["info"], dmMessage: "" }),
  });
  ok("sin texto de DM → 422", caBad.res.status === 422, String(caBad.res.status));
  const ca1 = await api("/api/settings/instagram/comment-automation", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, keywords: ["Info", "precio", "info", "más información"], dmMessage: "¡Hola! Vi tu comentario 👋", commentReply: "¡Te escribimos por DM! 📩" }),
  });
  ok("PUT encendida → 200", ca1.res.ok && ca1.json?.automation?.enabled === true, JSON.stringify(ca1.json));
  zs = await zstate();
  const auto = zs.automations?.find((a) => a.accountId === ACCOUNT);
  ok("Zernio tiene UNA automatización para la cuenta de Instagram, creada por Uniko", zs.automations?.length === 1 && auto?.name?.startsWith("Uniko") && auto?.platform === "instagram", JSON.stringify(zs.automations));
  ok("…modo palabra con tolerancia, keywords en minúscula y sin repetidas, con acento intacto", auto?.matchMode === "word" && auto?.typoTolerance === true && JSON.stringify(auto?.keywords) === JSON.stringify(["info", "precio", "más información"]), JSON.stringify(auto?.keywords));
  ok("…con el DM y la respuesta pública (emojis intactos)", auto?.dmMessage === "¡Hola! Vi tu comentario 👋" && auto?.commentReply === "¡Te escribimos por DM! 📩", JSON.stringify([auto?.dmMessage, auto?.commentReply]));
  const ca2 = await api("/api/settings/instagram/comment-automation");
  ok("GET la lee de Zernio con sus estadísticas", ca2.json?.automation?.enabled === true && ca2.json?.automation?.keywords?.length === 3 && ca2.json?.automation?.stats !== undefined, JSON.stringify(ca2.json));
  const ca3 = await api("/api/settings/instagram/comment-automation", {
    method: "PUT",
    body: JSON.stringify({ enabled: false, keywords: ["info"], dmMessage: "Texto nuevo", commentReply: null }),
  });
  zs = await zstate();
  ok("apagar = isActive false y cambios aplicados, SIN borrar ni duplicar", ca3.res.ok && zs.automations?.length === 1 && zs.automations?.[0]?.isActive === false && zs.automations?.[0]?.dmMessage === "Texto nuevo" && zs.automations?.[0]?.commentReply === "", JSON.stringify(zs.automations));
  const ca4 = await api("/api/settings/instagram/comment-automation", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, keywords: ["info"], dmMessage: "Texto nuevo" }),
  });
  zs = await zstate();
  ok("encender de nuevo reutiliza la misma (sigue siendo una)", ca4.res.ok && zs.automations?.length === 1 && zs.automations?.[0]?.isActive === true, JSON.stringify(zs.automations?.length));
  if (FB_ON) {
    const caFb = await api("/api/settings/messenger/comment-automation", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, keywords: ["info"], dmMessage: "Hola desde la página" }),
    });
    zs = await zstate();
    ok("Messenger crea la SUYA, aparte (dos en total, una por cuenta)", caFb.res.ok && zs.automations?.length === 2 && zs.automations?.some((a) => a.accountId === FB_ACCOUNT && a.platform === "facebook"), JSON.stringify(zs.automations?.map((a) => [a.accountId, a.platform])));
  }

  console.log("\n== Salida por Zernio ==");
  const reply = await api(`/api/conversations/${conv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: `Claro, te mando el catálogo ${MARCA}` }),
  });
  ok("POST /messages → 200/201", reply.res.ok, JSON.stringify(reply.json));
  const sentZ = await fetch(`${BASE}/api/dev/zernio-mock/_sent`).then((r) => r.json());
  const last = (sentZ.sent ?? [])[sentZ.sent.length - 1];
  ok("salió por la API de Zernio", Boolean(last), JSON.stringify(sentZ).slice(0, 200));
  ok(
    "a la conversación del evento (el conversationId opaco), con su accountId",
    last?.conversationId === "zconv-ig-001" && last?.accountId === ACCOUNT,
    JSON.stringify(last)
  );
  ok("con el texto que escribió el operador", last?.message === `Claro, te mando el catálogo ${MARCA}`);
  ok("con Idempotency-Key (un reintento no manda dos veces)", typeof last?.idempotencyKey === "string" && last.idempotencyKey.length > 0);
  ok("dentro de la ventana NO va etiquetado como agente humano", !last?.messageTag, JSON.stringify(last?.messageTag));
  const msgs2 = await api(`/api/conversations/${conv?.id}/messages`);
  const out = (msgs2.json?.messages ?? []).find((m) => m.direction === "out");
  ok("el saliente queda como 'sent'", out?.status === "sent", out?.status);

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
