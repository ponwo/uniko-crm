/**
 * Self-test E2E de comportamiento — 031: las plantillas son de WhatsApp.
 * Guion tests/e2e/us-plantillas-por-canal.md.
 *
 * Conduce la Bandeja real en el navegador contra los mocks de WhatsApp y de
 * Zernio, con conversaciones cuya ventana de 24 h ya cerró: el entrante llega
 * con su hora de hace días, como lo haría una reentrega tardía.
 *
 * - WhatsApp sigue pidiendo plantilla: aviso + selector, sin caja de texto, y
 *   la plantilla sale.
 * - Instagram y Messenger enseñan la caja de siempre; la respuesta sale con
 *   la etiqueta de agente humano y aparece en el hilo.
 * - Una plantilla pedida fuera de WhatsApp se rechaza sin tocarlo, y
 *   «Escribir primero» ni se ofrece ni se acepta a esos contactos.
 * - Camino infeliz: pasados 7 días la plataforma rechaza; el compositor dice
 *   la causa en español, devuelve el texto al campo y la página sigue viva.
 *
 * Con Instagram y Messenger apagados (la instalación por defecto) afirma solo
 * lo que no debe cambiar: WhatsApp.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock y,
 *      para los otros canales, ZERNIO_BASE_URL → zernio-mock y CHANNELS
 *   2) node --env-file=.env scripts/e2e-plantillas-por-canal.mjs
 *
 * Sale con código 1 si algún check falla.
 */
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((s) => s.trim().toLowerCase());

const PN = "PN-031";
const WABA = "WABA-031";
const SECRET = "secreto-del-webhook-de-zernio";
const RUN = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;
const haceDias = (d) => new Date(Date.now() - d * DAY);

/** Los canales sin plantillas que esta instancia tiene encendidos. */
const CANALES = [
  {
    canal: "Instagram",
    channel: "instagram",
    ruta: "ig",
    platform: "instagram",
    account: "zernio-ig-account-001",
    settings: "/api/settings/instagram",
  },
  {
    canal: "Messenger",
    channel: "messenger",
    ruta: "messenger",
    platform: "facebook",
    account: "zernio-account-001",
    settings: "/api/settings/messenger",
  },
].filter((c) => CHANNELS.includes(c.channel));

const CAJA = "Escribe una respuesta…";
const AVISO_WA = "La ventana de 24 horas está cerrada.";
const PIE_AGENTE = "Fuera de la ventana de 24 h · sale como respuesta de agente humano";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!VERIFY_TOKEN) {
  console.error("Falta META_WEBHOOK_VERIFY_TOKEN en el entorno");
  process.exit(1);
}

mkdirSync(".tmp", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const req = ctx.request;
const page = await ctx.newPage();
const caja = page.getByPlaceholder(CAJA);

/** Llamada con la sesión del navegador (comparte cookies con la página). */
async function api(path, { method = "GET", data } = {}) {
  const res = await req.fetch(`${BASE}${path}`, {
    method,
    headers: { origin: BASE },
    ...(data !== undefined ? { data } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), ok: res.ok(), json };
}

/** Zernio entrega firmado por POST sin cookies; la ruta lleva el segmento secreto. */
function zernio(ruta, evt) {
  const body = JSON.stringify(evt);
  return fetch(`${BASE}/api/webhooks/${ruta}/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body,
  });
}

/** Un DM que llegó hace `dias` días a la cuenta del canal, por su hilo. */
function entrante(c, { hilo, remitente, nombre, texto, dias }) {
  return zernio(c.ruta, {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    event: "message.received",
    message: {
      id: `zmsg-${Math.random().toString(36).slice(2)}`,
      conversationId: hilo,
      direction: "incoming",
      text: texto,
      sentAt: haceDias(dias).toISOString(),
      sender: { id: remitente, name: nombre },
    },
    account: { id: c.account, accountId: c.account, platform: c.platform },
  });
}

/** La ingesta corre tras responder el webhook: se espera a que aparezca. */
async function waitForConversation(name, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const { json } = await api("/api/conversations");
    const found = (json?.conversations ?? []).find((c) => c.contact?.name === name);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

const zernioSent = async () =>
  (await (await fetch(`${BASE}/api/dev/zernio-mock/_sent`)).json()).sent ?? [];
const waOutbox = async () => (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];

/** Abre una conversación por enlace directo, como lo hace una notificación. */
async function abrir(conversationId, esperar) {
  await page.goto(`${BASE}/inbox?conversation=${conversationId}`, {
    waitUntil: "domcontentloaded",
  });
  await esperar.waitFor({ timeout: 20000 });
}

/** ¿La fila de este contacto en Contactos ofrece «Escribir primero»? */
async function ofreceEscribirPrimero(nombre) {
  const fila = page.locator("li").filter({ hasText: nombre });
  await fila.first().waitFor({ timeout: 20000 });
  return (await fila.getByRole("button", { name: "Escribir primero" }).count()) > 0;
}

async function setup() {
  console.log("== Setup: operador y WhatsApp con una plantilla aprobada ==");
  let r = await api("/api/auth/sign-up/email", {
    method: "POST",
    data: { email: "e2e@uniko.test", password: "password-e2e-123", name: "Operador E2E" },
  });
  if (!r.ok) {
    r = await api("/api/auth/sign-in/email", {
      method: "POST",
      data: { email: "e2e@uniko.test", password: "password-e2e-123" },
    });
  }
  ok("registro o login del propietario", r.ok, JSON.stringify(r.json));

  const wa = await api("/api/settings/whatsapp", {
    method: "PUT",
    data: { wabaId: WABA, phoneNumberId: PN, token: "tok-031" },
  });
  ok("WhatsApp conectado", wa.ok, JSON.stringify(wa.json));

  const nombre = `aviso_031_${RUN}`;
  const seed = await api("/api/dev/wa-mock/seed-templates", {
    method: "POST",
    data: {
      wabaId: WABA,
      templates: [
        { name: nombre, language: "es_MX", category: "UTILITY", status: "APPROVED", body: "Tu pedido va en camino, {{1}}." },
      ],
    },
  });
  const sync = await api("/api/templates/sync", { method: "POST" });
  const plantilla = ((await api("/api/templates")).json?.templates ?? []).find((t) => t.name === nombre);
  ok("plantilla aprobada importada de Meta", seed.ok && sync.ok && plantilla?.status === "approved", JSON.stringify(plantilla ?? sync.json));
  return plantilla;
}

/** FR-1606 — WhatsApp no cambia: con la ventana cerrada, solo plantilla. */
async function whatsapp(plantilla) {
  console.log("\n== WhatsApp con la ventana cerrada sigue pidiendo plantilla ==");
  const nombre = `WA vieja ${RUN}`;
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    data: {
      phoneNumberId: PN,
      from: `52155031${Math.floor(1000 + Math.random() * 8999)}`,
      name: nombre,
      text: "hola, ¿siguen abiertos?",
      waMessageId: `wamid.031.${RUN}`,
      timestamp: Math.floor(haceDias(2).getTime() / 1000),
    },
  });
  const conv = await waitForConversation(nombre);
  ok("la conversación aparece en la Bandeja", Boolean(conv));
  ok("ventana cerrada y plantilla obligatoria", conv?.windowOpen === false && conv?.templateRequired === true, JSON.stringify(conv && { w: conv.windowOpen, t: conv.templateRequired }));

  await abrir(conv.id, page.getByText(AVISO_WA));
  ok("aviso de ventana cerrada visible", await page.getByText(AVISO_WA).isVisible());
  ok("sin caja de texto libre", (await caja.count()) === 0);
  // El selector pide las plantillas aparte («Cargando plantillas…»): se espera.
  // Holgado a propósito: en `next dev` la primera petición compila la ruta, y
  // tras editar código eso ya tardó 5 s más la cola de otras rutas.
  const selector = await page
    .locator("#template-select")
    .waitFor({ timeout: 30000 })
    .then(() => true, () => false);
  ok("con el selector de plantillas aprobadas", selector);
  await page.screenshot({ path: ".tmp/e2e-031-whatsapp.png" });

  // Valor único por corrida: la vista previa de una conversación de la corrida
  // anterior también diría «Tu pedido va en camino, María.».
  const destinataria = `María ${RUN}`;
  await page.locator("#template-select").selectOption(plantilla.id);
  await page.locator("#template-variable-1").fill(destinataria);
  const antes = (await waOutbox()).length;
  await page.getByRole("button", { name: "Enviar plantilla" }).click();
  await page.getByText(`Tu pedido va en camino, ${destinataria}.`).first().waitFor({ timeout: 15000 });
  const outbox = await waOutbox();
  ok("la plantilla sale por WhatsApp y aparece en el hilo", outbox.length === antes + 1 && outbox.at(-1)?.type === "template", JSON.stringify(outbox.at(-1)?.body ?? null).slice(0, 200));

  const libre = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", data: { text: "texto libre" } });
  ok("el texto libre sigue en window_closed (409)", libre.status === 409 && libre.json?.error?.code === "window_closed", `${libre.status} ${JSON.stringify(libre.json)}`);
  return nombre;
}

/** FR-1602/1603/1604 — Un canal sin plantillas con la ventana cerrada. */
async function sinPlantillas(c, plantilla) {
  console.log(`\n== ${c.canal} con la ventana cerrada responde sin plantilla ==`);
  const nombre = `${c.canal} vieja ${RUN}`;
  const hilo = `zconv-031-${c.channel}-${RUN}`;
  const pregunta = `¿tienen la talla M? (${c.canal} ${RUN})`;
  const r = await entrante(c, { hilo, remitente: `${c.channel}-031-${RUN}`, nombre, texto: pregunta, dias: 2 });
  ok("Zernio entrega el entrante (200)", r.status === 200, String(r.status));
  const conv = await waitForConversation(nombre);
  ok("la conversación aparece en la Bandeja con su canal", conv?.channel === c.channel, conv?.channel);
  ok("ventana cerrada, pero SIN plantilla obligatoria", conv?.windowOpen === false && conv?.templateRequired === false, JSON.stringify(conv && { w: conv.windowOpen, t: conv.templateRequired }));

  await abrir(conv.id, caja);
  ok("la caja de texto está ahí", await caja.isVisible());
  ok("sin el aviso de plantilla", (await page.getByText(AVISO_WA).count()) === 0);
  ok("sin selector de plantillas", (await page.locator("#template-select").count()) === 0);
  const pie = page.getByText(PIE_AGENTE);
  ok("el pie dice que sale como agente humano", await pie.isVisible());
  ok("y el porqué (7 días) al pasar el cursor", /7 días/.test((await pie.getAttribute("title")) ?? ""));

  const texto = `Sí, aquí seguimos (${c.canal} ${RUN})`;
  await caja.fill(texto);
  await caja.press("Enter");
  await page.getByText(texto).first().waitFor({ timeout: 15000 });
  // La burbuja «enviando» sale antes que la respuesta del servidor: lo que
  // cuenta es que el envío llegue a Zernio.
  let enviado = null;
  for (let i = 0; i < 40 && !enviado; i++) {
    enviado = (await zernioSent()).find((m) => m.message === texto) ?? null;
    if (!enviado) await sleep(250);
  }
  await sleep(500);
  ok("salió por Zernio a su hilo", enviado?.conversationId === hilo, JSON.stringify(enviado));
  ok("con la etiqueta de agente humano", enviado?.messagingType === "MESSAGE_TAG" && enviado?.messageTag === "HUMAN_AGENT", JSON.stringify(enviado));
  const msgs = (await api(`/api/conversations/${conv.id}/messages`)).json?.messages ?? [];
  const out = msgs.find((m) => m.direction === "out" && m.text === texto);
  ok("queda en el hilo como enviado", out?.status === "sent", JSON.stringify(out ?? null));
  ok("sin error bajo la caja", (await page.locator("p.text-destructive").count()) === 0);
  await page.screenshot({ path: `.tmp/e2e-031-${c.channel}.png` });

  console.log(`\n== ${c.canal}: una plantilla no se manda, y no se escribe primero ==`);
  const antes = (await waOutbox()).length;
  const tpl = await api(`/api/conversations/${conv.id}/messages/template`, {
    method: "POST",
    data: { templateId: plantilla.id, variables: ["Ana"] },
  });
  ok("plantilla a la conversación → 409 channel_without_templates", tpl.status === 409 && tpl.json?.error?.code === "channel_without_templates", `${tpl.status} ${JSON.stringify(tpl.json)}`);
  ok("diciendo que se responde con texto", /plantillas son de WhatsApp/.test(tpl.json?.error?.message ?? ""), tpl.json?.error?.message);
  const start = await api(`/api/contacts/${conv.contact.id}/start-conversation`, {
    method: "POST",
    data: { templateId: plantilla.id, variables: ["Ana"] },
  });
  ok("«Escribir primero» a este contacto → 409 channel_without_templates", start.status === 409 && start.json?.error?.code === "channel_without_templates", `${start.status} ${JSON.stringify(start.json)}`);
  const delContacto = ((await api("/api/conversations")).json?.conversations ?? []).filter((x) => x.contact.id === conv.contact.id);
  ok("y no le abrió otra conversación", delContacto.length === 1 && delContacto[0].channel === conv.channel, JSON.stringify(delContacto.map((x) => x.channel)));
  ok("el outbox de WhatsApp no se movió", (await waOutbox()).length === antes);
  return { nombre, conv, pregunta };
}

/** FR-1605 — Pasados 7 días la plataforma rechaza: se explica y nada se pierde. */
async function caminoInfeliz(c) {
  console.log(`\n== Camino infeliz (${c.canal}): más de 7 días, la plataforma rechaza ==`);
  const nombre = `${c.canal} vencida ${RUN}`;
  await entrante(c, { hilo: `zconv-vencida-${RUN}`, remitente: `${c.channel}-031v-${RUN}`, nombre, texto: "hola", dias: 9 });
  const conv = await waitForConversation(nombre);
  ok("la conversación de hace 9 días aparece", Boolean(conv));

  await abrir(conv.id, caja);
  const tarde = `Perdón la demora (${RUN})`;
  const antes = (await zernioSent()).length;
  await caja.fill(tarde);
  await caja.press("Enter");
  const error = page.getByText(/ya no acepta respuestas/);
  await error.waitFor({ timeout: 15000 });
  const textoError = await error.first().innerText();
  ok("el compositor dice la causa en español (más de 7 días)", /más de 7 días/.test(textoError), textoError);
  ok("y conserva el texto de la plataforma para diagnosticar", /outside of allowed window/.test(textoError), textoError);
  ok("el texto vuelve al campo: nada se pierde", (await caja.inputValue()) === tarde, await caja.inputValue());
  ok("nada salió por Zernio", (await zernioSent()).length === antes);
  await sleep(1000);
  const msgs = (await api(`/api/conversations/${conv.id}/messages`)).json?.messages ?? [];
  ok("y no quedó una burbuja fantasma en el hilo", !msgs.some((m) => m.direction === "out"), JSON.stringify(msgs.map((m) => [m.direction, m.status])));
  await page.screenshot({ path: ".tmp/e2e-031-vencida.png" });
  await caja.fill("la página sigue viva");
  ok("la página sigue viva (se puede seguir escribiendo)", (await caja.inputValue()) === "la página sigue viva");
}

try {
  const plantilla = await setup();
  const nombreWa = await whatsapp(plantilla);

  if (CANALES.length === 0) {
    console.log("\n  (Instagram y Messenger apagados en esta instancia: solo se afirma que WhatsApp no cambió)");
  } else {
    await fetch(`${BASE}/api/dev/zernio-mock/_reset`, { method: "POST" });
    for (const c of CANALES) {
      const con = await api(c.settings, {
        method: "PUT",
        data: { source: "zernio", accountRef: c.account, token: "sk_test-ok", webhookSecret: SECRET },
      });
      ok(`${c.canal} conectado por Zernio`, con.ok, JSON.stringify(con.json));
    }
  }

  const otros = [];
  for (const c of CANALES) otros.push({ c, ...(await sinPlantillas(c, plantilla)) });
  if (CANALES[0]) await caminoInfeliz(CANALES[0]);

  console.log("\n== Contactos: «Escribir primero» solo en WhatsApp ==");
  await page.goto(`${BASE}/contacts`, { waitUntil: "domcontentloaded" });
  ok("al contacto de WhatsApp se le ofrece", await ofreceEscribirPrimero(nombreWa));
  for (const { c, nombre } of otros) {
    ok(`al de ${c.canal} no`, !(await ofreceEscribirPrimero(nombre)));
  }

  if (otros[0]) {
    console.log("\n== Teléfono (375 px): el pie cabe sin scroll horizontal ==");
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir(otros[0].conv.id, caja);
    await page.getByText(otros[0].pregunta).first().waitFor({ timeout: 15000 });
    ok("la caja y el pie se ven en el teléfono", (await caja.isVisible()) && (await page.getByText(PIE_AGENTE).isVisible()));
    ok("sin scroll horizontal", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: ".tmp/e2e-031-movil.png" });
  }
} catch (err) {
  failures++;
  console.error("ERROR FATAL:", err);
} finally {
  await browser.close();
}

console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures ? 1 : 0);
