/**
 * Self-test E2E de comportamiento — 016: «Obtener de Meta» (el ID del dataset).
 * Guion tests/e2e/us-atribucion.md (US2) · guía docs/atribucion-capi.md.
 *
 * Por qué existe: en ILTU (2026-10-09) se tecleó el ID del dataset y se
 * guardaron, uno tras otro, el de la cuenta de WhatsApp, el del número y otro
 * conjunto del portafolio. Cada venta falló después en Meta, y como cada evento
 * se intenta una sola vez, esas conversiones se perdieron. El botón le pide el
 * dataset a Meta con la cuenta conectada; esto lo conduce en el navegador:
 *
 *   1. Clic → el campo se llena con el ID de la cuenta y la pantalla dice de
 *      dónde salió; nada queda guardado hasta «Guardar».
 *   2. Guardar → conectado a ESE dataset; pedirlo de nuevo dice que ya es el
 *      guardado. Con otro guardado, avisa que es distinto.
 *   3. Teclear un ID que no es de dataset → el guardado lo rechaza con su motivo.
 *   4. Camino infeliz: Meta niega el permiso → el motivo se ve tal cual, el
 *      campo no cambia y la página sigue viva.
 *   5. Teléfono (375 px): la fila del botón cabe sin scroll horizontal.
 *
 * Con `ATRIBUCION` apagada afirma lo contrario: ni la pantalla ni la ruta
 * existen (404), y por lo tanto no se le pide nada a Meta.
 *
 * Deja la configuración de atribución desconectada al terminar.
 *
 * Uso: node --env-file=.env scripts/e2e-dataset-desde-meta.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true y META_GRAPH_BASE_URL → wa-mock.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { contextoConSesion } from "./e2e-sesion.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).toUpperCase();
const PN = `PN-DS-${RUN}`;
const WABA = `WABA-DS-${RUN}`;
// El wa-mock niega el dataset a los WABA terminados en "-sin-permiso", como
// Meta a un token sin `whatsapp_business_management`.
const WABA_SIN_PERMISO = `WABA-DS-${RUN}-sin-permiso`;

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

mkdirSync(".tmp", { recursive: true });
const browser = await chromium.launch();
const { ctx, reutilizada } = await contextoConSesion(browser, BASE, {
  viewport: { width: 1280, height: 900 },
});
const req = ctx.request;
const page = await ctx.newPage();
console.log(`Sesión ${reutilizada ? "reutilizada" : "nueva"}. RUN=${RUN}`);

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

const conectarWhatsApp = (wabaId) =>
  api("/api/settings/whatsapp", {
    method: "PUT",
    data: { wabaId, phoneNumberId: PN, token: `tok-ds-${RUN}` },
  });

const campo = page.getByLabel("ID del dataset");
const boton = page.getByRole("button", { name: "Obtener de Meta" });

/**
 * Abre Ajustes → Anuncios y espera a que la pantalla esté VIVA: el botón se
 * pinta desde el HTML del servidor antes de hidratar, y un clic ahí no hace
 * nada. La actividad la carga un efecto, así que cuando deja de decir
 * «Cargando…» React ya tomó la página.
 */
async function abrirAnuncios() {
  await page.goto(`${BASE}/settings/ads`, { waitUntil: "domcontentloaded" });
  await boton.waitFor({ timeout: 30000 });
  await page.getByText("Cargando…").waitFor({ state: "detached", timeout: 30000 });
}

/**
 * Clic en «Obtener de Meta» y espera la RESPUESTA (no solo el botón: justo
 * después del clic todavía se ve habilitado, antes de que React lo apague).
 */
async function obtener() {
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/settings/capi/dataset"), {
      timeout: 30000,
    }),
    boton.click(),
  ]);
  await boton.waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Obtener de Meta" && !b.disabled
      ),
    null,
    { timeout: 30000 }
  );
}

try {
  const flag = await api("/api/settings/capi");

  if (flag.status === 404) {
    console.log("\n== Atribución apagada: «Obtener de Meta» no existe ==");
    const ruta = await api("/api/settings/capi/dataset", { method: "POST" });
    ok("POST /api/settings/capi/dataset → 404", ruta.status === 404, `status=${ruta.status}`);
    const pantalla = await page.goto(`${BASE}/settings/ads`);
    ok("la pantalla /settings/ads no existe", pantalla?.status() === 404, `status=${pantalla?.status()}`);
  } else {
    console.log("\n== Setup: WhatsApp conectado y atribución desconectada ==");
    const wa = await conectarWhatsApp(WABA);
    ok("WhatsApp conectado", wa.ok, JSON.stringify(wa.json));
    await api("/api/settings/capi", { method: "DELETE" });
    ok("atribución sin configurar", (await api("/api/settings/capi")).json?.capi === null);

    console.log("\n== 1. Clic: el ID sale de Meta, no del teclado ==");
    await abrirAnuncios();
    ok("el botón está junto al campo del ID", await boton.isVisible());
    await obtener();
    const id = await campo.inputValue();
    ok("el campo quedó con un ID numérico", /^\d+$/.test(id), `valor=${id}`);
    const esperado = (await api("/api/settings/capi/dataset", { method: "POST" })).json?.datasetId;
    ok("es el dataset que Meta tiene para ESTA cuenta", id === esperado, `${id} vs ${esperado}`);
    ok(
      "la pantalla dice de dónde salió y que falta guardar",
      await page.getByText("Es el dataset de tu cuenta de WhatsApp").first().isVisible() &&
        (await page.getByText("Da «Guardar» para conectarlo.").isVisible())
    );
    ok("obtenerlo no guardó nada", (await api("/api/settings/capi")).json?.capi === null);
    await page.screenshot({ path: ".tmp/e2e-016-obtener.png" });

    console.log("\n== 2. Guardar: conectado a ESE dataset ==");
    await page.getByRole("button", { name: "Guardar" }).click();
    // Exacto: la nota de Meta también dice «…ya es el que tienes guardado.».
    await page.getByText("Guardado.", { exact: true }).waitFor({ timeout: 15000 });
    const cfg = (await api("/api/settings/capi")).json?.capi;
    ok("quedó guardado el ID que dio Meta", cfg?.datasetId === id, JSON.stringify(cfg));
    await obtener();
    ok(
      "pedirlo otra vez dice que ya es el guardado",
      await page.getByText("y ya es el que tienes guardado.").isVisible()
    );

    // Lo de ILTU: guardado OTRO conjunto del portafolio.
    const otro = "123456789012345";
    await api("/api/settings/capi", { method: "PUT", data: { datasetId: otro } });
    await abrirAnuncios();
    await obtener();
    ok(
      "con otro dataset guardado, avisa que es distinto y cuál era",
      await page.getByText(`Es distinto del guardado (${otro})`).isVisible()
    );
    ok("y colocó el correcto en el campo", (await campo.inputValue()) === id);

    console.log("\n== 3. Teclearlo mal se rechaza al guardar ==");
    await campo.fill("AErb_b9y6jgDlm8Xb7PBCYF");
    ok(
      "editar el campo retira el aviso de Meta (ya no es «el de tu cuenta»)",
      (await page.getByText("Es el dataset de tu cuenta de WhatsApp").count()) === 0
    );
    await page.getByRole("button", { name: "Guardar" }).click();
    const alerta = page.getByRole("alert").filter({ hasText: "solo números" });
    await alerta.waitFor({ timeout: 15000 });
    ok("el motivo se ve en la pantalla", await alerta.isVisible());
    ok(
      "y lo guardado no cambió",
      (await api("/api/settings/capi")).json?.capi?.datasetId === otro
    );

    console.log("\n== 4. Camino infeliz: Meta niega el permiso ==");
    const sinPermiso = await conectarWhatsApp(WABA_SIN_PERMISO);
    ok("WhatsApp reconectado a una cuenta sin permiso", sinPermiso.ok, JSON.stringify(sinPermiso.json));
    await abrirAnuncios();
    const antes = await campo.inputValue();
    await obtener();
    const negado = page.getByRole("alert").filter({ hasText: "whatsapp_business_management" });
    await negado.waitFor({ timeout: 15000 });
    ok("se ve lo que dijo Meta, tal cual", await negado.isVisible());
    ok("el campo no cambió", (await campo.inputValue()) === antes);
    ok("la página sigue viva: el botón vuelve a estar disponible", await boton.isEnabled());
    await page.screenshot({ path: ".tmp/e2e-016-sin-permiso.png" });

    console.log("\n== 5. Teléfono (375 px) ==");
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirAnuncios();
    ok("el botón y el campo se ven", (await boton.isVisible()) && (await campo.isVisible()));
    ok(
      "sin scroll horizontal",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    );
    await page.screenshot({ path: ".tmp/e2e-016-movil.png" });

    // Limpieza: los demás arneses no esperan atribución configurada.
    await api("/api/settings/capi", { method: "DELETE" });
  }
} catch (err) {
  failures++;
  console.error("ERROR FATAL:", err);
} finally {
  await browser.close();
}

console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures ? 1 : 0);
