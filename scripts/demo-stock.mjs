/**
 * MS-Stock de DEMOSTRACIÓN para grabar el video de Inventario
 * (scripts/demo-media.mjs, escena 07).
 *
 * El stock-mock de la app trae playeras, gorras y tazas con el ícono de la app
 * como foto: sirve para el self-test, no para enseñar una ferretería. Este
 * servidor habla el MISMO contrato (`/v1/agent/search`, `/v1/agent/products/{sku}`,
 * `/v1/agent/catalog`, `/health`) con productos de la Ferretería El Martillo,
 * fotos de producto dibujadas con Playwright y un catálogo PDF de verdad.
 *
 * No toca el código de la app: se activa apuntando STOCK_BASE_URL a este puerto.
 * Jamás va en una instancia real.
 *
 *   node scripts/demo-stock.mjs            # escucha en :3102
 */
import http from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.DEMO_STOCK_PORT ?? 3102);
const ORIGIN = `http://localhost:${PORT}`;
const CACHE = path.join(os.tmpdir(), "uniko-demo-stock");

/** Catálogo de la ferretería. `emoji` y `fondo` dibujan la foto del producto. */
const PRODUCTOS = [
  { sku: "IMP-ACR-5", name: "Impermeabilizante acrílico 5 años 19 L", description: "Rinde ~40 m² a dos manos. Blanco.", stock: 14, price: 1680, emoji: "🪣", fondo: ["#e8f1ff", "#b9d3ff"] },
  { sku: "IMP-FIB-10", name: "Impermeabilizante fibratado 10 años 19 L", description: "Con fibras de refuerzo, ideal para azoteas con grietas.", stock: 5, price: 2350, emoji: "🏠", fondo: ["#e9f8ef", "#b6e6c6"] },
  { sku: "IMP-ASF-3", name: "Impermeabilizante asfáltico 3 años 19 L", description: null, stock: 0, price: 990, emoji: "🛢️", fondo: ["#f1f1f1", "#d6d6d6"] },
  { sku: "TAL-TRU-20", name: "Taladro inalámbrico Truper 20V", description: "Batería y cargador incluidos, 5 brocas.", stock: 6, price: 1899, emoji: "🔩", fondo: ["#fff3e0", "#ffd59a"] },
  { sku: "TAL-DEW-20", name: "Taladro DeWalt 20V MAX", description: "Batería 2 Ah y maletín.", stock: 2, price: 3450, emoji: "🛠️", fondo: ["#fff8d6", "#ffe680"] },
  { sku: "CEM-GRI-50", name: "Cemento gris 50 kg", description: "Precio por bulto; mayoreo desde 10.", stock: 120, price: 245, emoji: "🧱", fondo: ["#f3efe9", "#ddd0bf"] },
  { sku: "PIN-VIN-19", name: "Pintura vinílica blanca 19 L", description: "Rinde ~90 m².", stock: 9, price: 1150, emoji: "🎨", fondo: ["#fdeef4", "#f6bfd5"] },
  { sku: "CAB-12-100", name: "Cable THW calibre 12, rollo 100 m", description: null, stock: 11, price: 1890, emoji: "🔌", fondo: ["#eef0ff", "#c3c9ff"] },
];

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** «impermeabilizantes» → «impermeabilizante»; «taladros» → «taladro». */
function raices(q) {
  const w = norm(q);
  const out = new Set([w]);
  if (w.endsWith("es")) out.add(w.slice(0, -2));
  if (w.endsWith("s")) out.add(w.slice(0, -1));
  return [...out].filter((x) => x.length >= 2);
}

function buscar(q) {
  const rs = raices(q);
  return PRODUCTOS.filter((p) => {
    const n = norm(p.name);
    return p.sku === q.toUpperCase() || rs.some((r) => r.split(/\s+/).every((t) => n.includes(t)));
  });
}

const publico = (p) => ({
  sku: p.sku,
  name: p.name,
  description: p.description,
  stock: p.stock,
  unit: "pzas",
  price: p.price,
  currency: "MXN",
  available: p.stock > 0,
  image_url: `${ORIGIN}/img/${p.sku}.png`,
  variants: [],
  label: null,
  parent_sku: null,
});

// ── Fotos y catálogo, dibujados una vez ────────────────────────────────────
async function generar() {
  await mkdir(CACHE, { recursive: true });
  const pdf = path.join(CACHE, "catalogo.pdf");
  if (existsSync(pdf) && PRODUCTOS.every((p) => existsSync(path.join(CACHE, `${p.sku}.png`)))) return;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  for (const p of PRODUCTOS) {
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:800px;height:800px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:linear-gradient(160deg,${p.fondo[0]},${p.fondo[1]});font-family:Segoe UI,Arial,sans-serif">
        <div style="font-size:340px;line-height:1">${p.emoji}</div>
        <div style="margin-top:40px;padding:14px 28px;border-radius:999px;background:rgba(255,255,255,.85);
          font-size:30px;font-weight:700;color:#1d2433;max-width:680px;text-align:center">${p.name}</div>
        <div style="margin-top:18px;font-size:22px;color:#3d4659;letter-spacing:2px">FERRETERÍA EL MARTILLO</div>
      </div></body></html>`);
    await page.screenshot({ path: path.join(CACHE, `${p.sku}.png`) });
  }
  const filas = PRODUCTOS.map(
    (p) => `<tr><td style="font-size:30px">${p.emoji}</td><td><b>${p.name}</b><br><span style="color:#667">${p.description ?? ""}</span></td>
      <td style="font-family:monospace;color:#667">${p.sku}</td><td style="text-align:right"><b>$${p.price.toLocaleString("es-MX")}</b></td></tr>`
  ).join("");
  await page.setContent(`<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;margin:40px;color:#1d2433">
    <h1 style="margin:0">Ferretería El Martillo</h1>
    <p style="color:#556;margin:4px 0 24px">Catálogo de productos · precios en MXN con IVA · Av. Hidalgo 245, Centro</p>
    <table style="width:100%;border-collapse:collapse" cellpadding="10">
      <tr style="background:#0d5bff;color:#fff"><th></th><th style="text-align:left">Producto</th><th>SKU</th><th style="text-align:right">Precio</th></tr>
      ${filas}
    </table></body></html>`);
  await page.pdf({ path: pdf, format: "Letter" });
  await browser.close();
}

await generar();

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", ORIGIN);
    const ruta = url.pathname.replace(/\/+$/, "");
    try {
      if (ruta === "/health") return json(res, 200, { status: "ok", db: "ok" });
      if (ruta.startsWith("/img/")) {
        const f = path.join(CACHE, path.basename(ruta));
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(await readFile(f));
      }
      if (ruta === "/catalogo.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(await readFile(path.join(CACHE, "catalogo.pdf")));
      }
      if (ruta === "/v1/agent/search") {
        const q = (url.searchParams.get("q") ?? "").trim();
        const limit = Math.min(25, Number(url.searchParams.get("limit") ?? 10) || 10);
        const hits = buscar(q);
        return json(res, 200, { results: hits.slice(0, limit).map(publico), truncated: hits.length > limit });
      }
      const m = ruta.match(/^\/v1\/agent\/products\/([^/]+)$/);
      if (m) {
        const p = PRODUCTOS.find((x) => x.sku === decodeURIComponent(m[1]).toUpperCase());
        return p ? json(res, 200, publico(p)) : json(res, 404, { error: { code: "NOT_FOUND" } });
      }
      if (ruta === "/v1/agent/catalog") {
        return json(res, 200, {
          url: `${ORIGIN}/catalogo.pdf`,
          filename: "Catalogo-Ferreteria-El-Martillo.pdf",
          updated_at: new Date().toISOString(),
        });
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
  })
  .listen(PORT, () => console.log(`[demo-stock] :${PORT} — ${PRODUCTOS.length} productos, fotos en ${CACHE}`));

