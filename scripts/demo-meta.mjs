/**
 * Proxy de DEMOSTRACIÓN delante del wa-mock (scripts/demo-media.mjs, escena 08).
 *
 * La tarjeta «Anuncio de origen» (034) copia la imagen del creativo, y fuera de
 * los hosts de Meta solo la acepta del ORIGEN del mock de Graph. El wa-mock
 * sirve un cuadro de color plano —suficiente para el self-test—, así que este
 * proxy se pone en ese origen: reenvía TODO al wa-mock de la app tal cual y solo
 * contesta él `…/media-file/creativo-demo-*` con un anuncio dibujado.
 *
 * No toca el código de la app: se activa apuntando META_GRAPH_BASE_URL a este
 * puerto. Jamás va en una instancia real.
 *
 *   node scripts/demo-meta.mjs            # escucha en :3103, reenvía a :3100
 */
import http from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.DEMO_META_PORT ?? 3103);
const APP = new URL(process.env.DEMO_APP_BASE ?? "http://localhost:3100");
const CACHE = path.join(os.tmpdir(), "uniko-demo-meta");
// JPEG: la copia del creativo tiene tope de 300 KB (CREATIVO_MAX_BYTES) y un PNG
// de 1080×1080 se pasa.
const CREATIVO = path.join(CACHE, "creativo-lluvias.jpg");

async function generar() {
  if (existsSync(CREATIVO)) return;
  await mkdir(CACHE, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div style="width:1080px;height:1080px;box-sizing:border-box;padding:80px;display:flex;flex-direction:column;
      justify-content:space-between;background:linear-gradient(170deg,#0b2a5b 0%,#0d5bff 60%,#5aa2ff 100%);
      color:#fff;font-family:Segoe UI,Arial,sans-serif">
      <div style="font-size:34px;letter-spacing:4px;opacity:.85">FERRETERÍA EL MARTILLO</div>
      <div>
        <div style="font-size:230px;line-height:1">🌧️🏠</div>
        <div style="font-size:96px;font-weight:800;line-height:1.05;margin-top:30px">Que no se te<br>llueva la azotea</div>
        <div style="font-size:44px;margin-top:26px;opacity:.95">Impermeabilizantes con <b>20% de descuento</b> esta temporada</div>
      </div>
      <div style="align-self:flex-start;background:#25d366;color:#0b2a17;font-size:40px;font-weight:700;
        padding:22px 40px;border-radius:999px">Escríbenos por WhatsApp</div>
    </div></body></html>`);
  await page.screenshot({ path: CREATIVO, type: "jpeg", quality: 82 });
  await browser.close();
}

await generar();

http
  .createServer(async (req, res) => {
    if (/\/api\/dev\/wa-mock\/media-file\/creativo-demo-/.test(req.url ?? "")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(await readFile(CREATIVO));
    }
    const up = http.request(
      { host: APP.hostname, port: APP.port, path: req.url, method: req.method, headers: { ...req.headers, host: APP.host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(PORT, () => console.log(`[demo-meta] :${PORT} → ${APP.origin} (creativo en ${CREATIVO})`));
