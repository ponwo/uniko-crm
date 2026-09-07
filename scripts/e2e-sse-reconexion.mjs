/**
 * Self-test E2E de comportamiento — 018: reconexión resiliente del SSE.
 * Guion tests/e2e/us-reconexion-sse.md, nivel 2 (escritorio, muerte silenciosa
 * SIMULADA). Cubre T016 (US1) y T021 (US2).
 *
 * Por qué vive fuera de `e2e-selftest.mjs`: lo que hay que verificar aquí no es
 * una respuesta HTTP, es lo que el operador VE mientras la conexión miente.
 * Eso necesita un navegador de verdad, igual que `e2e-send-failure.mjs` o
 * `e2e-responsive.mjs`. `pnpm test:e2e` corre los dos, así que el arnés sigue
 * siendo un solo comando.
 *
 * El truco central: se intercepta `/api/events` y las conexiones del arranque
 * se redirigen al simulador `/api/dev/sse-mudo`, que abre un stream válido y
 * deja de escribir sin cerrarlo. El navegador nunca se entera —ni `error` ni
 * cambio de `readyState`—, que es exactamente el fallo de iOS. Los reintentos
 * del vigilante, ya fuera de esa ventana, encuentran el canal real.
 *
 * Uso: node --env-file=.env scripts/e2e-sse-reconexion.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 *
 * Es lento a propósito (~3 min): el margen de silencio son 60 s reales. Falsear
 * el reloj probaría el reloj falso, no la detección.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-SSE-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

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

/** ¿Está el aviso de conexión en pantalla? Devuelve su estado o null. */
async function aviso(page) {
  const el = page.locator("[data-testid=connection-status]");
  if ((await el.count()) === 0) return null;
  return {
    state: await el.getAttribute("data-state"),
    texto: (await el.innerText()).replace(/\s+/g, " ").trim(),
  };
}

/** Espera a que el aviso aparezca. Devuelve su estado, o null si no apareció. */
async function esperarAviso(page, timeoutMs) {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const a = await aviso(page);
    if (a) return a;
    await sleep(250);
  }
  return null;
}

/** Espera a que el aviso desaparezca. */
async function esperarSinAviso(page, timeoutMs) {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    if (!(await aviso(page))) return true;
    await sleep(250);
  }
  return false;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const req = ctx.request;

/* ─────────────────── Setup ─────────────────── */

console.log("== Setup: operador, WhatsApp conectado y una conversación ==");
let r = await req.post(`${BASE}/api/auth/sign-up/email`, {
  headers: { origin: BASE },
  data: {
    email: "e2e@uniko.test",
    password: "password-e2e-123",
    name: "Operador E2E",
  },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@uniko.test", password: "password-e2e-123" },
  });
ok("login del operador", r.ok());

await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-SSE", phoneNumberId: PN, token: "tok-sse" },
});

const NOMBRE = `Silencio${S}`;
const TEL = `521477${Math.floor(Math.random() * 9e6) + 1e6}`;
/**
 * Inyecta un inbound por el mock. Usa el `fetch` de Node y NO el del navegador
 * a propósito: el escenario C deja al navegador sin red, y el mensaje del corte
 * tiene que entrar igual — es lo que hace que haya hueco que recuperar.
 */
const inbound = (text, id) =>
  fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phoneNumberId: PN,
      from: TEL,
      name: NOMBRE,
      text,
      waMessageId: `wamid.sse.${S}.${id}`,
    }),
  });

await inbound("hola, ¿siguen abiertos?", "0");
await sleep(2500);
const convs = (await (await req.get(`${BASE}/api/conversations`)).json())
  .conversations;
const conv = convs.find((c) => c.contact.name === NOMBRE);
ok("conversación de prueba creada", !!conv, NOMBRE);

/* ═══════════════ Escenario A: muerte silenciosa ═══════════════ */

console.log("\n== A: el stream enmudece sin cerrarse (simulador sse-mudo) ==");

const page = await ctx.newPage();

let eventsHits = 0;
let reconexiones = 0;
/** Hasta cuándo frenar el refresco (sello de tiempo), para observar FR-311. */
let retrasarCatchUp = 0;
const RETRASO_CATCHUP_MS = 6000;
let catchUpEnCurso = false;

/**
 * Ventana de mudez: TODA conexión abierta en los primeros 30 s va al simulador.
 *
 * No basta con enmudecer "la primera": en desarrollo React monta el efecto dos
 * veces (StrictMode) y la conexión viva es la segunda. Si esa fuera al canal
 * real no habría muerte silenciosa que detectar, y el test pasaría por el
 * camino sano creyendo que probó el enfermo — que es precisamente la clase de
 * verde inútil que esta feature existe para no repetir.
 *
 * Los reintentos del vigilante llegan pasados ~70 s, ya fuera de la ventana, y
 * encuentran el canal real esperándolos.
 */
const MUDEZ_MS = 30_000;
let montadaEn = Date.now();

await page.route("**/api/events**", async (route) => {
  eventsHits += 1;
  if (Date.now() - montadaEn < MUDEZ_MS) {
    // La conexión que va a morir en silencio: dos señales de vida y a callar.
    await route.continue({
      url: `${BASE}/api/dev/sse-mudo?latidos=2&intervalo=500`,
    });
  } else {
    reconexiones += 1;
    await route.continue();
  }
});

/**
 * Frena el refresco durante una ventana de tiempo, para poder MIRAR el orden.
 *
 * Hace falta porque el aviso sale con 2 s de retardo (FR-312: una reconexión
 * limpia no debe parpadear) y en localhost reconectar + refrescar tarda ~1 s:
 * sin frenar el refresco, la recuperación entera cabe dentro del retardo y no
 * hay nada que observar. En un teléfono con red móvil —donde se reportó el
 * fallo— ese refresco tarda de sobra. Se frena el REFRESCO, no el reloj del
 * vigilante: lo que se prueba sigue siendo la app.
 *
 * Frena TODAS las peticiones de la ventana, no solo la primera: en la bandeja
 * hay dos suscripciones vivas (la propia y el contador de la barra), y frenar
 * una sola dejaba la del inbox rápida, que es justo la que pinta el aviso.
 */
let enVuelo = 0;
const frenarCatchUp = async (route) => {
  if (Date.now() < retrasarCatchUp) {
    enVuelo += 1;
    catchUpEnCurso = true;
    await sleep(RETRASO_CATCHUP_MS);
    enVuelo -= 1;
    if (enVuelo === 0) catchUpEnCurso = false;
  }
  await route.continue();
};
await page.route("**/api/conversations", frenarCatchUp);
await page.route("**/api/conversations?*", frenarCatchUp);

montadaEn = Date.now();
await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
await page.getByText(NOMBRE).first().waitFor({ timeout: 30000 });
await page.getByText(NOMBRE).first().click();
await page
  .getByText("hola, ¿siguen abiertos?")
  .first()
  .waitFor({ timeout: 20000 });
const t0 = Date.now();

await sleep(4000);
ok(
  "la bandeja arranca conectada y SIN aviso",
  (await aviso(page)) === null,
  JSON.stringify(await aviso(page))
);
ok(
  "toda conexión viva es la del simulador (aún sin reconectar)",
  eventsHits >= 1 && reconexiones === 0,
  `conexiones=${eventsHits}, reconexiones=${reconexiones}`
);

// El hueco: entra un mensaje mientras la conexión está muda.
const HUECO = `mensaje del hueco ${S}`;
await inbound(HUECO, "1");
await sleep(4000);

const thread = page.locator(".thread-bg");
ok(
  "el mensaje del hueco NO llega por el stream muerto",
  (await thread.getByText(HUECO).count()) === 0
);
ok(
  "y el navegador sigue sin enterarse: ni error ni reconexión propia",
  reconexiones === 0,
  `reconexiones=${reconexiones}`
);
ok(
  "tampoco hay aviso todavía (el margen de silencio no ha pasado)",
  (await aviso(page)) === null,
  JSON.stringify(await aviso(page))
);

console.log("\n== A: la app lo detecta sola y lo dice (FR-308, FR-311) ==");

// A partir de aquí el catch-up tarda a propósito, para poder mirar el orden:
// primero el aviso, y solo cuando el refresco TERMINA se retira. La ventana
// cubre de sobra el momento de la detección (~70 s desde que abrió la bandeja).
retrasarCatchUp = Date.now() + 90_000;

const visto = await esperarAviso(page, 100_000);
const tDeteccion = Math.round((Date.now() - t0) / 1000);
ok(
  "pasado el margen de silencio, aparece el aviso",
  !!visto,
  `esperado ~72 s, transcurridos ${tDeteccion} s`
);
console.log(
  `     (detectado a los ${tDeteccion} s; aviso: ${JSON.stringify(visto)})`
);

ok(
  "reconectó sola, ya contra el canal real",
  reconexiones >= 1,
  `reconexiones=${reconexiones}`
);

// FR-311: durante el catch-up el aviso SIGUE, y lo dice con sus palabras.
let vistoPonerseAlDia = false;
const hastaA = Date.now() + 15_000;
while (Date.now() < hastaA) {
  const a = await aviso(page);
  if (a?.state === "poniendose-al-dia") {
    vistoPonerseAlDia = true;
    ok(
      "mientras el catch-up corre, el aviso sigue y dice 'Poniendo al día…'",
      /Poniendo al d/i.test(a.texto),
      a.texto
    );
    ok("y el refresco está de verdad en curso en ese momento", catchUpEnCurso);
    break;
  }
  if (!a && !catchUpEnCurso) break;
  await sleep(150);
}
if (!vistoPonerseAlDia)
  ok(
    "mientras el catch-up corre, el aviso sigue en pantalla",
    false,
    "no se observó el estado poniendose-al-dia"
  );

retrasarCatchUp = 0; // se levanta el freno: lo que quedaba ya se observó
ok(
  "el aviso se retira SOLO cuando el catch-up termina",
  await esperarSinAviso(page, 25_000)
);

await thread
  .getByText(HUECO)
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => {});
const huecoEnPantalla = await thread.getByText(HUECO).count();
ok("el mensaje del hueco está tras el catch-up", huecoEnPantalla >= 1);
ok(
  "y está UNA sola vez (sin duplicados, FR-308)",
  huecoEnPantalla === 1,
  `apariciones=${huecoEnPantalla}`
);

const apiMsgs = (
  await (await req.get(`${BASE}/api/conversations/${conv.id}/messages`)).json()
).messages;
ok(
  "y tampoco se duplicó en la base",
  apiMsgs.filter((m) => m.text === HUECO).length === 1,
  `${apiMsgs.filter((m) => m.text === HUECO).length} filas`
);

console.log("\n== A: la bandeja vuelve a estar viva (el canal real entrega) ==");
const DESPUES = `ya reconectados ${S}`;
await inbound(DESPUES, "2");
await thread
  .getByText(DESPUES)
  .first()
  .waitFor({ timeout: 25000 })
  .catch(() => {});
ok(
  "un mensaje nuevo llega en vivo por el canal reconectado",
  (await thread.getByText(DESPUES).count()) === 1
);

await page.close();

/* ═══════════ Escenario B: una reconexión limpia no parpadea ═══════════ */

console.log("\n== B: reconexión limpia y rápida — sin parpadeo (FR-312) ==");

const page2 = await ctx.newPage();
let hits2 = 0;
await page2.route("**/api/events**", async (route) => {
  hits2 += 1;
  // Las dos suscripciones vivas de la pantalla (la bandeja y el contador de la
  // barra) sufren el mismo corte; sus reintentos (3 en adelante) van al canal
  // real.
  if (hits2 <= 2) {
    // Un corte limpio y brevísimo: el servidor pide reintento en 200 ms y
    // cierra. Es lo que pasa al desbloquear el teléfono o al saltar de wifi a
    // datos, y el operador no tiene por qué enterarse.
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
      },
      body: "retry: 200\n\n: conectado\n\n",
    });
  } else {
    await route.continue();
  }
});

await page2.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
await page2.getByText(NOMBRE).first().waitFor({ timeout: 30000 });
await page2.getByText(NOMBRE).first().click();

let parpadeo = null;
const hastaB = Date.now() + 8000;
while (Date.now() < hastaB) {
  const a = await aviso(page2);
  if (a) {
    parpadeo = a;
    break;
  }
  await sleep(100);
}
ok(
  "un corte de ~200 ms NO enseña el aviso",
  parpadeo === null,
  JSON.stringify(parpadeo)
);
ok("pero la reconexión sí ocurrió de verdad", hits2 >= 2, `conexiones=${hits2}`);

const thread2 = page2.locator(".thread-bg");
const TRAS_PARPADEO = `tras el parpadeo ${S}`;
await inbound(TRAS_PARPADEO, "3");
await thread2
  .getByText(TRAS_PARPADEO)
  .first()
  .waitFor({ timeout: 25000 })
  .catch(() => {});
ok(
  "y la bandeja quedó al día igualmente",
  (await thread2.getByText(TRAS_PARPADEO).count()) === 1
);

/* ═══════════ Escenario C: sin red (camino infeliz) ═══════════ */

console.log("\n== C: sin red — se avisa, no se martillea, y se recupera ==");

/*
 * Se abre una pestaña nueva a la que el canal de eventos NO llega (todas sus
 * conexiones se abortan como si no hubiera red). No se usa `setOffline` sobre
 * la pestaña anterior porque no cierra un stream que ya está abierto: la
 * conexión seguía entregando latidos y el corte no existía — un verde que no
 * probaba nada. Comprobado al escribir esto.
 */
const page3 = await ctx.newPage();
let sinRed = true;
let intentosSinRed = 0;
await page3.route("**/api/events**", async (route) => {
  if (sinRed) {
    intentosSinRed += 1;
    await route.abort("internetdisconnected");
  } else {
    await route.continue();
  }
});

await page3.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
await page3.getByText(NOMBRE).first().waitFor({ timeout: 30000 });
await page3.getByText(NOMBRE).first().click();
const tC = Date.now();

const avisoSinRed = await esperarAviso(page3, 30_000);
ok(
  "sin red, la bandeja lo dice en vez de fingir que está al día",
  !!avisoSinRed,
  `tras ${Math.round((Date.now() - tC) / 1000)} s`
);
console.log(`     (aviso: ${JSON.stringify(avisoSinRed)})`);
ok(
  "y lo dice como algo transitorio, no como un error del operador",
  /Reconectando|Sin conexión/i.test(avisoSinRed?.texto ?? ""),
  avisoSinRed?.texto
);

const antes = intentosSinRed;
await sleep(12_000);
const enDoceSegundos = intentosSinRed - antes;
ok(
  "no se reintenta en bucle apretado",
  enDoceSegundos <= 12,
  `${enDoceSegundos} intentos en 12 s (2 suscripciones, ~1 cada 3 s cada una)`
);

const OFFLINE = `entro sin red ${S}`;
await inbound(OFFLINE, "4");
await sleep(1500);
const thread3 = page3.locator(".thread-bg");
ok(
  "lo que entra sin red no aparece solo (hay hueco de verdad)",
  (await thread3.getByText(OFFLINE).count()) === 0
);

sinRed = false;
ok(
  "al volver la red, el aviso se retira solo",
  await esperarSinAviso(page3, 60_000)
);
await thread3
  .getByText(OFFLINE)
  .first()
  .waitFor({ timeout: 25000 })
  .catch(() => {});
ok(
  "y lo que entró durante el corte aparece, una sola vez",
  (await thread3.getByText(OFFLINE).count()) === 1,
  `apariciones=${await thread3.getByText(OFFLINE).count()}`
);

await browser.close();

console.log(
  `\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`
);
process.exit(failures > 0 ? 1 : 0);
