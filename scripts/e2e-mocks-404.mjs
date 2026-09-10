/**
 * Self-test E2E — 024: `/api/dev/*` responde 404 con independencia del método.
 * Guion tests/e2e/us-mocks-404.md.
 *
 * `mockGuard()` corre dentro de cada handler, pero Next resuelve el método
 * antes: a un método que la ruta no exporta responde 405 sin pasar por la
 * guardia, y en producción esa diferencia confirma qué rutas de mock existen.
 * Este guion es la medida que lo descubrió, convertida en gate: recorre TODAS
 * las rutas de `src/app/api/dev/` (las deriva del árbol, para que una ruta
 * nueva entre sola), más una que no existe, con los siete métodos, y exige
 * 404 en cada una.
 *
 * Dos modos, porque un guion que solo sabe exigir 404 daría verde contra una
 * app caída:
 *
 *   --expect=404   (por defecto) producción: TODO 404. Es lo que se corre
 *                  contra `next build && next start` y contra las instancias
 *                  de la flota antes de promover.
 *   --expect=open  desarrollo con WA_MOCK_ENABLED=true: al menos una ruta
 *                  responde distinto de 404 — prueba de que el perímetro deja
 *                  pasar donde debe y de que el guion sí distingue.
 *
 * Uso:
 *   node --env-file=.env scripts/e2e-mocks-404.mjs [--expect=404|open] [--base=URL]
 *   node scripts/e2e-mocks-404.mjs --base=https://uniko.lanco.cloud
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.base ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const EXPECT = args.expect ?? "404";
if (EXPECT !== "404" && EXPECT !== "open") {
  console.error(`--expect debe ser 404 u open, no "${EXPECT}"`);
  process.exit(1);
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

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

/** Rutas publicadas bajo src/app/api/dev, como URL. `[id]` → `x`, `[...p]` → `x/y`. */
function rutasDev() {
  const root = resolve(process.cwd(), "src/app/api/dev");
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const rel = relative(root, dir)
          .replaceAll("\\", "/")
          .replace(/\[\.\.\.[^\]]+\]/g, "x/y")
          .replace(/\[[^\]]+\]/g, "x");
        out.push(`/api/dev/${rel}`);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

async function status(method, path) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    // Solo interesa el estado, que llega con las cabeceras. NO se lee el
    // cuerpo: `/api/dev/sse-mudo` es un stream que por diseño no termina
    // nunca, y esperarlo colgaría el guion en la primera pasada.
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch (e) {
    return `error: ${e?.cause?.code ?? e?.name ?? e?.message ?? e}`;
  }
}

console.log(`\n024 — mocks 404 incondicional · ${BASE} · --expect=${EXPECT}\n`);

// Control 0: la app responde. Sin esto, "todo 404" podría ser "todo apagado".
const health = await status("GET", "/api/health");
ok("GET /api/health responde 200 (la app está viva)", health === 200, `→ ${health}`);
if (health !== 200) {
  console.log(`\n${checks} checks, ${failures} fallos — la app no responde; nada que medir.`);
  process.exit(1);
}

const rutas = [...rutasDev(), "/api/dev", "/api/dev/inexistente-de-verdad"];
console.log(`\n${rutas.length - 2} rutas derivadas del árbol + raíz + una inexistente, × ${METHODS.length} métodos:\n`);

const abiertas = [];
for (const path of rutas) {
  const resultados = await Promise.all(METHODS.map((m) => status(m, path)));
  const resumen = METHODS.map((m, i) => `${m}=${resultados[i]}`).join(" ");
  const todos404 = resultados.every((s) => s === 404);
  if (!todos404) abiertas.push(path);
  if (EXPECT === "404") {
    ok(
      `${path}`,
      todos404,
      `un método no dio 404 y delata la ruta: ${resumen}`
    );
  } else {
    console.log(`  ·   ${path}: ${resumen}`);
  }
}

if (EXPECT === "open") {
  ok(
    "con los mocks encendidos, al menos una ruta responde distinto de 404",
    abiertas.length > 0,
    "todo fue 404: o el perímetro bloquea de más, o el guion no distingue"
  );
  ok(
    "la ruta inexistente sigue siendo 404 aunque los mocks estén encendidos",
    !abiertas.includes("/api/dev/inexistente-de-verdad")
  );
}

// Control: el resto de /api/* no cambia por el middleware.
console.log("");
const fuera = await status("PUT", "/api/inexistente-de-verdad");
ok("PUT /api/inexistente-de-verdad (fuera del perímetro) → 404", fuera === 404, `→ ${fuera}`);

console.log(`\n${checks} checks, ${failures} fallos`);
process.exit(failures === 0 ? 0 : 1);
