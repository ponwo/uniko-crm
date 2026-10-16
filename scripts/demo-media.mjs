/**
 * Capturas y videos DEMOSTRATIVOS de Uniko (docs/demo/).
 *
 * Corre contra una app LOCAL con los mocks encendidos y una base DESECHABLE
 * (nunca uniko_dev ni una instancia real), con el LLM de demostración
 * (scripts/demo-llm.mjs) delante del ai-mock para que el agente conteste con
 * frases creíbles. Receta completa en docs/demo/README.md.
 *
 *   node scripts/demo-media.mjs shots          # capturas (PNG)
 *   node scripts/demo-media.mjs 01 02 03       # escenas de video (webm)
 *   node scripts/demo-media.mjs all            # todo, en orden
 *
 * Las escenas MUTAN la base (cliente nuevo, etapas, KB, marca): para repetirlas
 * hay que partir de una base recién sembrada. Las capturas van primero porque
 * muestran la demo limpia.
 *
 * Los videos no llevan voz: cada paso lleva un subtítulo dibujado en la página
 * y un cursor visible, que Playwright no graba por sí solo.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3100";
// Los medios se publican en la página de LanCo y NO viven en este repo: la
// salida es obligatoria y tiene que quedar fuera de él.
if (!process.env.DEMO_OUT) {
  console.error('Falta DEMO_OUT: la carpeta (fuera del repo) donde guardar capturas y videos.');
  process.exit(1);
}
const OUT = path.resolve(process.env.DEMO_OUT);
if (!path.relative(process.cwd(), OUT).startsWith("..") && !path.isAbsolute(path.relative(process.cwd(), OUT))) {
  console.error(`DEMO_OUT (${OUT}) está dentro del repo: los medios no se versionan aquí.`);
  process.exit(1);
}
const SHOTS = path.join(OUT, "capturas");
const VIDEOS = path.join(OUT, "videos");
const TMP = path.join(os.tmpdir(), "uniko-demo-video");
const STATE = path.join(os.tmpdir(), "uniko-demo-state.json");
const VIEWPORT = { width: 1440, height: 900 };
const EMAIL = "demo@uniko.test";
const PASSWORD = "demo-uniko-123";
const PN = "pn-demo-001";
const IG_ACCOUNT = "zernio-ig-account-001";
const FB_ACCOUNT = "zernio-account-001";
const ZERNIO_SECRET = "secreto-demo-zernio";
/** Origen del proxy de Meta (scripts/demo-meta.mjs): de ahí sale el creativo del anuncio. */
const META_ORIGIN = process.env.DEMO_META_ORIGIN ?? "http://localhost:3103";

/** Lee una variable del entorno o, si no está, del .env local. */
function envVar(k) {
  if (process.env[k]) return process.env[k];
  try {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(k + "="));
    return line?.slice(k.length + 1).trim();
  } catch {
    return undefined;
  }
}
const VERIFY_TOKEN = envVar("META_WEBHOOK_VERIFY_TOKEN");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cursor y subtítulos, dibujados en la página ────────────────────────────
const OVERLAY = () => {
  const install = () => {
    if (document.getElementById("__demo_cur")) return;
    const st = document.createElement("style");
    st.textContent = `
      nextjs-portal{display:none!important}
      #__demo_cur{position:fixed;z-index:2147483647;left:0;top:0;width:26px;height:26px;pointer-events:none;
        transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      #__demo_rip{position:fixed;z-index:2147483646;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
        border:3px solid #0d5bff;pointer-events:none;opacity:0}
      #__demo_rip.go{animation:__rip .55s ease-out}
      @keyframes __rip{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(3.2)}}
      #__demo_cap{position:fixed;z-index:2147483647;left:50%;bottom:34px;transform:translateX(-50%);
        max-width:min(1100px,86vw);padding:14px 26px;border-radius:14px;background:rgba(10,18,40,.9);
        color:#fff;font:600 22px/1.35 Archivo,system-ui,sans-serif;text-align:center;letter-spacing:.1px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none;opacity:0;transition:opacity .35s}
      #__demo_cap.on{opacity:1}`;
    document.head.appendChild(st);
    const cur = document.createElement("div");
    cur.id = "__demo_cur";
    cur.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9-6.5 1.6L9 19z" fill="#fff" stroke="#0a1228" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const rip = document.createElement("div");
    rip.id = "__demo_rip";
    const cap = document.createElement("div");
    cap.id = "__demo_cap";
    document.body.append(cur, rip, cap);
    addEventListener(
      "mousemove",
      (e) => {
        cur.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`;
      },
      true
    );
    addEventListener(
      "mousedown",
      (e) => {
        rip.style.left = e.clientX + "px";
        rip.style.top = e.clientY + "px";
        rip.classList.remove("go");
        void rip.offsetWidth;
        rip.classList.add("go");
      },
      true
    );
    window.__cap = (t) => {
      if (!t) return cap.classList.remove("on");
      cap.textContent = t;
      cap.classList.add("on");
    };
  };
  if (document.body) install();
  else addEventListener("DOMContentLoaded", install);
};

// ── Sesión ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: "es-MX" });
  const call = (p, init = {}) =>
    ctx.request.fetch(`${BASE}${p}`, {
      ...init,
      headers: { origin: BASE, ...(init.headers ?? {}) },
    });
  let s = await call("/api/auth/sign-up/email", {
    method: "POST",
    data: { email: EMAIL, password: PASSWORD, name: "Kevin" },
  });
  if (!s.ok()) {
    s = await call("/api/auth/sign-in/email", {
      method: "POST",
      data: { email: EMAIL, password: PASSWORD },
    });
  }
  if (!s.ok()) throw new Error(`No se pudo entrar: ${s.status()} ${await s.text()}`);
  await call("/api/dev/seed-demo", { method: "POST" }); // 409 si ya hay datos
  await call("/api/settings/whatsapp", {
    method: "PUT",
    data: { wabaId: "waba-demo", phoneNumberId: PN, token: "token-demo" },
  });
  await call("/api/settings/branding", {
    method: "PUT",
    data: { name: "Uniko", accent: "#0d5bff", currency: "MXN" },
  });
  await call("/api/agent/profile", { method: "PUT", data: { enabled: true } });
  // Módulos opcionales: con la bandera apagada responden 404 y no pasa nada.
  const dia = [{ start: "09:00", end: "18:00" }];
  await call("/api/calendar/settings", {
    method: "PUT",
    data: {
      weeklyHours: { mon: dia, tue: dia, wed: dia, thu: dia, fri: dia, sat: [{ start: "09:00", end: "14:00" }], sun: [] },
      slotMinutes: 30,
      minNoticeHours: 2,
      maxDaysAhead: 14,
      connector: "enlace-fijo",
      meetingLink: "https://meet.elmartillo.mx/asesoria",
    },
  });
  await call("/api/settings/instagram", {
    method: "PUT",
    data: { source: "zernio", igUserId: null, accountRef: IG_ACCOUNT, token: "sk_test-ok", webhookSecret: ZERNIO_SECRET },
  });
  await call("/api/settings/messenger", {
    method: "PUT",
    data: { source: "zernio", accountRef: FB_ACCOUNT, token: "sk_test-ok" },
  });
  await ctx.storageState({ path: STATE });
  await browser.close();
}

function newContext(browser, { video = false, dark = false, mobile = false } = {}) {
  return browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : VIEWPORT,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    colorScheme: dark ? "dark" : "light",
    storageState: STATE,
    ...(video ? { recordVideo: { dir: TMP, size: VIEWPORT } } : {}),
  });
}

async function prep(ctx, { overlay = true } = {}) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("uniko.panelOpen", "true");
    } catch {}
  });
  if (overlay) await ctx.addInitScript(OVERLAY);
}

// ── Utilidades de "actor" ──────────────────────────────────────────────────
const cursor = new WeakMap();

async function moveTo(page, x, y, steps = 28) {
  const from = cursor.get(page) ?? { x: 700, y: 450 };
  await page.mouse.move(x, y, { steps });
  cursor.set(page, { x, y });
  void from;
}

async function center(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("elemento sin caja visible");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function click(page, loc, pause = 350) {
  const { x, y } = await center(loc);
  await moveTo(page, x, y);
  await sleep(pause);
  await page.mouse.click(x, y);
}

async function cap(page, text, ms = 2600) {
  await page.evaluate((t) => window.__cap?.(t), text).catch(() => {});
  if (ms) await sleep(ms);
}

async function typeInto(page, loc, text, delay = 55) {
  await click(page, loc, 200);
  await loc.pressSequentially(text, { delay });
}

async function drag(page, from, to) {
  const a = await center(from);
  const b = await center(to);
  await moveTo(page, a.x, a.y);
  await sleep(300);
  await page.mouse.down();
  await page.mouse.move(a.x + 14, a.y + 6, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 40 });
  await sleep(350);
  await page.mouse.up();
  cursor.set(page, b);
}

const api = (ctx) => (p, init = {}) =>
  ctx.request.fetch(`${BASE}${p}`, {
    ...init,
    headers: { origin: BASE, ...(init.headers ?? {}) },
  });

/** Un cliente escribe por WhatsApp (mock del webhook de Meta). */
async function inbound(ctx, { from, name, text, referral }) {
  const r = await api(ctx)("/api/dev/wa-mock/inbound", {
    method: "POST",
    data: { phoneNumberId: PN, from, name, text, ...(referral ? { referral } : {}) },
  });
  if (!r.ok()) throw new Error(`inbound ${r.status()}`);
}

/** El ffmpeg mínimo que trae Playwright: VP8 y nada más (no hay mp4). */
function ffmpeg() {
  const base = path.join(homedir(), "AppData", "Local", "ms-playwright");
  const alt = path.join(homedir(), ".cache", "ms-playwright");
  for (const dir of [base, alt]) {
    try {
      const d = readdirSync(dir).find((n) => n.startsWith("ffmpeg-"));
      if (d) {
        const f = readdirSync(path.join(dir, d)).find((n) => n.startsWith("ffmpeg"));
        if (f) return path.join(dir, d, f);
      }
    } catch {}
  }
  return null;
}

/** Los mensajes del agente quedan "pendientes" sin el webhook de estados de Meta: se simula que se leyeron. */
async function marcarLeidos(ctx) {
  const r = await api(ctx)("/api/dev/wa-mock/outbox");
  if (!r.ok()) return;
  const { outbox } = await r.json();
  for (const m of outbox) {
    await api(ctx)("/api/dev/wa-mock/status", {
      method: "POST",
      data: { waMessageId: m.waMessageId, status: "read" },
    }).catch(() => {});
  }
}

/** Un DM de Instagram o Messenger, como lo entrega Zernio (firmado). */
async function dm(canal, { id, name, username, text }) {
  const account = canal === "instagram" ? IG_ACCOUNT : FB_ACCOUNT;
  const evt = {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    event: "message.received",
    message: {
      id: `zmsg-${Math.random().toString(36).slice(2)}`,
      conversationId: `zconv-${id}`,
      direction: "incoming",
      text,
      sentAt: new Date().toISOString(),
      sender: { id, name, ...(username ? { username } : {}) },
    },
    account: {
      id: account,
      accountId: account,
      platform: canal === "instagram" ? "instagram" : "facebook",
      username: "ferreteria.elmartillo",
    },
  };
  const body = JSON.stringify(evt);
  const ruta = canal === "instagram" ? "ig" : "messenger";
  const r = await fetch(`${BASE}/api/webhooks/${ruta}/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", ZERNIO_SECRET).update(body).digest("hex"),
    },
    body,
  });
  if (!r.ok) throw new Error(`webhook ${ruta} ${r.status}`);
}

/** Foto fija en plena escena, sin cursor ni subtítulo. */
async function foto(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const ocultar = (v) =>
    page.evaluate((vis) => {
      for (const id of ["__demo_cur", "__demo_cap"]) {
        const el = document.getElementById(id);
        if (el) el.style.visibility = vis;
      }
    }, v);
  await ocultar("hidden");
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
  await ocultar("");
}

async function listo(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
}

async function ir(page, ruta) {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "load", timeout: 120_000 });
  await listo(page);
}

// ── Capturas ───────────────────────────────────────────────────────────────
async function shots(browser) {
  await mkdir(SHOTS, { recursive: true });
  const ctx = await newContext(browser);
  await prep(ctx, { overlay: false });
  const page = await ctx.newPage();
  let n = 0;
  const snap = async (name) => {
    await listo(page);
    await sleep(700);
    n += 1;
    const f = `${String(n).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(SHOTS, f), animations: "disabled" });
    console.log("  ✓", f);
  };

  await ir(page, "/inbox");
  await page.getByRole("button", { name: /María Fernanda/ }).first().click();
  await page.getByText("¿Tienen taladros inalámbricos?").waitFor();
  await page.getByText("Etapa del pipeline").waitFor();
  await snap("bandeja-conversacion");

  await page.getByRole("button", { name: /Carlos Ramírez/ }).first().click();
  await page.getByText("Ocupo 15 bultos").first().waitFor();
  await snap("bandeja-cotizacion");

  await ir(page, "/pipeline");
  await page.getByText("María Fernanda López").first().waitFor();
  await snap("pipeline");

  await ir(page, "/contacts");
  await page.getByText("Don Chuy Aguilar").first().waitFor();
  await snap("contactos");

  await ir(page, "/agent");
  await page.getByText("Comportamiento").first().waitFor();
  await snap("agente-comportamiento");
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.className.includes("overflow-y-auto") && d.scrollHeight > d.clientHeight);
    el?.scrollTo(0, 330);
  });
  await snap("agente-conocimiento");

  await ir(page, "/lab");
  await page.getByText(/Score 83/).first().click();
  await page.getByText("Elige una corrida del historial").waitFor({ state: "hidden", timeout: 20_000 });
  await snap("laboratorio-reporte");
  await page.getByText("Pregunta fuera del conocimiento").click();
  await page.getByRole("button", { name: "Agregar al conocimiento" }).waitFor();
  await snap("laboratorio-hallazgo-y-sugerencia");

  await ir(page, "/settings/whatsapp");
  await page.getByText(/Número conectado/).waitFor();
  await snap("ajustes-whatsapp");

  await ir(page, "/settings/templates");
  await page.getByText("Nueva plantilla").waitFor();
  await snap("ajustes-plantillas");

  await ir(page, "/settings/branding");
  await page.getByText("Marca del CRM").waitFor();
  await snap("ajustes-marca");
  await ctx.close();

  // Tema oscuro
  const dctx = await newContext(browser, { dark: true });
  await dctx.addCookies([{ name: "uniko-theme", value: "dark", url: BASE }]);
  await prep(dctx, { overlay: false });
  const dp = await dctx.newPage();
  await ir(dp, "/inbox");
  await dp.getByRole("button", { name: /María Fernanda/ }).first().click();
  await dp.getByText("¿Tienen taladros inalámbricos?").waitFor();
  await dp.getByText("Etapa del pipeline").waitFor();
  await listo(dp);
  await sleep(700);
  n += 1;
  await dp.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, "0")}-bandeja-tema-oscuro.png`) });
  console.log("  ✓ bandeja-tema-oscuro");
  await ir(dp, "/pipeline");
  await dp.getByText("María Fernanda López").first().waitFor();
  await listo(dp);
  await sleep(700);
  n += 1;
  await dp.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, "0")}-pipeline-tema-oscuro.png`) });
  console.log("  ✓ pipeline-tema-oscuro");
  await dctx.close();

  // Móvil
  const mctx = await newContext(browser, { mobile: true });
  await prep(mctx, { overlay: false });
  const mp = await mctx.newPage();
  await ir(mp, "/inbox");
  await mp.getByText("María Fernanda López").first().waitFor();
  await listo(mp);
  await sleep(700);
  n += 1;
  await mp.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, "0")}-movil-bandeja.png`) });
  await mp.getByRole("button", { name: /María Fernanda/ }).first().click();
  await mp.getByText("¿Tienen taladros inalámbricos?").waitFor();
  await sleep(700);
  n += 1;
  await mp.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, "0")}-movil-conversacion.png`) });
  console.log("  ✓ móvil");
  await mctx.close();
}

// ── Escenas de video ───────────────────────────────────────────────────────
const SCENES = {};

SCENES["01"] = {
  file: "01-bandeja-y-agente",
  async run(page, ctx, T) {
    await ir(page, "/inbox");
    await page.getByText("Jorge Castillo").first().waitFor();
    T.mark();
    await cap(page, "Todas tus conversaciones de WhatsApp, en una sola bandeja", 3200);

    await click(page, page.getByRole("button", { name: /María Fernanda/ }).first());
    await page.getByText("¿Tienen taladros inalámbricos?").waitFor();
    await cap(page, "Cada hilo muestra lo que respondió la IA y lo que respondió una persona", 3800);
    await cap(page, "Y a la derecha, la ficha del cliente y su etapa en el embudo", 3400);

    await cap(page, "Ahora llega un cliente nuevo por WhatsApp…", 1800);
    await inbound(ctx, {
      from: "5215698765432",
      name: "Marcos Villalobos",
      text: "Hola, buenas tardes, ¿tienen taladros inalámbricos?",
    });
    const nuevo = page.getByRole("button", { name: /Marcos Villalobos/ }).first();
    await nuevo.waitFor({ timeout: 20_000 });
    await cap(page, "Aparece al instante, sin recargar", 2200);
    await click(page, nuevo);
    await page.getByText("Hola, buenas tardes").first().waitFor();

    await cap(page, "El agente contesta solo, con los datos reales de tu negocio", 1500);
    await page.getByText(/Truper 20V/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await cap(page, "Precio, marcas y una pregunta para cerrar la venta", 3600);

    await inbound(ctx, {
      from: "5215698765432",
      name: "Marcos Villalobos",
      text: "Perfecto, me lo llevo. ¿Puedo pasar por él hoy?",
    });
    await page.getByText(/Te aparto el producto/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await cap(page, "Detecta intención de compra y mueve al cliente a «Interesado»", 3800);

    await cap(page, "Cuando quieras, tú tomas la conversación", 1800);
    const box = page.getByPlaceholder("Escribe una respuesta");
    await typeInto(page, box, "Hola Marcos, soy Kevin. Te lo tengo listo, pasa hoy hasta las 7 pm.", 45);
    await sleep(500);
    await box.press("Control+Enter");
    await page.getByText(/soy Kevin/).last().waitFor();
    await sleep(1500);
    await marcarLeidos(ctx);
    await cap(page, "Un solo lugar para el agente y tu equipo", 3200);
    await cap(page, "", 400);
  },
};

SCENES["02"] = {
  file: "02-pipeline",
  async run(page, ctx, T) {
    await ir(page, "/pipeline");
    await page.getByText("María Fernanda López").first().waitFor();
    T.mark();
    await cap(page, "Tu embudo de ventas, ordenado por etapas", 3200);

    const card = (name) => page.locator("div", { has: page.getByText(name, { exact: true }) }).last();
    const col = (name) => page.getByText(name, { exact: true }).first();

    await cap(page, "Arrastra a un cliente a la etapa donde va", 1500);
    await drag(page, page.getByText("Jorge Castillo", { exact: true }).first(), col("En conversación"));
    await sleep(1400);
    await cap(page, "Jorge pasa de «Nuevo» a «En conversación»", 2800);

    await drag(page, page.getByText("Paty Domínguez", { exact: true }).first(), col("Interesado"));
    await sleep(1400);
    await cap(page, "Paty ya está lista para cotizar", 2600);

    await cap(page, "Registra cuánto vale cada oportunidad", 1500);
    void card;
    const tarjetaAna = page
      .getByText("Ana Sofía Torres", { exact: true })
      .first()
      .locator("xpath=ancestor::div[.//*[contains(text(),'+ monto')]][1]");
    await click(page, tarjetaAna.getByText("+ monto"));
    const dlg = page.getByRole("dialog", { name: "Monto y prioridad" }).or(page.getByLabel("Monto y prioridad"));
    await dlg.waitFor();
    await typeInto(page, dlg.getByPlaceholder("12,500.00"), "2240", 140);
    await sleep(500);
    await click(page, dlg.getByRole("button", { name: "Guardar" }));
    await sleep(1800);
    await cap(page, "Cada columna suma lo que tienes en juego", 3200);
    await cap(page, "", 300);
  },
};

SCENES["03"] = {
  file: "03-agente-y-conocimiento",
  async run(page, ctx, T) {
    await ir(page, "/agent");
    await page.getByText("Comportamiento").first().waitFor();
    T.mark();
    await cap(page, "Defines cómo habla tu agente: nombre, tono y reglas", 3600);

    await cap(page, "Y cuándo debe pasarte la conversación a ti", 3200);
    const sw = page.getByRole("switch", { name: "Agente encendido" });
    await cap(page, "Lo enciendes o apagas con un clic", 1500);
    await click(page, sw);
    await sleep(1400);
    await click(page, sw);
    await sleep(1400);

    await cap(page, "Su conocimiento: lo único que el agente puede afirmar", 1500);
    await sleep(2200);
    await typeInto(page, page.getByPlaceholder("Pregunta (p. ej. ¿Hacen envíos?)"), "¿Dan descuento a maestros de obra?", 40);
    await typeInto(
      page,
      page.getByPlaceholder("Respuesta", { exact: true }),
      "Sí: 5% de descuento con credencial de maestro de obra en compras mayores a $1,000 MXN.",
      30
    );
    await cap(page, "Si no está aquí, el agente no lo inventa: lo consulta contigo", 3200);
    await click(page, page.getByRole("button", { name: /Agregar P\/R/ }));
    const nueva = page.getByText("¿Dan descuento a maestros de obra?").last();
    await nueva.waitFor();
    await nueva.scrollIntoViewIfNeeded();
    await sleep(600);
    await cap(page, "Listo: desde ya puede contestarlo", 3200);
    await cap(page, "", 300);
  },
};

SCENES["04"] = {
  file: "04-laboratorio",
  async run(page, ctx, T) {
    await ir(page, "/lab");
    await page.getByText(/Score 83/).first().waitFor();
    T.mark();
    await cap(page, "El Laboratorio prueba a tu agente antes de que lo vean tus clientes", 3800);
    await cap(page, "Seis clientes simulados conversan con él, y un juez califica cada charla", 3800);

    const run = page.getByRole("button", { name: /Correr evaluación/ });
    await click(page, run);
    await cap(page, "Es un sandbox: nunca se envía un mensaje real", 2500);
    await cap(page, "Corriendo la evaluación…", 0);
    await page.getByRole("button", { name: /Corrida en curso/ }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Correr evaluación" }).waitFor({ timeout: 240_000 });
    await cap(page, "", 200);
    await sleep(1500);
    await cap(page, "Resultado: 83 de 100. Hay un hueco en el conocimiento", 3600);

    await click(page, page.getByText("Pregunta fuera del conocimiento").first());
    const agregar = page.getByRole("button", { name: "Agregar al conocimiento" }).first();
    await agregar.waitFor();
    await cap(page, "El juez muestra la evidencia y propone la respuesta que faltaba", 3600);
    await click(page, agregar);
    await sleep(1200);
    await cap(page, "La revisas… y la guardas en un clic", 2600);
    await click(page, page.getByRole("button", { name: "Guardar en el KB" }));
    await page.getByText(/Agregado al conocimiento/).first().waitFor();
    await sleep(1500);

    await cap(page, "Vuelves a correr la evaluación…", 1800);
    await click(page, page.getByRole("button", { name: "Correr evaluación" }));
    await page.getByRole("button", { name: /Corrida en curso/ }).waitFor({ timeout: 60_000 });
    await cap(page, "Corriendo otra vez…", 0);
    await page.getByRole("button", { name: "Correr evaluación" }).waitFor({ timeout: 240_000 });
    await sleep(1500);
    await cap(page, "100 de 100: el agente ya sabe responder lo que le faltaba", 4200);
    await cap(page, "", 300);
  },
};

SCENES["05"] = {
  file: "05-marca-y-ajustes",
  async run(page, ctx, T) {
    await ir(page, "/settings/whatsapp");
    await page.getByText(/Número conectado/).waitFor();
    T.mark();
    await cap(page, "Conectas tu número de WhatsApp Business directamente con Meta", 3800);

    await click(page, page.getByRole("link", { name: "Plantillas" }));
    await page.getByText("Nueva plantilla").waitFor();
    await cap(page, "Plantillas aprobadas para reabrir conversaciones fuera de las 24 h", 3800);

    await click(page, page.getByRole("link", { name: "Marca" }));
    await page.getByText("Marca del CRM").waitFor();
    await cap(page, "Y el CRM se ve como tu marca, no como la nuestra", 3000);
    await click(page, page.getByRole("button", { name: "Verde apagado" }));
    await sleep(900);
    await cap(page, "Elige tu color: el sistema ajusta contraste y tonos solo", 3000);
    await click(page, page.getByRole("button", { name: "Guardar marca" }));
    await sleep(1800);
    await click(page, page.getByRole("button", { name: /tema|oscuro|claro/i }).first());
    await sleep(1200);
    await cap(page, "Con tema claro y oscuro incluidos", 3200);
    await cap(page, "", 300);
  },
};

SCENES["06"] = {
  file: "06-agenda-citas",
  async run(page, ctx, T) {
    await ir(page, "/inbox");
    await page.getByText("Jorge Castillo").first().waitFor();
    T.mark();
    await cap(page, "Tu agente también agenda citas, directo en WhatsApp", 3000);
    const c = { from: "5215587654321", name: "Laura Méndez" };
    await inbound(ctx, { ...c, text: "Hola, quiero agendar una cita para que vengan a medir mi cocina" });
    const fila = page.getByRole("button", { name: /Laura Méndez/ }).first();
    await fila.waitFor({ timeout: 20_000 });
    await click(page, fila);
    await page.getByText(/¿Para qué día/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await cap(page, "Primero pregunta el día…", 2400);
    await inbound(ctx, { ...c, text: "El viernes" });
    await page.getByText(/mañana o por la tarde/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await cap(page, "…luego si prefiere mañana o tarde…", 2400);
    await inbound(ctx, { ...c, text: "Por la tarde" });
    await page.getByText(/te queda mejor|te acomoda/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await cap(page, "…y ofrece cuatro horarios libres de tu agenda real", 3400);
    await inbound(ctx, { ...c, text: "Me queda bien el primero" });
    await page.getByText(/agendad/i).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await sleep(1500);
    await cap(page, "Cita confirmada, con su enlace, sin que intervengas", 3400);
    await foto(page, "16-agenda-cita-por-whatsapp");
    await cap(page, "La ves en la ficha del cliente: puedes moverla o cancelarla a mano", 3600);

    await click(page, page.getByRole("link", { name: "Citas" }));
    await page.getByText("Laura Méndez").first().waitFor({ timeout: 30_000 });
    await sleep(800);
    await cap(page, "Y todas las citas del negocio, en un solo lugar", 3400);
    await foto(page, "17-agenda-citas");
    await cap(page, "", 300);
  },
};

SCENES["07"] = {
  file: "07-inventario-y-catalogo",
  async run(page, ctx, T) {
    await ir(page, "/inbox");
    await page.getByText("Jorge Castillo").first().waitFor();
    T.mark();
    await cap(page, "Conectado a tu inventario, el agente consulta existencias reales", 3200);
    const c = { from: "5215576543210", name: "Sofía Ramírez" };
    await inbound(ctx, { ...c, text: "Hola, ¿tienen impermeabilizante?" });
    const fila = page.getByRole("button", { name: /Sofía Ramírez/ }).first();
    await fila.waitFor({ timeout: 20_000 });
    await click(page, fila);
    await page.getByText(/fibratado/i).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await sleep(1500);
    await cap(page, "Cada producto con su foto, su precio y su existencia", 3600);
    await cap(page, "Solo ofrece lo que hay: el que está agotado no aparece", 3400);
    await foto(page, "18-inventario-productos-con-foto");
    await inbound(ctx, { ...c, text: "¿Tienen catálogo?" });
    await page.getByText(/Catalogo-Ferreteria/i).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await sleep(1200);
    await cap(page, "Y si piden el catálogo, se lo manda en PDF", 3600);
    await foto(page, "19-inventario-catalogo-pdf");
    await cap(page, "", 300);
  },
};

SCENES["08"] = {
  file: "08-anuncio-de-origen",
  async run(page, ctx, T) {
    await ir(page, "/inbox");
    await page.getByText("Jorge Castillo").first().waitFor();
    T.mark();
    await cap(page, "¿Anuncias en Facebook o Instagram con botón de WhatsApp?", 3000);
    await inbound(ctx, {
      from: "5215565432109",
      name: "Gabriela Ortiz",
      text: "Hola, vi su anuncio. ¿Sigue el descuento?",
      referral: {
        source_url: "https://fb.me/elmartillo-lluvias",
        source_id: "120990000000001",
        source_type: "ad",
        headline: "Que no se te llueva la azotea",
        body: "Impermeabilizantes con 20% de descuento esta temporada.",
        media_type: "image",
        image_url: `${META_ORIGIN}/api/dev/wa-mock/media-file/creativo-demo-lluvias`,
        ctwa_clid: "clid-demo-lluvias-1",
      },
    });
    const fila = page.getByRole("button", { name: /Gabriela Ortiz/ }).first();
    await fila.waitFor({ timeout: 20_000 });
    await cap(page, "Cada conversación que llega de un anuncio queda marcada", 3000);
    await click(page, fila);
    await page.getByText(/20% de descuento/).last().waitFor({ timeout: 60_000 });
    await marcarLeidos(ctx);
    await sleep(1500);
    await cap(page, "Y sabes exactamente qué anuncio la trajo, con su imagen", 3800);
    await foto(page, "20-anuncio-de-origen");
    const chip = page.getByRole("button", { name: /Anuncios/ }).first();
    if (await chip.count()) {
      await click(page, chip);
      await sleep(1200);
      await cap(page, "Filtra con un clic las que vinieron de publicidad", 3200);
    }
    await cap(page, "", 300);
  },
};

SCENES["09"] = {
  file: "09-instagram-y-messenger",
  async run(page, ctx, T) {
    await ir(page, "/inbox");
    await page.getByText("Jorge Castillo").first().waitFor();
    T.mark();
    await cap(page, "Instagram y Messenger, en la misma bandeja que WhatsApp", 3000);
    await dm("instagram", {
      id: "igsid-demo-valeria",
      name: "Valeria Campos",
      username: "valeria.decora",
      text: "Hola! ¿hacen envíos a domicilio?",
    });
    const ig = page.getByRole("button", { name: /Valeria Campos/ }).first();
    await ig.waitFor({ timeout: 20_000 });
    await dm("messenger", { id: "psid-demo-fernando", name: "Fernando Ruiz", text: "Buenas, ¿a qué hora abren el domingo?" });
    const fb = page.getByRole("button", { name: /Fernando Ruiz/ }).first();
    await fb.waitFor({ timeout: 20_000 });
    await cap(page, "Cada mensaje dice de qué red llegó", 3200);
    await click(page, ig);
    await page.getByText(/entrega a domicilio/).last().waitFor({ timeout: 60_000 });
    await sleep(1200);
    await cap(page, "El mismo agente contesta en cada canal", 3200);
    await foto(page, "21-instagram-en-la-bandeja");
    await click(page, fb);
    await page.getByText(/domingos de 9:00/).last().waitFor({ timeout: 60_000 });
    await sleep(1200);
    await cap(page, "Un solo equipo, un solo historial por cliente", 3400);
    await foto(page, "22-messenger-en-la-bandeja");
    await cap(page, "", 300);
  },
};

async function escena(browser, id) {
  const sc = SCENES[id];
  if (!sc) throw new Error(`Escena desconocida: ${id}`);
  await mkdir(VIDEOS, { recursive: true });
  await rm(TMP, { recursive: true, force: true });
  const ctx = await newContext(browser, { video: true });
  await prep(ctx);
  const page = await ctx.newPage();
  // El video empieza al abrir la página: lo que tarde en cargar queda grabado.
  // La escena avisa con T.mark() cuando ya hay algo que mostrar y se recorta lo anterior.
  const t0 = Date.now();
  const T = { start: 0, mark: () => (T.start = (Date.now() - t0) / 1000) };
  let error;
  try {
    await sc.run(page, ctx, T);
  } catch (e) {
    error = e;
    await page.screenshot({ path: path.join(TMP, `fallo-${id}.png`) }).catch(() => {});
  }
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const dst = path.join(VIDEOS, `${sc.file}.webm`);
  await rm(dst, { force: true });
  const ff = ffmpeg();
  if (ff && T.start > 0.5) {
    const r = spawnSync(
      ff,
      ["-ss", String(Math.max(0, T.start - 0.3)), "-i", src, "-c:v", "libvpx", "-b:v", "2500k", "-crf", "10", "-y", dst],
      { stdio: "ignore" }
    );
    if (r.status !== 0) await rename(src, dst);
  } else {
    await rename(src, dst);
  }
  if (error) {
    console.error(`  ✗ ${id} ${sc.file}:`, error.message.split("\n")[0]);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${id} ${sc.file}.webm`);
  }
}

/** Visita cada ruta una vez para que `next dev` ya las tenga compiladas. */
async function prewarm(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  for (const r of ["/inbox", "/pipeline", "/agent", "/lab", "/contacts", "/bookings", "/settings/whatsapp", "/settings/templates", "/settings/branding"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "load", timeout: 120_000 }).catch(() => {});
    await sleep(2500);
  }
  // Rutas de API que solo se tocan en pleno video: el LLM de demostración
  // (3101) y el webhook, para que su primera compilación no caiga en cámara.
  await fetch("http://localhost:3101/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: "x" }, { role: "user", content: "hola" }] }),
  }).catch(() => {});
  await api(ctx)("/api/dev/wa-mock/inbound", { method: "POST", data: {} }).catch(() => {});
  // En dev cada ruta compila la primera vez (~9 s): si eso cae en pleno turno
  // del agente, el envío de la foto se agota y sale solo el texto.
  await fetch("http://localhost:3101/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: "x" }, { role: "user", content: "hola" }] }),
  }).catch(() => {});
  await fetch(`${META_ORIGIN}/api/dev/wa-mock/graph/v25.0/${PN}/messages`, { method: "POST", body: "{}" }).catch(() => {});
  for (const ruta of ["ig", "messenger"]) {
    await fetch(`${BASE}/api/webhooks/${ruta}/${VERIFY_TOKEN}`, { method: "POST", body: "{}" }).catch(() => {});
  }
  for (const p of ["/api/bookings", "/api/calendar/availability", "/api/templates"]) {
    await api(ctx)(p).catch(() => {});
  }
  await ctx.close();
}

// ── Main ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/demo-media.mjs shots | 01 02 … | all");
  process.exit(1);
}
await bootstrap();
const browser = await chromium.launch();
try {
  await prewarm(browser);
  const todo = args.includes("all") ? ["shots", ...Object.keys(SCENES)] : args;
  for (const a of todo) {
    if (a === "shots") await shots(browser);
    else await escena(browser, a);
  }
} finally {
  await browser.close();
}
