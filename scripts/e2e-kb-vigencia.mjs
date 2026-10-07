/**
 * Self-test E2E de comportamiento — 033: conocimiento temporal.
 * Guion tests/e2e/us-kb-vigencia.md · spec specs/033-conocimiento-temporal.
 *
 * Qué se juega aquí, contra la app viva y los simuladores:
 *
 *   1. La API: alta con y sin «vigente hasta», los tres estados calculados por
 *      el servidor, el 422 de una fecha basura (nunca un 500), el contador que
 *      no cuenta lo vencido y el cerebro externo que no lo recibe.
 *   2. El agente: lo vencido NO se afirma, lo vigente sí, y el corte se evalúa
 *      en cada turno (la misma conversación deja de saberlo cuando vence, y lo
 *      vuelve a saber cuando se renueva). El ai-mock contesta SEGÚN EL
 *      CONOCIMIENTO QUE RECIBIÓ (`KBTOK-…`): sin eso esta prueba pasaría siempre.
 *   3. El reloj: el prompt lleva la fecha y la regla del historial.
 *   4. El Laboratorio: ni el generador ni el juez reciben lo vencido.
 *   5. La pantalla: aviso de por vencer, «Conocimiento obsoleto», renovar,
 *      poner fecha y editar el texto sin tocar la fecha.
 *
 * Cada corrida usa tokens y un lead propios (RUN) y borra sus entradas al
 * final, así que no deja nada que cambie lo que miden los otros arneses.
 *
 * Uso: node --env-file=.env scripts/e2e-kb-vigencia.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 * OPENROUTER_BASE_URL → ai-mock y BOT_API_KEY configurada.
 */
import { chromium } from "playwright";
import { contextoConSesion } from "./e2e-sesion.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const PN = "PN-E2E-1";
const coalesce = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const ventana = coalesce + 8000;
const RUN = Date.now().toString(36).toUpperCase();
const LEAD = `5214627033${String(Date.now()).slice(-3)}`;
const tok = (letra) => `KBTOK-${letra}${RUN}`;

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

/** Aritmética de calendario sobre AAAA-MM-DD, como `addDaysISO` del producto. */
const sumarDias = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const browser = await chromium.launch();
const { ctx, reutilizada } = await contextoConSesion(browser, BASE);
const req = ctx.request;
console.log(`Sesión ${reutilizada ? "reutilizada" : "nueva"}. RUN=${RUN} lead=${LEAD}`);

const api = async (path, init = {}) => {
  const res = await req.fetch(`${BASE}${path}`, {
    ...init,
    headers: { origin: BASE, ...(init.headers ?? {}) },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // respuestas sin cuerpo
  }
  return { status: res.status(), ok: res.ok(), json };
};
const alta = (data) => api("/api/kb", { method: "POST", data });
const editar = (id, data) => api(`/api/kb/${id}`, { method: "PATCH", data });
const listar = async () => (await api("/api/kb")).json ?? { entries: [], hoy: null };
const tamano = async () => (await api("/api/kb/size")).json?.chars ?? -1;
const ultimoPrompt = async () =>
  (await (await fetch(`${BASE}/api/dev/ai-mock/_state`)).json()).lastPrompt ?? "";

const alCable = (lead) => (lead.startsWith("521") ? `52${lead.slice(3)}` : lead);
const outboxDe = async (to) =>
  ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter(
    (o) => o.to === to || o.to === alCable(to)
  );

let turno = 0;
/** Un inbound del lead y la PRIMERA respuesta del agente (o null si no llegó a tiempo). */
async function preguntar(texto) {
  turno += 1;
  const antes = (await outboxDe(LEAD)).length;
  const t0 = Date.now();
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    data: {
      phoneNumberId: PN,
      from: LEAD,
      name: `Lead vigencia ${RUN}`,
      text: texto,
      waMessageId: `wamid.e2e.033.${RUN}.${turno}`,
    },
  });
  const hasta = Date.now() + ventana;
  while (Date.now() < hasta) {
    const salientes = await outboxDe(LEAD);
    if (salientes.length > antes) {
      return { text: salientes[antes]?.body?.text?.body ?? null, ms: Date.now() - t0 };
    }
    await sleep(300);
  }
  return { text: null, ms: Date.now() - t0 };
}

async function esperarCorrida(runId, timeoutMs = 180000) {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const r = await api(`/api/lab/runs/${runId}`);
    if (r.json?.run?.status && r.json.run.status !== "running") return r.json;
    await sleep(1000);
  }
  return null;
}

// ── Preparación ──────────────────────────────────────────────────────────────
console.log("\n== Preparación ==");
const conn = await api("/api/settings/whatsapp", {
  method: "PUT",
  data: { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" },
});
ok("conexión WhatsApp (wa-mock) lista", conn.ok, JSON.stringify(conn.json));
const perfilAntes = (await api("/api/agent/profile")).json?.profile ?? null;
const encender = await api("/api/agent/profile", { method: "PUT", data: { enabled: true } });
ok("agente encendido para la prueba", encender.ok, JSON.stringify(encender.json));

const { hoy } = await listar();
ok("GET /api/kb trae el «hoy» del servidor (zona del negocio)", /^\d{4}-\d{2}-\d{2}$/.test(hoy ?? ""), String(hoy));
const AYER = sumarDias(hoy, -1);
const EN_5 = sumarDias(hoy, 5);
const EN_60 = sumarDias(hoy, 60);
const creadas = [];

// ── 1. La API ────────────────────────────────────────────────────────────────
console.log("\n== 1. Alta, estados y validación ==");
const P = await alta({ kind: "qa", question: `¿Horario? ${tok("P")}`, answer: `De 9 a 18 h. ${tok("P")}` });
creadas.push(P.json?.entry?.id);
ok(
  "sin fecha → 201, permanente y vigente",
  P.status === 201 && P.json?.entry?.validUntil === null && P.json?.entry?.estado === "vigente",
  JSON.stringify(P.json)
);
const V = await alta({ kind: "qa", question: `¿Taller? ${tok("V")}`, answer: `Hasta dentro de dos meses. ${tok("V")}`, validUntil: EN_60 });
creadas.push(V.json?.entry?.id);
ok("con fecha lejana → vigente", V.json?.entry?.estado === "vigente" && V.json?.entry?.validUntil === EN_60, JSON.stringify(V.json));
const S = await alta({ kind: "qa", question: `¿Promo? ${tok("S")}`, answer: `El 2x1 ${tok("S")} sigue unos días.`, validUntil: EN_5 });
creadas.push(S.json?.entry?.id);
ok("a 5 días → por vencer (sigue activa)", S.json?.entry?.estado === "por_vencer", JSON.stringify(S.json));
const H = await alta({ kind: "block", content: `Inscripciones abiertas hasta hoy ${tok("H")}`, validUntil: hoy });
creadas.push(H.json?.entry?.id);
ok("con fecha = hoy → por vencer, NO vencida (vale todo hoy)", H.json?.entry?.estado === "por_vencer", JSON.stringify(H.json));

const tamanoAntes = await tamano();
const X = await alta({ kind: "qa", question: `¿Promo vieja? ${tok("X")}`, answer: `El 3x2 ${tok("X")} ya terminó.`, validUntil: AYER });
creadas.push(X.json?.entry?.id);
ok("con fecha de ayer → se acepta y nace vencida", X.status === 201 && X.json?.entry?.estado === "vencida", JSON.stringify(X.json));
const Z = await alta({ kind: "block", content: `Curso de verano ${tok("Z")}: inscripciones cerradas.`, validUntil: AYER });
creadas.push(Z.json?.entry?.id);
ok("el contador NO cuenta lo vencido", (await tamano()) === tamanoAntes, `${tamanoAntes} → ${await tamano()}`);

const basura = await alta({ kind: "qa", question: "¿Fecha basura?", answer: "x", validUntil: "el martes" });
ok(
  "«el martes» → 422 que dice qué formato se esperaba",
  basura.status === 422 && /AAAA-MM-DD/.test(basura.json?.error?.message ?? ""),
  `${basura.status} ${JSON.stringify(basura.json)}`
);
const imposible = await alta({ kind: "qa", question: "¿Fecha imposible?", answer: "x", validUntil: "2026-02-31" });
ok(
  "«2026-02-31» → 422 (no un 500) que dice que la fecha no existe",
  imposible.status === 422 && /no existe/.test(imposible.json?.error?.message ?? ""),
  `${imposible.status} ${JSON.stringify(imposible.json)}`
);

const lista = (await listar()).entries ?? [];
const estadoDe = (id) => lista.find((e) => e.id === id)?.estado;
ok(
  "GET /api/kb trae TODO, también lo vencido, cada una con su estado",
  estadoDe(P.json?.entry?.id) === "vigente" &&
    estadoDe(S.json?.entry?.id) === "por_vencer" &&
    estadoDe(X.json?.entry?.id) === "vencida" &&
    estadoDe(Z.json?.entry?.id) === "vencida",
  JSON.stringify(lista.filter((e) => creadas.includes(e.id)).map((e) => [e.validUntil, e.estado]))
);

console.log("\n== 1b. El cerebro externo ==");
const perfilBot = await api("/api/bot/profile", { headers: { "x-api-key": BOT_KEY } });
const kbBot = perfilBot.json?.kb ?? "";
ok(
  "/api/bot/profile trae lo vigente y NO lo vencido",
  perfilBot.ok &&
    kbBot.includes(tok("P")) &&
    kbBot.includes(tok("S")) &&
    kbBot.includes(tok("H")) &&
    !kbBot.includes(tok("X")) &&
    !kbBot.includes(tok("Z")),
  `status ${perfilBot.status}`
);
ok("y no le manda la fecha (no tiene que reimplementar el filtro)", !JSON.stringify(perfilBot.json ?? {}).includes("validUntil"));

// ── 2. El agente ─────────────────────────────────────────────────────────────
console.log("\n== 2. El agente: lo vencido no se afirma ==");
const r1 = await preguntar(`¿sigue la promo ${tok("X")}?`);
ok(
  "pregunta por lo vencido → NO lo afirma (camino de «lo confirmo»)",
  r1.text?.startsWith(`NO_CONOZCO ${tok("X")}`),
  JSON.stringify(r1)
);
const r2 = await preguntar(`¿cuándo es el taller ${tok("V")}?`);
ok("pregunta por lo vigente → lo usa", r2.text === `SI_CONOZCO ${tok("V")}`, JSON.stringify(r2));
const r3 = await preguntar(`¿siguen abiertas las inscripciones ${tok("H")}?`);
ok("lo que vence HOY todavía lo usa", r3.text === `SI_CONOZCO ${tok("H")}`, JSON.stringify(r3));

const promptAgente = await ultimoPrompt();
ok("el prompt del agente lleva la fecha del negocio (AHORA ES)", /AHORA ES: \S+, \d{1,2} de \S+ de \d{4}, \d{2}:\d{2}/.test(promptAgente));
ok(
  "y la regla del historial: lo dicho antes no se repite como vigente",
  promptAgente.includes("NUNCA lo repitas como vigente solo porque está en el historial")
);
// Solo la sección del conocimiento: el token SÍ aparece en el historial (el
// cliente lo preguntó y el agente contestó que no lo sabe), y eso es correcto.
const kbDelPrompt =
  promptAgente.split("CONOCIMIENTO DEL NEGOCIO")[1]?.split("Etapas del pipeline")[0] ?? "";
ok(
  "el conocimiento vencido no viaja en el prompt (sección del conocimiento)",
  kbDelPrompt.includes(tok("P")) && !kbDelPrompt.includes(tok("X")) && !kbDelPrompt.includes(tok("Z")),
  kbDelPrompt.slice(0, 200)
);

console.log("\n== 2b. Renovar, quitar la fecha, editar sin tocar la fecha ==");
const renovada = await editar(X.json?.entry?.id, { validUntil: EN_60 });
ok(
  "PATCH con fecha futura renueva sin tocar el texto",
  renovada.ok &&
    renovada.json?.entry?.estado === "vigente" &&
    renovada.json?.entry?.answer === X.json?.entry?.answer,
  JSON.stringify(renovada.json)
);
const r4 = await preguntar(`¿y ahora sigue la promo ${tok("X")}?`);
ok("en el siguiente turno el agente vuelve a usarla", r4.text === `SI_CONOZCO ${tok("X")}`, JSON.stringify(r4));
const permanente = await editar(X.json?.entry?.id, { validUntil: null });
ok(
  "PATCH con null la vuelve permanente",
  permanente.json?.entry?.validUntil === null && permanente.json?.entry?.estado === "vigente",
  JSON.stringify(permanente.json)
);
const soloTexto = await editar(S.json?.entry?.id, { answer: `El 2x1 ${tok("S")} sigue hasta fin de mes.` });
ok(
  "editar solo el texto NO toca la fecha",
  soloTexto.json?.entry?.validUntil === EN_5 && soloTexto.json?.entry?.answer.includes("fin de mes"),
  JSON.stringify(soloTexto.json)
);
const vencerV = await editar(V.json?.entry?.id, { validUntil: AYER });
ok("vencer a mano lo vigente (fecha pasada)", vencerV.json?.entry?.estado === "vencida", JSON.stringify(vencerV.json));
const r5 = await preguntar(`¿el taller ${tok("V")} sigue?`);
ok(
  "la MISMA conversación deja de saberlo en el turno siguiente (el corte es por turno)",
  r5.text?.startsWith(`NO_CONOZCO ${tok("V")}`),
  JSON.stringify(r5)
);
const basuraPatch = await editar(P.json?.entry?.id, { validUntil: "2026-13-01" });
ok("PATCH con fecha imposible → 422", basuraPatch.status === 422, `${basuraPatch.status}`);

// ── 3. El Laboratorio ───────────────────────────────────────────────────────
console.log("\n== 3. El Laboratorio no ve lo vencido ==");
const gen = await api("/api/lab/scenarios/generate", { method: "POST" });
const promptGenerador = await ultimoPrompt();
ok(
  "generar escenarios: el generador recibe lo vigente y no lo vencido",
  gen.ok &&
    promptGenerador.includes("CONOCIMIENTO CONFIGURADO") &&
    promptGenerador.includes(tok("P")) &&
    !promptGenerador.includes(tok("Z")) &&
    !promptGenerador.includes(tok("V")),
  `status ${gen.status}`
);
const corrida = await api("/api/lab/runs", { method: "POST" });
ok("arranca una corrida", corrida.status === 202, `status ${corrida.status} ${JSON.stringify(corrida.json)}`);
const reporte = corrida.json?.runId ? await esperarCorrida(corrida.json.runId) : null;
ok("la corrida termina", reporte?.run?.status === "done", reporte?.run?.status ?? "sin reporte");
const promptJuez = await ultimoPrompt();
ok(
  "el juez recibe el mismo conocimiento vigente: con lo permanente, sin lo vencido",
  promptJuez.includes("CONOCIMIENTO CONFIGURADO") &&
    promptJuez.includes(tok("P")) &&
    !promptJuez.includes(tok("Z")) &&
    !promptJuez.includes(tok("V")),
  promptJuez.slice(0, 120)
);

// ── 4. La pantalla ──────────────────────────────────────────────────────────
console.log("\n== 4. La pantalla del dueño ==");
const page = await ctx.newPage();
await page.goto(`${BASE}/agent`);
const fila = (t) => page.getByTestId("kb-entrada").filter({ hasText: t });
const obsoletas = page.getByTestId("kb-obsoletas");
try {
  await obsoletas.waitFor({ timeout: 30000 });
} catch {
  // el check de abajo lo reporta
}
ok("aparece la sección «Conocimiento obsoleto»", await obsoletas.isVisible());
ok(
  "con lo vencido dentro, su texto completo y la marca",
  (await obsoletas.getByTestId("kb-entrada").filter({ hasText: tok("Z") }).count()) === 1 &&
    (await obsoletas.getByTestId("kb-entrada").filter({ hasText: tok("Z") }).innerText()).includes("Ya venció")
);
ok("y lo vigente NO está ahí", (await obsoletas.getByTestId("kb-entrada").filter({ hasText: tok("P") }).count()) === 0);
const avisoPorVencer = page.getByTestId("kb-por-vencer");
ok(
  "aviso de cuántas vencen pronto",
  (await avisoPorVencer.count()) === 1 && /vence|vencen/.test(await avisoPorVencer.innerText())
);
ok("la que vence pronto lleva su marca y sigue en la lista vigente", (await page.getByTestId("kb-vigentes").getByTestId("kb-entrada").filter({ hasText: tok("S") }).innerText()).includes("Vence pronto"));

// Renovar desde la pantalla: «Hacer permanente» la saca de obsoletos.
await fila(tok("Z")).getByRole("button", { name: "Hacer permanente" }).click();
await page.getByTestId("kb-vigentes").getByTestId("kb-entrada").filter({ hasText: tok("Z") }).waitFor({ timeout: 15000 }).catch(() => {});
ok(
  "«Hacer permanente» la devuelve a lo vigente",
  (await page.getByTestId("kb-vigentes").getByTestId("kb-entrada").filter({ hasText: tok("Z") }).count()) === 1,
  JSON.stringify((await listar()).entries.find((e) => e.id === Z.json?.entry?.id))
);

// Poner fecha desde la pantalla: una fecha pasada la manda a obsoletos.
await fila(tok("P")).getByRole("button", { name: "Poner fecha" }).click();
await fila(tok("P")).getByLabel("Vigente hasta").fill(AYER);
await fila(tok("P")).getByRole("button", { name: "Guardar fecha" }).click();
await obsoletas.getByTestId("kb-entrada").filter({ hasText: tok("P") }).waitFor({ timeout: 15000 }).catch(() => {});
ok(
  "«Poner fecha» con una fecha pasada la manda a obsoletos",
  (await page.getByTestId("kb-obsoletas").getByTestId("kb-entrada").filter({ hasText: tok("P") }).count()) === 1
);

// Editar el texto desde la pantalla: la fecha no cambia.
await fila(tok("S")).getByRole("button", { name: "Editar entrada" }).click();
await fila(tok("S")).getByLabel("Respuesta").fill(`Promo ${tok("S")} corregida desde la pantalla.`);
await fila(tok("S")).getByRole("button", { name: "Guardar", exact: true }).click();
// Se espera al SERVIDOR, no a la pantalla: el área de edición ya enseña el texto
// nuevo antes de guardarlo, así que esperar a verlo leía la base antes del PATCH.
let sTrasEditar;
for (let i = 0; i < 40; i++) {
  sTrasEditar = (await listar()).entries.find((e) => e.id === S.json?.entry?.id);
  if (sTrasEditar?.answer?.includes("corregida desde la pantalla")) break;
  await sleep(250);
}
ok(
  "editar el texto desde la pantalla conserva la fecha",
  sTrasEditar?.answer?.includes("corregida desde la pantalla") && sTrasEditar?.validUntil === EN_5,
  JSON.stringify(sTrasEditar)
);

// Alta con fecha desde la pantalla.
await page.getByPlaceholder("Pregunta (p. ej. ¿Hacen envíos?)").fill(`¿Alta con fecha? ${tok("U")}`);
await page.getByPlaceholder("Respuesta").first().fill(`Sí, ${tok("U")}`);
await page.locator("#kb-qa-hasta").fill(EN_60);
await page.getByRole("button", { name: "Agregar P/R" }).click();
await fila(tok("U")).waitFor({ timeout: 15000 }).catch(() => {});
const u = (await listar()).entries.find((e) => (e.question ?? "").includes(tok("U")));
if (u) creadas.push(u.id);
ok("el alta desde la pantalla guarda la fecha elegida", u?.validUntil === EN_60 && u?.estado === "vigente", JSON.stringify(u));

await page.close();

// ── Limpieza ────────────────────────────────────────────────────────────────
for (const id of creadas.filter(Boolean)) await api(`/api/kb/${id}`, { method: "DELETE" });
const quedan = (await listar()).entries.filter((e) => JSON.stringify(e).includes(RUN));
ok("limpieza: no quedan entradas de esta corrida", quedan.length === 0, `${quedan.length} quedan`);
if (perfilAntes && perfilAntes.enabled === false) {
  await api("/api/agent/profile", { method: "PUT", data: { enabled: false } });
}

await browser.close();
console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures > 0 ? 1 : 0);
