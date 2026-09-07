/**
 * Sesión compartida entre los arneses E2E.
 *
 * ## El problema que resuelve
 *
 * Cada guion abría su propio contexto y hacía login. Encadenando los tres
 * —`pnpm test:e2e`— más las corridas sueltas de una sesión de trabajo, el login
 * de la app empieza a devolver **429 "Demasiados intentos"**.
 *
 * Eso NO es un fallo de la app: es su protección contra fuerza bruta haciendo
 * exactamente lo que debe. **No se afloja el límite para que pasen las
 * pruebas** — sería quitar una defensa real para comodidad del arnés, y el
 * arnés existe para proteger al producto, no al revés.
 *
 * ## Cómo
 *
 * Se guarda el estado del navegador (cookies) en un archivo y se reutiliza. Solo
 * se hace login cuando no hay estado guardado o cuando el guardado ya no vale.
 * Con esto, una tanda entera de arneses gasta **un** login en vez de uno por
 * guion.
 *
 * El archivo está gitignorado: son credenciales de una base local de pruebas,
 * pero credenciales al fin.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const ARCHIVO = path.join(process.cwd(), ".e2e-session.json");

const EMAIL = "e2e@uniko.test";
const PASSWORD = "password-e2e-123";

/** ¿La sesión guardada sigue sirviendo? Se pregunta a la app, no se supone. */
async function sesionViva(ctx, base) {
  const res = await ctx.request.get(`${base}/api/conversations`);
  return res.ok();
}

async function entrar(ctx, base) {
  let r = await ctx.request.post(`${base}/api/auth/sign-up/email`, {
    headers: { origin: base },
    data: { email: EMAIL, password: PASSWORD, name: "Operador E2E" },
  });
  if (!r.ok()) {
    // Re-corrida: el registro se cierra tras la primera organización.
    r = await ctx.request.post(`${base}/api/auth/sign-in/email`, {
      headers: { origin: base },
      data: { email: EMAIL, password: PASSWORD },
    });
  }
  if (r.status() === 429) {
    throw new Error(
      "El login está limitando intentos (429). Espera un par de minutos: " +
        "el límite es de la app y no se toca. Con la sesión guardada esto no " +
        "debería volver a pasar."
    );
  }
  return r;
}

/**
 * Devuelve un contexto de navegador ya con sesión.
 *
 * @param {import("playwright").Browser} browser
 * @param {string} base URL de la app
 * @param {object} [opciones] opciones extra para `newContext`
 * @returns {Promise<{ctx: import("playwright").BrowserContext, reutilizada: boolean}>}
 */
export async function contextoConSesion(browser, base, opciones = {}) {
  if (existsSync(ARCHIVO)) {
    const storageState = JSON.parse(await readFile(ARCHIVO, "utf8"));
    const ctx = await browser.newContext({ ...opciones, storageState });
    if (await sesionViva(ctx, base)) return { ctx, reutilizada: true };
    // Caducada o de otra base: se tira y se entra de nuevo.
    await ctx.close();
    await rm(ARCHIVO, { force: true });
  }

  const ctx = await browser.newContext(opciones);
  const r = await entrar(ctx, base);
  if (!r.ok()) {
    throw new Error(`No se pudo entrar: ${r.status()} ${await r.text()}`);
  }
  await writeFile(ARCHIVO, JSON.stringify(await ctx.storageState(), null, 2));
  return { ctx, reutilizada: false };
}
