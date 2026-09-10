/**
 * Self-test E2E de comportamiento — 021: el Laboratorio sigue al negocio.
 * Guion tests/e2e/us4-lab.md.
 *
 * Por qué existe: hasta la 021 el Laboratorio **no estaba en el arnés
 * automático** (hallazgo 5 de specs/021-laboratorio-del-negocio/research.md).
 * Su guion era manual, y lo único que lo ejercitaba solo era el escenario C
 * del arnés de push, de refilón. La 021 cambia justo lo que nadie cubría —los
 * seis guiones—, así que verificarlo a mano una vez y seguir es cómo se acaba
 * delegando la prueba, que es lo que la Definición de Hecho prohíbe.
 *
 * Qué se juega aquí:
 *
 *   1. Que ningún cliente simulado hable de un giro concreto. Se mira el
 *      TRANSCRIPT de lo que de verdad se dijo, no la constante del módulo —eso
 *      ya lo afirma tests/unit/lab-personas.test.ts. Aquí importa lo que llegó
 *      al agente.
 *   2. Que el sandbox aguante: el outbox del wa-mock NO crece durante una
 *      corrida. Es un guardarraíl constitucional, no un detalle.
 *   3. Que el loop de la sugerencia cierre: 83 → aplicar → 100, delta +17.
 *
 * Uso: node --env-file=.env scripts/e2e-lab.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true y OPENROUTER_BASE_URL
 * apuntando al ai-mock.
 */
import { chromium } from "playwright";
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

/**
 * Términos de giro. Misma lista deliberadamente tonta que el test de unidad, y
 * a propósito: si las dos divergen, una de las dos deja de proteger sin avisar.
 */
const TERMINOS_DE_GIRO = [
  "taladro", "martillo", "desarmador", "clavo", "lijadora", "pintura",
  "tiner", "thinner", "barniz", "broca", "cemento", "herramienta",
  "tornillo", "pinza", "ferreter", "tlapaler",
  "pizza", "hamburguesa", "platillo", "restaurante", "menú",
  "corte de pelo", "manicure", "masaje",
  "consulta médica", "receta", "medicamento",
  "habitación", "hotel", "vuelo",
];

const browser = await chromium.launch();
const { ctx, reutilizada } = await contextoConSesion(browser, BASE);
const req = ctx.request;
console.log(`Sesión ${reutilizada ? "reutilizada" : "nueva"}.`);

const api = async (path, init) => {
  const res = await req.fetch(`${BASE}${path}`, {
    ...init,
    headers: { origin: BASE, ...(init?.headers ?? {}) },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // respuestas sin cuerpo
  }
  return { status: res.status(), ok: res.ok(), json };
};

const outboxLen = async () =>
  ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;

/**
 * Espera a que una corrida termine. Contra el ai-mock son ~22 turnos del
 * agente y 6 del juez, todos locales, así que esto tarda segundos — el margen
 * ancho es para no volverse escamoso en una máquina cargada.
 */
async function esperarCorrida(runId, timeoutMs = 120000) {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    const r = await api(`/api/lab/runs/${runId}`);
    if (r.json?.run?.status && r.json.run.status !== "running") return r.json;
    await sleep(1000);
  }
  return null;
}

// ── Preparación ──────────────────────────────────────────────────────────
//
// El conocimiento NO debe cubrir cancelaciones/reembolsos: ese es el hueco
// intencional que hace que `fuera_de_kb` salga en rojo en la primera corrida.
// Una corrida anterior de este mismo arnés deja aplicada la sugerencia, así
// que hay que retirarla o la segunda tanda mediría otra cosa.
console.log("\n== Preparación ==");
const kbPrevio = (await api("/api/kb")).json?.entries ?? [];
let retiradas = 0;
for (const e of kbPrevio) {
  const texto = `${e.question ?? ""} ${e.answer ?? ""} ${e.content ?? ""}`;
  if (/cancelac|reembols/i.test(texto)) {
    await api(`/api/kb/${e.id}`, { method: "DELETE" });
    retiradas++;
  }
}
console.log(`  Entradas de cancelaciones/reembolsos retiradas: ${retiradas}`);

// Algo de conocimiento tiene que haber, y que NO hable de cancelaciones.
const kbAhora = (await api("/api/kb")).json?.entries ?? [];
if (kbAhora.length === 0) {
  await api("/api/kb", {
    method: "POST",
    data: {
      kind: "qa",
      question: "¿Cuál es su horario de atención?",
      answer: "Atendemos de lunes a viernes de 9 a 18 h, y sábados de 10 a 14 h.",
    },
  });
  console.log("  Conocimiento mínimo sembrado (horario).");
}

const outboxAntes = await outboxLen();
console.log(`  Outbox del wa-mock antes: ${outboxAntes}`);

// ── Corrida 1 ────────────────────────────────────────────────────────────
console.log("\n== Corrida 1: el hueco aparece ==");
const inicio = await api("/api/lab/runs", { method: "POST" });
if (inicio.status === 409 && inicio.json?.error?.code === "ai_not_configured") {
  console.log(
    "\n  El proveedor de IA no está configurado. Este arnés necesita\n" +
      "  OPENROUTER_BASE_URL apuntando al ai-mock y un token cualquiera."
  );
  await browser.close();
  process.exit(1);
}
ok("POST /api/lab/runs arranca la corrida (202)", inicio.status === 202, `status ${inicio.status}`);

const reporte1 = await esperarCorrida(inicio.json?.runId);
ok("la corrida termina", reporte1?.run?.status === "done", reporte1?.run?.status ?? "sin reporte");
ok(
  "score 83 — cinco verdes y un rojo sobre seis",
  reporte1?.run?.score === 83,
  `score ${reporte1?.run?.score}`
);

const casos1 = reporte1?.cases ?? [];
ok("se evaluaron los seis casos", casos1.length === 6, `${casos1.length} casos`);

// 1. Ningún cliente simulado nombró un giro — sobre lo que DE VERDAD se dijo.
const dichoPorClientes = casos1
  .flatMap((c) => (c.transcript ?? []).filter((t) => t.role === "cliente"))
  .map((t) => t.text)
  .join("\n")
  .toLowerCase();
const giroEncontrado = TERMINOS_DE_GIRO.filter((t) => dichoPorClientes.includes(t));
ok(
  "ningún cliente simulado nombró un producto o sector concreto (FR-601)",
  giroEncontrado.length === 0,
  giroEncontrado.join(", ")
);

// 2. El hallazgo cae donde toca, con su sugerencia.
const fueraDeKb = casos1.find((c) => c.persona === "fuera_de_kb");
ok("la persona fuera_de_kb salió en rojo", fueraDeKb?.veredicto === "rojo", fueraDeKb?.veredicto);
const hallazgo = fueraDeKb?.hallazgos?.[0];
ok("con hallazgo de tipo fuera_de_kb", hallazgo?.tipo === "fuera_de_kb", hallazgo?.tipo);
ok(
  "y una sugerencia aplicable al conocimiento",
  Boolean(hallazgo?.sugerencia?.pregunta && hallazgo?.sugerencia?.respuesta)
);
ok(
  "las otras cinco en verde",
  casos1.filter((c) => c.persona !== "fuera_de_kb").every((c) => c.veredicto === "verde")
);

// 3. pide_humano escaló: el guion se cortó antes de terminar.
const pideHumano = casos1.find((c) => c.persona === "pide_humano");
const lineasCliente = (pideHumano?.transcript ?? []).filter((t) => t.role === "cliente").length;
ok(
  "pide_humano acabó en handoff — el guion se cortó (4 líneas, se dijeron menos)",
  lineasCliente > 0 && lineasCliente < 4,
  `${lineasCliente} líneas de cliente`
);

/**
 * 021, Entrega 2 (FR-610..FR-613) — y NO se le castiga por haberlo hecho.
 *
 * Este es el check que protege el arreglo. En la corrida real de LanCo del
 * 2026-09-10, `pide_humano` salió `debio_escalar` **por escalar bien**: el
 * juez solo veía el transcript, y ahí el escalado es invisible porque no deja
 * mensaje. Si el hecho deja de viajar al juez, el mock devuelve rojo aquí y
 * el score se va de 83 a 67.
 */
ok(
  "y el juez NO lo castiga: pide_humano sale verde y sin hallazgos",
  pideHumano?.veredicto === "verde" && (pideHumano?.hallazgos ?? []).length === 0,
  `${pideHumano?.veredicto} con ${(pideHumano?.hallazgos ?? []).length} hallazgo(s)`
);

// 4. El sandbox: nada salió a WhatsApp.
const outboxTrasCorrida = await outboxLen();
ok(
  "el outbox del wa-mock NO creció: el sandbox aguanta",
  outboxTrasCorrida === outboxAntes,
  `${outboxAntes} → ${outboxTrasCorrida}`
);

// 5. Las conversaciones de prueba no asoman por la bandeja.
const convs = (await api("/api/conversations")).json?.conversations ?? [];
ok(
  "las conversaciones del Laboratorio no aparecen en la bandeja",
  !convs.some((c) => (c.contact?.name ?? "").startsWith("[Prueba]")),
  convs.map((c) => c.contact?.name).join(", ")
);

// ── Cerrar el loop ───────────────────────────────────────────────────────
console.log("\n== Cerrar el loop: aplicar la sugerencia y volver a correr ==");
const aplicada = await api("/api/lab/suggestions/apply", {
  method: "POST",
  data: {
    caseId: fueraDeKb?.id,
    hallazgoIndex: 0,
    pregunta: hallazgo?.sugerencia?.pregunta,
    respuesta: hallazgo?.sugerencia?.respuesta,
  },
});
ok("la sugerencia se guarda en el conocimiento", aplicada.status === 201, `status ${aplicada.status}`);

const inicio2 = await api("/api/lab/runs", { method: "POST" });
ok("segunda corrida arrancada", inicio2.status === 202, `status ${inicio2.status}`);

// Con una corrida EN CURSO, la siguiente rebota.
const solapada = await api("/api/lab/runs", { method: "POST" });
ok(
  "con una corrida en curso, otra devuelve 409 run_in_progress",
  solapada.status === 409 && solapada.json?.error?.code === "run_in_progress",
  `status ${solapada.status} ${solapada.json?.error?.code ?? ""}`
);

const reporte2 = await esperarCorrida(inicio2.json?.runId);
ok("la segunda corrida termina", reporte2?.run?.status === "done", reporte2?.run?.status ?? "sin reporte");
ok(
  "score 100 — el hueco quedó tapado",
  reporte2?.run?.score === 100,
  `score ${reporte2?.run?.score}`
);

const historial = (await api("/api/lab/runs")).json?.runs ?? [];
ok(
  "el historial muestra la mejora con delta +17",
  historial[0]?.delta === 17,
  `delta ${historial[0]?.delta}`
);

const outboxFinal = await outboxLen();
ok(
  "y tras dos corridas completas el outbox sigue intacto",
  outboxFinal === outboxAntes,
  `${outboxAntes} → ${outboxFinal}`
);

await browser.close();

console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures > 0 ? 1 : 0);
