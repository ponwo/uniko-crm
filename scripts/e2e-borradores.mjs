/**
 * Self-test E2E de comportamiento — un borrador por conversación
 * (guion tests/e2e/us1-inbox.md, sección "Borrador por conversación").
 *
 * La caja de escritura es una sola para toda la Bandeja. Antes su texto se
 * quedaba puesto al cambiar de conversación y un Ctrl+Enter lo mandaba al
 * contacto equivocado. Conduce la UI real con Playwright: cada conversación
 * guarda su borrador, la lista lo marca, sobrevive a recargar, y un envío que
 * falla después de cambiar de hilo regresa a SU conversación, no a la abierta.
 *
 * Uso: node --env-file=.env scripts/e2e-borradores.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-BO-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const req = ctx.request;

console.log("== Setup: operador + conexión + dos conversaciones ==");
const email = "e2e@uniko.test";
const password = "password-e2e-123";
let su = await req.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password, name: "Operador E2E" },
});
if (!su.ok()) {
  su = await req.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email, password },
  });
}
ok("registro o login del operador", su.ok());

const conn = await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-BO", phoneNumberId: PN, token: "tok-bo" },
});
ok("conexión WhatsApp guardada", conn.ok());

const ANA = `Ana${S}`;
const BETO = `Beto${S}`;
for (const name of [ANA, BETO]) {
  await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    data: {
      phoneNumberId: PN,
      from: `52155501${Math.floor(1000 + Math.random() * 8999)}`,
      name,
      text: "hola, ¿me pasas precios?",
      // Id propio de la corrida: el del mock sale de un contador que vuelve a
      // cero al reiniciar el servidor, y en una base ya usada el entrante se
      // descartaría por duplicado (la conversación quedaría sin ventana).
      waMessageId: `wamid.bo.${S}.${name}`,
    },
  });
}
const convs = {};
await until(async () => {
  const d = await (await req.get(`${BASE}/api/conversations`)).json();
  for (const c of d.conversations ?? []) {
    if (c.contact.name === ANA) convs.ana = c;
    if (c.contact.name === BETO) convs.beto = c;
  }
  return Boolean(convs.ana && convs.beto);
});
ok("dos conversaciones creadas por entrantes", Boolean(convs.ana && convs.beto));
if (!convs.ana || !convs.beto) {
  await browser.close();
  process.exit(1);
}

const outTexts = async (conv) => {
  const d = await (
    await req.get(`${BASE}/api/conversations/${conv.id}/messages`)
  ).json();
  return (d.messages ?? [])
    .filter((m) => m.direction === "out")
    .map((m) => m.text ?? "");
};

const page = await ctx.newPage();
const box = page.getByPlaceholder("Escribe una respuesta");
const row = (name) => page.locator("li").filter({ hasText: name });
const draftOf = (name) => row(name).getByTestId("draft-preview");

/** Abre la conversación y espera a que la cabecera diga de quién es. */
async function open(name) {
  await row(name).locator("button").first().click();
  await page.locator("header", { hasText: name }).first().waitFor({ timeout: 10000 });
  await box.waitFor({ timeout: 20000 }).catch(async (e) => {
    await page.screenshot({ path: ".tmp/e2e-borradores-fallo.png" });
    throw e;
  });
}

await page.goto(`${BASE}/inbox`);
await row(ANA).first().waitFor({ timeout: 20000 });

console.log("\n== Lo escrito para Ana no viaja a la conversación de Beto ==");
const A_TEXT = `precio especial para Ana ${S}`;
await open(ANA);
await box.click();
// Tecla por tecla: la caja ahora lee del almacén de borradores y no debe
// perder letras ni mover el cursor mientras se escribe.
await box.pressSequentially(A_TEXT);
ok("tecleado completo, sin letras perdidas", (await box.inputValue()) === A_TEXT,
  JSON.stringify(await box.inputValue()));
await box.press("Home");
await box.pressSequentially("¡");
const A_FINAL = `¡${A_TEXT}`;
ok("el cursor se queda donde se escribe (no salta al final)",
  (await box.inputValue()) === A_FINAL, JSON.stringify(await box.inputValue()));

await open(BETO);
ok("la caja de Beto aparece vacía", (await box.inputValue()) === "",
  JSON.stringify(await box.inputValue()));
await draftOf(ANA).waitFor({ timeout: 5000 }).catch(() => {});
const marcaAna = (await draftOf(ANA).count()) ? await draftOf(ANA).innerText() : "";
ok("el renglón de Ana dice «Borrador:» con lo que se dejó",
  marcaAna.startsWith("Borrador:") && marcaAna.includes(A_TEXT), JSON.stringify(marcaAna));

const B_TEXT = `te confirmo la cita Beto ${S}`;
await box.fill(B_TEXT);
await open(ANA);
ok("al volver con Ana su texto sigue en la caja", (await box.inputValue()) === A_FINAL,
  JSON.stringify(await box.inputValue()));
ok("la conversación abierta no se marca como borrador", (await draftOf(ANA).count()) === 0);
ok("el renglón de Beto marca su borrador",
  (await draftOf(BETO).count()) === 1 && (await draftOf(BETO).innerText()).includes(B_TEXT));

console.log("\n== Recargar la página no pierde los borradores ==");
await page.reload();
await row(BETO).first().waitFor({ timeout: 20000 });
await draftOf(BETO).waitFor({ timeout: 5000 }).catch(() => {});
ok("tras recargar, Beto sigue marcado con su borrador",
  (await draftOf(BETO).count()) === 1 && (await draftOf(BETO).innerText()).includes(B_TEXT));
await open(ANA);
ok("tras recargar, la caja de Ana conserva su texto", (await box.inputValue()) === A_FINAL,
  JSON.stringify(await box.inputValue()));

console.log("\n== Los formularios de ubicación y contacto son de su conversación ==");
await page.getByRole("button", { name: "Enviar ubicación" }).first().click();
const coords = page.getByPlaceholder("21.019, -101.257");
await coords.fill("21.019, -101.257");
ok("el formulario de ubicación se abre en Ana", await coords.isVisible());
await open(BETO);
ok("al cambiar a Beto el formulario se cierra", (await coords.count()) === 0);
ok("y la caja de Beto trae su propio borrador", (await box.inputValue()) === B_TEXT,
  JSON.stringify(await box.inputValue()));

console.log("\n== Enviar: sale a SU conversación y el borrador desaparece ==");
await open(ANA);
await box.press("Control+Enter");
const llego = await until(async () => (await outTexts(convs.ana)).includes(A_FINAL));
ok("el mensaje llegó a la conversación de Ana", llego);
ok("y no a la de Beto", !(await outTexts(convs.beto)).includes(A_FINAL));
ok("la caja de Ana queda vacía", (await box.inputValue()) === "");
await open(BETO);
ok("Ana ya no tiene borrador en la lista", (await draftOf(ANA).count()) === 0);
await open(ANA);
ok("ni en la caja al volver", (await box.inputValue()) === "");

console.log("\n== Un envío falla DESPUÉS de cambiar de conversación ==");
const FALLO = "Meta no respondió (prueba)";
const failSend = async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  await sleep(1500);
  await route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "upstream", message: FALLO } }),
  });
};
const betoMessages = `**/api/conversations/${convs.beto.id}/messages`;
await page.route(betoMessages, failSend);
await open(BETO);
await box.press("Control+Enter");
// Antes de que el servidor conteste, el operador ya se fue con Ana.
await open(ANA);
const aviso = page.getByText(`No salió tu mensaje a ${BETO}`);
const avisado = await aviso.waitFor({ timeout: 8000 }).then(() => true, () => false);
ok("un aviso dice que no salió el mensaje a Beto", avisado);
ok("y que quedó como borrador en su conversación",
  avisado && (await aviso.innerText()).includes("Quedó como borrador"));
ok("el texto de Beto NO aparece en la caja de Ana", (await box.inputValue()) === "",
  JSON.stringify(await box.inputValue()));
await draftOf(BETO).waitFor({ timeout: 5000 }).catch(() => {});
ok("el renglón de Beto muestra el borrador que no salió",
  (await draftOf(BETO).count()) === 1 && (await draftOf(BETO).innerText()).includes(B_TEXT));
await open(BETO);
ok("al abrir a Beto, su texto está en la caja", (await box.inputValue()) === B_TEXT,
  JSON.stringify(await box.inputValue()));
ok("nada salió hacia Ana", !(await outTexts(convs.ana)).includes(B_TEXT));

console.log("\n== Un envío falla SIN cambiar de conversación (como antes) ==");
await box.press("Control+Enter");
const devuelto = await until(async () => (await box.inputValue()) === B_TEXT, 8000);
ok("el texto vuelve a la caja", devuelto, JSON.stringify(await box.inputValue()));
ok("con el motivo del servidor", await page.getByText(FALLO).isVisible());
await page.unroute(betoMessages);

await page.screenshot({ path: ".tmp/e2e-borradores.png" });
await browser.close();
console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
