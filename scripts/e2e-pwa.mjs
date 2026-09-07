/**
 * Self-test E2E de comportamiento — 019: PWA instalable.
 * Guion tests/e2e/us-pwa.md, nivel 2 (escritorio, navegador de verdad).
 *
 * Lo que de verdad se juega aquí no es instalar: es que el service worker, que
 * se pone delante de TODA la red de la app, no se ponga delante del canal SSE
 * que la 018 acaba de endurecer. Esa comprobación (escenario B) exige **las dos
 * mitades en la misma corrida**:
 *
 *   1. el service worker está de verdad en el camino  → workerStart > 0 en la
 *      navegación, que el service worker sí responde
 *   2. y aun así el canal de eventos no pasó por él   → el propio service worker
 *      reporta que vio 0 peticiones excluidas
 *
 * La mitad 2 se planeó con workerStart === 0 y no sirve: Chromium lo sella igual
 * pase o no la petición por el handler (medido en la 149).
 *
 * Con una sola mitad, esto daría verde sin probar nada: si el service worker no
 * llegó a controlar la página, el canal "no pasa por él" trivialmente. Es el
 * mismo error que costó una vuelta en la 018, cuando enmudecer una sola de las
 * dos suscripciones dejaba viva la conexión sana.
 *
 * Uso: node --env-file=.env scripts/e2e-pwa.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 */
import { readFileSync } from "node:fs";
import { chromium, devices } from "playwright";
import { contextoConSesion } from "./e2e-sesion.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();

/* ─────────────────── Setup ─────────────────── */

console.log("== Setup: operador dentro ==");
// Sesión compartida entre arneses: el login de la app limita intentos, y esa
// defensa no se toca (ver scripts/e2e-sesion.mjs).
const { ctx, reutilizada } = await contextoConSesion(browser, BASE, {
  viewport: { width: 1400, height: 900 },
});
const req = ctx.request;
ok(`operador dentro (${reutilizada ? "sesión reutilizada" : "login nuevo"})`, true);

/* ═════════ A: el manifiesto lleva la marca de la instancia ═════════ */

console.log("\n== A: el manifiesto (US1) ==");

const manRes = await req.get(`${BASE}/api/branding/manifest`);
ok("el manifiesto responde", manRes.ok(), `status=${manRes.status()}`);
ok(
  "se sirve como manifiesto, no como JSON genérico",
  (manRes.headers()["content-type"] ?? "").includes("application/manifest+json"),
  manRes.headers()["content-type"]
);

const man = await manRes.json();
const marcaRes = await req.get(`${BASE}/api/settings/branding`);
const marca = marcaRes.ok() ? (await marcaRes.json()).branding : null;

ok(
  "lleva el nombre de la instancia",
  typeof man.name === "string" && man.name.startsWith(marca?.name ?? "Uniko"),
  `${man.name} vs ${marca?.name}`
);
ok(
  "lleva el acento de la instancia como color de tema",
  man.theme_color === (marca?.accent ?? "#0d5bff"),
  `${man.theme_color} vs ${marca?.accent}`
);
ok("se abre en la bandeja", man.start_url === "/inbox", man.start_url);
ok("sin barra de direcciones", man.display === "standalone", man.display);
ok("tiene un id estable", typeof man.id === "string" && man.id.length > 0, man.id);

const medidas = (man.icons ?? []).flatMap((i) =>
  String(i.sizes).split(" ").map((s) => Number(s.split("x")[0]))
);
ok(
  "declara un icono de 192 o más y otro de 512 o más",
  medidas.some((m) => m >= 192) && medidas.some((m) => m >= 512),
  JSON.stringify(medidas)
);
ok(
  "todos los iconos son PNG (SVG no vale para instalar)",
  (man.icons ?? []).every((i) => i.type === "image/png"),
  JSON.stringify((man.icons ?? []).map((i) => i.type))
);

for (const icono of man.icons ?? []) {
  const iconoRes = await req.get(new URL(icono.src, BASE).toString());
  ok(
    `el icono ${icono.sizes} responde y es PNG`,
    iconoRes.ok() && (iconoRes.headers()["content-type"] ?? "").includes("image/png"),
    `${iconoRes.status()} ${iconoRes.headers()["content-type"]}`
  );
}

/* ═════════ B: el service worker, y las DOS MITADES ═════════ */

console.log("\n== B: el service worker no toca el canal de eventos (FR-413/414) ==");

const page = await ctx.newPage();
await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });

// Esperar a que el service worker no solo se registre, sino que CONTROLE la
// página. Registrado y sin controlar no sirve: no estaría en el camino.
const controlado = await page
  .waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30000,
  })
  .then(() => true)
  .catch(() => false);
ok("el service worker se registra y controla la página", controlado);

// Recargar: así la navegación misma pasa por el service worker y su medida
// aparece en el timing.
await page.reload({ waitUntil: "load" });
await sleep(500);

const mitadA = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  return {
    workerStart: nav?.workerStart ?? 0,
    controlada: navigator.serviceWorker?.controller != null,
  };
});
ok(
  "MITAD 1: el service worker está de verdad en el camino (workerStart > 0)",
  mitadA.controlada && mitadA.workerStart > 0,
  `workerStart=${mitadA.workerStart}, controlada=${mitadA.controlada}`
);

const mitadB = await page.evaluate(async () => {
  // Se pide el canal varias veces, con parámetros distintos.
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController();
    try {
      const res = await fetch("/api/events?probe=" + Date.now() + "-" + i, {
        signal: ctrl.signal,
      });
      const reader = res.body && res.body.getReader();
      if (reader) {
        await reader.read();
        await reader.cancel();
      }
    } catch {
      // Abortado a propósito: el stream no termina nunca.
    }
    ctrl.abort();
  }
  // Y una petición normal, para tener con qué comparar.
  await fetch("/api/conversations");

  // Se le pregunta al service worker cuántas peticiones EXCLUIDAS llegó a ver.
  const respuesta = await new Promise((resolve) => {
    const alMensaje = (ev) => {
      if (ev.data && ev.data.tipo === "uniko:diagnostico") {
        navigator.serviceWorker.removeEventListener("message", alMensaje);
        resolve(ev.data);
      }
    };
    navigator.serviceWorker.addEventListener("message", alMensaje);
    navigator.serviceWorker.controller.postMessage("uniko:diagnostico");
    setTimeout(() => resolve(null), 5000);
  });

  const recursos = performance.getEntriesByType("resource");
  const eventos = recursos.filter((e) => e.name.includes("/api/events")).at(-1);
  const normal = recursos
    .filter((e) => e.name.includes("/api/conversations"))
    .at(-1);
  return {
    respondio: respuesta !== null,
    excluidasVistas: respuesta ? respuesta.excluidasVistas : null,
    workerStartEventos: eventos ? eventos.workerStart : null,
    workerStartNormal: normal ? normal.workerStart : null,
  };
});

ok(
  "el service worker responde cuántas peticiones excluidas ha visto",
  mitadB.respondio,
  "sin respuesta no se puede afirmar nada"
);
ok(
  "MITAD 2: el handler NUNCA vio la petición del canal de eventos",
  mitadB.excluidasVistas === 0,
  `el handler vio ${mitadB.excluidasVistas} peticiones excluidas`
);
console.log(
  `     (workerStart informativo — navegación=${mitadA.workerStart.toFixed(1)}, ` +
    `eventos=${mitadB.workerStartEventos ?? "s/d"}, normal=${mitadB.workerStartNormal ?? "s/d"}: ` +
    `el timing se sella igual pase o no por el handler, por eso no se usa para afirmar)`
);

// Las dos mitades juntas, dicho de una vez: es lo que pide FR-414.
ok(
  "las DOS mitades en la misma corrida (si falta una, esto no prueba nada)",
  mitadA.controlada && mitadA.workerStart > 0 && mitadB.excluidasVistas === 0,
  `navegación=${mitadA.workerStart}, excluidas vistas=${mitadB.excluidasVistas}`
);

console.log("\n== B: y el service worker sigue sin pedir nada ni guardar nada ==");
const sw = await (await req.get(`${BASE}/sw.js`)).text();
ok("el service worker servido no cachea", !/caches\.(open|match)/.test(sw));
ok("no pide permiso de notificaciones (SC-009)", !/Notification|showNotification/.test(sw));
const permisoPedido = await page.evaluate(
  () => window.__permisoNotificacionesPedido === true
);
ok("la app tampoco lo pide desde el cliente", permisoPedido !== true);

/* ═════════ C: el aviso de instalar ═════════ */

console.log("\n== C: el botón de instalar (US1) ==");

// El evento real solo lo emite el navegador cuando decide que se puede
// instalar, y en headless no ocurre. Se simula el evento para probar NUESTRA
// interfaz; que el navegador lo emita de verdad es el nivel 3.
await page.evaluate(() => {
  const ev = new Event("beforeinstallprompt");
  Object.assign(ev, {
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  window.dispatchEvent(ev);
});
await sleep(400);

const aviso = page.locator("[data-testid=install-prompt]");
ok("aparece el aviso de instalar", (await aviso.count()) === 1);
ok(
  "y es el botón, no las instrucciones (esto es un Chromium)",
  (await aviso.getAttribute("data-aviso")) === "boton",
  await aviso.getAttribute("data-aviso")
);

await page.locator("[data-testid=install-dismiss]").click();
await sleep(300);
ok("se puede descartar", (await aviso.count()) === 0);

await page.reload({ waitUntil: "load" });
await sleep(800);
await page.evaluate(() => {
  const ev = new Event("beforeinstallprompt");
  Object.assign(ev, {
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  window.dispatchEvent(ev);
});
await sleep(400);
ok(
  "y el descarte se respeta al volver (FR-405)",
  (await page.locator("[data-testid=install-prompt]").count()) === 0
);

/* ═════════ D: ya instalada, no se insiste ═════════ */

console.log("\n== D: en modo instalado no se insiste (FR-404, SC-008) ==");

/*
 * Cómo se simula "abierta desde la pantalla de inicio", y por qué así.
 *
 * Chromium NO emula display-mode: standalone. Se intentó con
 * Emulation.setEmulatedMedia y matchMedia sigue diciendo "browser" (comprobado
 * midiéndolo). Con esa emulación que no emulaba, este escenario pasaba **por el
 * motivo equivocado**: el aviso no salía porque el contexto ya lo tenía
 * descartado del escenario C, no porque la app estuviera instalada.
 *
 * Se inyecta entonces navigator.standalone, que es la señal REAL de iOS y la
 * que lee lib/platform. Y se comprueba en un contexto LIMPIO, con las dos
 * mitades: sin la señal el aviso SÍ aparece, con ella no. Sin la primera, la
 * segunda no prueba nada.
 */
const { ctx: ctxLimpio } = await contextoConSesion(browser, BASE, {
  viewport: { width: 1400, height: 900 },
});

const dispararEvento = async (pagina) => {
  await pagina.evaluate(() => {
    const ev = new Event("beforeinstallprompt");
    Object.assign(ev, {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(ev);
  });
  await sleep(500);
};

const comoNavegador = await ctxLimpio.newPage();
await comoNavegador.goto(`${BASE}/inbox`, { waitUntil: "load" });
await sleep(800);
await dispararEvento(comoNavegador);
ok(
  "MITAD 1: en este contexto limpio el aviso SÍ aparece",
  (await comoNavegador.locator("[data-testid=install-prompt]").count()) === 1,
  "si no aparece, la mitad 2 no probaría nada"
);

const comoInstalada = await ctxLimpio.newPage();
await comoInstalada.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
});
await comoInstalada.goto(`${BASE}/inbox`, { waitUntil: "load" });
await sleep(800);
await dispararEvento(comoInstalada);
ok(
  "MITAD 2: corriendo instalada NO aparece, ni con evento de instalación",
  (await comoInstalada.locator("[data-testid=install-prompt]").count()) === 0
);

console.log("\n== E: en iPhone se explica el camino del sistema (US2) ==");

const { ctx: ctxIphone } = await contextoConSesion(browser, BASE, {
  ...devices["iPhone 13"],
});
const iphone = await ctxIphone.newPage();
await iphone.goto(`${BASE}/inbox`, { waitUntil: "load" });
await sleep(1500);

const avisoIphone = iphone.locator("[data-testid=install-prompt]");
ok("en iPhone aparece el aviso", (await avisoIphone.count()) === 1);
ok(
  "y son INSTRUCCIONES, no un botón (iOS no ofrece el evento)",
  (await avisoIphone.getAttribute("data-aviso")) === "instrucciones",
  await avisoIphone.getAttribute("data-aviso")
);
ok(
  "no hay botón de instalar que tocar",
  (await iphone.locator("[data-testid=install-button]").count()) === 0
);

const textoIphone = (await avisoIphone.innerText()).replace(/\s+/g, " ");
ok(
  "dice QUÉ TOCAR: Compartir y Añadir a pantalla de inicio",
  /Compartir/i.test(textoIphone) && /Añadir a pantalla de inicio/i.test(textoIphone),
  textoIphone
);
ok(
  "y dónde está ese botón, no solo su nombre",
  /flecha/i.test(textoIphone) && /barra|abajo/i.test(textoIphone),
  textoIphone
);
ok(
  "no explica qué es una PWA ni usa jerga",
  !/PWA|aplicaci[oó]n web|progresiva|service worker|manifiesto/i.test(textoIphone),
  textoIphone
);
ok(
  "no da por hecho que es la primera vez (FR-423)",
  !/bienvenid|la primera vez|por primera vez|enhorabuena|felicidades/i.test(textoIphone),
  textoIphone
);

/* ═════════ F: volver a entrar en la app instalada (US2) ═════════ */

console.log("\n== F: el re-login de iOS no parece un fallo (US2) ==");

// Sin sesión Y en modo instalado: es la pantalla exacta que ve quien abre la
// app desde la pantalla de inicio tras el descarte de los ~7 días de iOS.
const ctxSinSesion = await browser.newContext({ ...devices["iPhone 13"] });
const sinSesion = await ctxSinSesion.newPage();
// Misma señal real de iOS que en D: Chromium no emula display-mode.
await sinSesion.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
});
await sinSesion.goto(`${BASE}/login`, { waitUntil: "load" });
await sleep(1200);

const nota = sinSesion.locator("[data-testid=sesion-instalada]");
ok("en la app instalada y sin sesión, el login lo explica", (await nota.count()) === 1);

const textoNota = (await nota.innerText()).replace(/\s+/g, " ");
ok(
  "dice que no se ha perdido nada",
  /no se ha perdido|sigue todo|donde estaba/i.test(textoNota),
  textoNota
);
ok(
  "sirve la quinta vez igual que la primera (FR-423)",
  !/bienvenid|la primera vez|por primera vez|acabas de instalar|enhorabuena/i.test(textoNota),
  textoNota
);
ok(
  "menciona las DOS causas: sesión aparte y borrado por inactividad",
  /aparte|separad/i.test(textoNota) && /d[ií]as|inactiv|sin usarla/i.test(textoNota),
  textoNota
);

// En el navegador normal esa nota NO aparece: ahí entrar es lo de siempre.
const enNavegador = await ctxSinSesion.newPage();
await enNavegador.goto(`${BASE}/login`, { waitUntil: "load" });
await sleep(800);
ok(
  "en el navegador normal esa nota no sale (FR-424)",
  (await enNavegador.locator("[data-testid=sesion-instalada]").count()) === 0
);

/* ═════════ G: el icono que no sirve para instalar (US3) ═════════ */

console.log("\n== G: sin PNG grande, se instala igual y se dice qué falta (US3) ==");

// Estado de partida: el de las tres instancias de la flota hoy — icono generado
// en SVG, que no sirve para la pantalla de inicio.
await req.delete(`${BASE}/api/settings/branding/favicon`);
const manSinPng = await (await req.get(`${BASE}/api/branding/manifest`)).json();
ok(
  "sin PNG del negocio, el manifiesto trae los DOS iconos de fábrica",
  manSinPng.icons.length === 2 &&
    manSinPng.icons.every((i) => i.src.startsWith("/icon-")),
  JSON.stringify(manSinPng.icons.map((i) => i.src))
);
ok(
  "y aun así la app es instalable (192 y 512 declarados)",
  manSinPng.icons.some((i) => i.sizes.includes("192x192")) &&
    manSinPng.icons.some((i) => i.sizes.includes("512x512")),
  JSON.stringify(manSinPng.icons.map((i) => i.sizes))
);

const ajustes = await ctx.newPage();
await ajustes.goto(`${BASE}/settings/branding`, { waitUntil: "load" });
await sleep(1200);
const avisoIcono = ajustes.locator("[data-testid=icono-no-instalable]");
ok("Ajustes → Marca avisa de que el icono no sirve", (await avisoIcono.count()) === 1);
const textoIcono = (await avisoIcono.innerText()).replace(/\s+/g, " ");
ok(
  "y dice exactamente qué subir",
  /PNG/.test(textoIcono) && /512/.test(textoIcono) && /cuadrad/i.test(textoIcono),
  textoIcono
);

// Ahora se sube uno que SÍ sirve: el propio icono de fábrica de 512.
const png512 = readFileSync("public/icon-512.png");
const subida = await req.put(`${BASE}/api/settings/branding/favicon`, {
  headers: { "content-type": "image/png" },
  data: png512,
});
ok("se sube un PNG de 512×512", subida.ok(), `status=${subida.status()}`);

const manConPng = await (await req.get(`${BASE}/api/branding/manifest`)).json();
ok(
  "el manifiesto pasa a traer UNA sola entrada, la del negocio",
  manConPng.icons.length === 1 &&
    manConPng.icons[0].src.includes("/api/branding/icon"),
  JSON.stringify(manConPng.icons)
);
ok(
  "declarada para las dos medidas (nada de mezclar logos)",
  manConPng.icons[0].sizes === "192x192 512x512",
  manConPng.icons[0].sizes
);

await ajustes.reload({ waitUntil: "load" });
await sleep(1200);
ok(
  "y el aviso desaparece solo (FR-428)",
  (await ajustes.locator("[data-testid=icono-no-instalable]").count()) === 0
);

// Se deja como estaba: el icono generado.
await req.delete(`${BASE}/api/settings/branding/favicon`);

await browser.close();

console.log(
  `\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`
);
process.exit(failures > 0 ? 1 : 0);
