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
  // El secreto es el de la cuenta de Messenger: si ese canal no está
  // conectado por Zernio en esta base, no hay secreto y la firma no se exige.
  const fbSecret = FB_ON ? await messengerSecretOrNull() : null;
  const rFb = await webhook(fbPorIg, { signature: sign(fbPorIg, fbSecret ?? SECRET) });
  ok("un evento de Facebook por la URL de Instagram → 200 (no se descarta en silencio)", rFb.status === 200, String(rFb.status));
  if (FB_ON && fbSecret !== undefined) {
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

/**
 * El secreto de Messenger no se puede leer por la API (nunca sale), así que
 * el reparto cruzado solo se puede firmar si ESTE arnés conoce el que se
 * guardó. Convención compartida con e2e-messenger.mjs: el mismo SECRET.
 * Devuelve undefined si Messenger no está conectado por Zernio en esta base.
 */
async function messengerSecretOrNull() {
  const { res, json } = await api("/api/settings/messenger");
  if (!res.ok || json?.connection?.source !== "zernio") return undefined;
  return SECRET;
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
