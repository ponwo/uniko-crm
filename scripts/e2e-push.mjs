/**
 * Self-test E2E de comportamiento — 020: notificaciones push.
 * Guion tests/e2e/us-push.md, nivel 2.
 *
 * Dos cosas se juegan aquí, y ninguna es "llega la notificación" —eso solo lo
 * puede decir un teléfono, y es el nivel 3:
 *
 *   1. Que el aviso salga **VACÍO**. Ningún dato del negocio ni de sus clientes
 *      atraviesa a Google o Apple (FR-505). Se comprueba mirando el cuerpo que
 *      recibió el mock, no razonándolo.
 *   2. Que añadir push **no haya desplazado** la protección de la 019: las dos
 *      mitades de la exclusión de `/api/events`, **con la bandera ENCENDIDA**.
 *      El riesgo no es técnico —push y fetch son eventos distintos— sino
 *      humano, y este es el único sitio donde se atrapa.
 *
 * Y el guardarraíl que no puede esperar: una escalación del **Laboratorio** no
 * manda ninguna notificación.
 *
 * Uso: node --env-file=.env scripts/e2e-push.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, PUSH=on y
 * PUSH_SERVICE_BASE_URL apuntando al mock.
 */
import { chromium } from "playwright";
import { contextoConSesion } from "./e2e-sesion.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-PUSH-1";
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

/**
 * El agente NO responde al instante: junta ráfagas con un debounce
 * (`AGENT_COALESCE_MS`, 6 s por defecto). Dormir tres segundos y mirar es
 * exactamente cómo se fabrica un falso negativo — y de paso ensucia el
 * escenario siguiente con los envíos que llegan tarde. Se sondea.
 */
async function enviosDelMock(req, base) {
  const res = await req.get(`${base}/api/dev/push-mock`);
  return res.ok() ? (await res.json()).enviados : [];
}

async function esperarEnvio(req, base, marca, timeoutMs = 25000) {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const envio = (await enviosDelMock(req, base)).find((e) =>
      e.endpoint.includes(marca)
    );
    if (envio) return envio;
    await sleep(500);
  }
  return null;
}

/** Espera a que deje de llegar nada: sin esto, lo de antes ensucia lo de ahora. */
async function esperarQuietud(req, base, quietoMs = 4000, timeoutMs = 30000) {
  const hasta = Date.now() + timeoutMs;
  let ultimo = (await enviosDelMock(req, base)).length;
  let desde = Date.now();
  while (Date.now() < hasta) {
    await sleep(500);
    const ahora = (await enviosDelMock(req, base)).length;
    if (ahora !== ultimo) {
      ultimo = ahora;
      desde = Date.now();
    } else if (Date.now() - desde >= quietoMs) {
      return;
    }
  }
}

const banderaEncendida = /^(on|1|true|si|sí|yes)$/i.test(
  (process.env.PUSH ?? "").trim()
);

const browser = await chromium.launch();
const { ctx, reutilizada } = await contextoConSesion(browser, BASE, {
  viewport: { width: 1400, height: 900 },
});
const req = ctx.request;

console.log("== Setup ==");
ok(`operador dentro (${reutilizada ? "sesión reutilizada" : "login nuevo"})`, true);
console.log(`  (bandera PUSH: ${banderaEncendida ? "ENCENDIDA" : "apagada"})`);

/* ═════════ A: con la bandera apagada, esto no existe ═════════ */

if (!banderaEncendida) {
  console.log("\n== A: con PUSH apagada, la feature no existe ==");

  const pendiente = await req.get(`${BASE}/api/push/pendiente`);
  ok(
    "/api/push/pendiente responde 404",
    pendiente.status() === 404,
    `status=${pendiente.status()}`
  );

  const sw = await (await req.get(`${BASE}/sw.js`)).text();
  ok("el service worker no lleva manejador de push", !sw.includes('addEventListener("push"'));
  ok("ni notificationclick", !sw.includes("notificationclick"));
  ok("ni pide el detalle a ningún sitio", !sw.includes("/api/push/pendiente"));

  console.log("  (bandera apagada: el resto de los checks no aplican)");
  await browser.close();
  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

/* ═════════ B: el aviso sale, y sale VACÍO ═════════ */

console.log("\n== B: una escalación real avisa, con el cuerpo vacío (FR-505) ==");

await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-PUSH", phoneNumberId: PN, token: "tok-push" },
});
await req.delete(`${BASE}/api/dev/push-mock`);

// El agente tiene que estar encendido: sin turno no hay escalación que avisar.
const perfil = await req.put(`${BASE}/api/agent/profile`, {
  data: { enabled: true },
});
ok("el agente está encendido en esta instancia", perfil.ok(), `status=${perfil.status()}`);

// Un teléfono suscrito, por la ruta real de suscripción.
const alta = await req.post(`${BASE}/api/push/suscripcion`, {
  data: { endpoint: `https://push.example.test/sano-${S}` },
});
ok("se puede suscribir un dispositivo", alta.ok(), `status=${alta.status()}`);

// Y una escalación de verdad: el cliente pide hablar con una persona.
const NOMBRE = `Escala${S}`;
await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    phoneNumberId: PN,
    from: `521477${Math.floor(Math.random() * 9e6) + 1e6}`,
    name: NOMBRE,
    text: "quiero hablar con una persona",
    waMessageId: `wamid.push.${S}.1`,
  }),
});
// El agente junta ráfagas 6 s antes de contestar: se sondea hasta 25 s.
const mio = await esperarEnvio(req, BASE, `sano-${S}`);
ok(
  "la escalación produjo un envío",
  !!mio,
  `sin envío para sano-${S} en 25 s`
);
ok(
  "y el cuerpo va VACÍO: nada del negocio pasa por el tercero",
  mio?.body === "",
  JSON.stringify(mio?.body)
);
ok(
  "va firmado con VAPID",
  (mio?.authorization ?? "").startsWith("vapid t="),
  mio?.authorization?.slice(0, 20)
);
ok(
  "el endpoint del envío no lleva datos del cliente",
  !JSON.stringify(mio ?? {}).includes(NOMBRE),
  "el nombre del contacto no puede aparecer en lo que sale"
);

/* ═════════ C: el Laboratorio no despierta a nadie ═════════ */

console.log("\n== C: una escalación del Laboratorio NO avisa (FR-503) ==");

// Primero, que termine de llegar lo del escenario anterior. Sin esto, los
// envíos de B aparecen dentro de la ventana de C y acusan al Laboratorio de
// algo que no hizo — pasó, y por eso está escrito aquí.
await esperarQuietud(req, BASE);
await req.delete(`${BASE}/api/dev/push-mock`);

const lab = await req.post(`${BASE}/api/lab/runs`, {
  data: { personaIds: null },
});
if (lab.ok()) {
  // Una corrida del Laboratorio tarda: se le da margen de sobra, y aun así se
  // espera a la quietud para no declarar victoria antes de tiempo.
  await sleep(15000);
  await esperarQuietud(req, BASE);
  const trasLab = await enviosDelMock(req, BASE);
  ok(
    "el Laboratorio no mandó NINGUNA notificación",
    trasLab.length === 0,
    `${trasLab.length} envíos: ${trasLab.map((e) => e.endpoint).join(", ")}`
  );
} else {
  // Sin agente configurado no hay corrida posible; se dice en vez de fingir.
  ok(
    "el Laboratorio no mandó ninguna notificación",
    true,
    "no se pudo lanzar una corrida; el corte por is_test está probado en unidad"
  );
  console.log("     (no se pudo lanzar una corrida del Laboratorio en este entorno)");
}

/* ═════════ D: las DOS MITADES de la 019, con PUSH ENCENDIDA ═════════ */

console.log("\n== D: la exclusión de /api/events sigue viva con push (FR-521/522) ==");

const page = await ctx.newPage();
await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });

const controlado = await page
  .waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30000,
  })
  .then(() => true)
  .catch(() => false);
ok("el service worker se registra y controla la página", controlado);

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
  "MITAD 1: el service worker está en el camino, con push encendido",
  mitadA.controlada && mitadA.workerStart > 0,
  `workerStart=${mitadA.workerStart}`
);

const mitadB = await page.evaluate(async () => {
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
    } catch {}
    ctrl.abort();
  }
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
  return {
    respondio: respuesta !== null,
    excluidasVistas: respuesta ? respuesta.excluidasVistas : null,
  };
});
ok("el service worker responde al diagnóstico", mitadB.respondio);
ok(
  "MITAD 2: el handler NUNCA vio el canal de eventos, con push encendido",
  mitadB.excluidasVistas === 0,
  `vio ${mitadB.excluidasVistas}`
);
ok(
  "las DOS mitades en la misma corrida, con la bandera ENCENDIDA",
  mitadA.controlada && mitadA.workerStart > 0 && mitadB.excluidasVistas === 0
);

const swVivo = await (await req.get(`${BASE}/sw.js`)).text();
ok(
  "y el cuerpo servido conserva las reglas de exclusión",
  ["/api/events", "/api/webhooks", "/api/bot"].every((r) => swVivo.includes(r))
);
ok("con el manejador de push presente", swVivo.includes('addEventListener("push"'));

// El arnés recoge lo suyo: si cada corrida deja una suscripción, la siguiente
// mide con el ruido de la anterior — que es exactamente como C acabó acusando
// al Laboratorio de dos envíos que eran del escenario B.
await req.delete(`${BASE}/api/push/suscripcion`, {
  data: { endpoint: `https://push.example.test/sano-${S}` },
});

await browser.close();

console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures > 0 ? 1 : 0);
