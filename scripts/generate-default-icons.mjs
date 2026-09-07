/**
 * Genera los PNG de fábrica de la app instalable: `public/icon-192.png` y
 * `public/icon-512.png`.
 *
 * ## Por qué existe este guion y no dos archivos exportados a mano
 *
 * Los dos PNG se commitean, así que hacen falta una sola vez y podrían salir de
 * cualquier herramienta de diseño. El problema de eso es que dentro de seis
 * meses nadie sabría de dónde salieron ni cómo rehacerlos: su origen viviría en
 * la cabeza de una persona. Con este guion, los archivos son **reproducibles**
 * a partir de la única fuente de verdad del logo, que es `src/lib/favicon.ts`.
 *
 * ## Cuándo hay que volver a correrlo
 *
 * - Si cambia el trazo de la marca (`src/lib/brand.ts`) o el dibujo del icono
 *   generado (`src/lib/favicon.ts`).
 * - Si cambia el acento por defecto de Uniko (`DEFAULT_BRANDING` en
 *   `src/lib/branding.ts`).
 * - Si algún día hacen falta otras medidas: se añaden a `MEDIDAS` y se corre.
 *
 * **No hace falta correrlo en cada build, ni en CI.** Los PNG están en el repo
 * a propósito: son parte de la imagen y no dependen ni de la base de datos ni
 * del volumen de medios, que es lo que hace instalable a una instancia recién
 * desplegada y sin marca configurada.
 *
 * ## Cómo se corre
 *
 *   node scripts/generate-default-icons.mjs
 *
 * Necesita el Chromium de Playwright (`pnpm exec playwright install chromium`).
 * Playwright y esbuild ya son devDependencies del repo: este guion **no añade
 * ninguna dependencia**, y sobre todo no añade ninguna al runtime — rasterizar
 * en el servidor está descartado a propósito (spec 019, decisión de iconos).
 *
 * ## Qué hace, exactamente
 *
 * 1. Empaqueta con esbuild las funciones puras que dibujan el logo (son
 *    TypeScript y este guion es JavaScript suelto).
 * 2. Pinta el SVG resultante en Chromium a la medida pedida.
 * 3. Captura el elemento y escribe el PNG.
 * 4. Comprueba en los bytes que salió cuadrado y de la medida exacta, leyendo
 *    el chunk IHDR — la misma comprobación que hace la app para decidir si un
 *    icono sirve para instalar.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { chromium } from "playwright";

const MEDIDAS = [192, 512];
const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SALIDA = join(RAIZ, "public");

/** Ancho y alto de un PNG, leídos del chunk IHDR. */
function medidasPng(buf) {
  const png = Buffer.from(buf);
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (firma.some((b, i) => png[i] !== b)) throw new Error("no es un PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const tmp = await mkdtemp(join(tmpdir(), "uniko-icons-"));
try {
  // 1. El logo vive en TypeScript. Se empaqueta con el mismo truco que usa
  //    `pnpm seed:demo`: esbuild con el alias `@` apuntando a `src`.
  const entrada = join(tmp, "entrada.ts");
  await writeFile(
    entrada,
    [
      `export { generatedFaviconSvg } from "@/lib/favicon";`,
      `export { DEFAULT_BRANDING } from "@/lib/branding";`,
    ].join("\n")
  );
  const bundle = join(tmp, "logo.mjs");
  await esbuild.build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    alias: { "@": join(RAIZ, "src") },
    logLevel: "silent",
  });
  const { generatedFaviconSvg, DEFAULT_BRANDING } = await import(
    pathToFileURL(bundle).href
  );

  const svg = generatedFaviconSvg(DEFAULT_BRANDING);
  console.log(`Logo de fábrica: marca "${DEFAULT_BRANDING.name}", acento ${DEFAULT_BRANDING.accent}`);

  // 2 y 3. Pintar y capturar.
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const medida of MEDIDAS) {
    const escalado = svg.replace(
      /width="64" height="64"/,
      `width="${medida}" height="${medida}"`
    );
    await page.setViewportSize({ width: medida, height: medida });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;padding:0;line-height:0}</style>${escalado}`
    );
    const destino = join(SALIDA, `icon-${medida}.png`);
    await page.locator("svg").screenshot({ path: destino });

    // 4. Verificar en los bytes, no en la intención.
    const { width, height } = medidasPng(readFileSync(destino));
    if (width !== medida || height !== medida) {
      throw new Error(
        `${destino} salió de ${width}x${height} y se esperaba ${medida}x${medida}`
      );
    }
    console.log(`  OK  public/icon-${medida}.png — ${width}x${height}`);
  }
  await browser.close();
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("Listo. Los PNG se commitean: son parte de la imagen.");
