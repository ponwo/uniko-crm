import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/dev/stock-mock/[...path]/route";
import { resetStockMock, stockMockSnapshot } from "@/server/dev/stock-mock-state";

/**
 * 026 — El MS-Stock de mentira responde como el de verdad (contrato de la
 * feature 003) y obedece los modos infelices. Si el mock miente, el self-test
 * prueba contra algo que no existe.
 */

const KEY = "desarrollo-local-stock-key-0123456789abcdef";
const SECRET = "desarrollo-local-sso-secret-0123456789abcdef";
const BASE = "http://localhost:3000/api/dev/stock-mock";

function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

function get(path: string, opts: { key?: string; query?: string } = {}) {
  const req = new Request(`${BASE}/${path}${opts.query ? `?${opts.query}` : ""}`, {
    headers: opts.key ? { "x-api-key": opts.key } : {},
  });
  return GET(req, ctx(path));
}

async function setMode(mode: string) {
  const req = new Request(`${BASE}/_mode`, { method: "POST", body: JSON.stringify({ mode }) });
  return POST(req, ctx("_mode"));
}

async function setCatalog(body: unknown) {
  const req = new Request(`${BASE}/_catalog`, { method: "POST", body: JSON.stringify(body) });
  return POST(req, ctx("_catalog"));
}

describe("026 — stock-mock", () => {
  beforeEach(() => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STOCK_API_KEY", KEY);
    vi.stubEnv("STOCK_SSO_SECRET", SECRET);
    vi.stubEnv("STOCK_BASE_URL", BASE);
    resetStockMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetStockMock();
  });

  it("en producción no existe (404), sea cual sea la ruta", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("health")).status).toBe(404);
    expect((await get("_state")).status).toBe(404);
  });

  it("/health sin llave → ok; /v1 sin llave o con otra → 401", async () => {
    expect((await get("health")).status).toBe(200);
    expect((await get("v1/agent/products/PLY-NEG")).status).toBe(401);
    expect((await get("v1/agent/products/PLY-NEG", { key: "otra" })).status).toBe(401);
    expect(stockMockSnapshot().calls).toEqual([
      { path: "/v1/agent/products/PLY-NEG", authorized: false },
      { path: "/v1/agent/products/PLY-NEG", authorized: false },
    ]);
  });

  it("producto exacto con la forma pública; minúsculas valen; inactivo → 404", async () => {
    const r = await get("v1/agent/products/ply-neg", { key: KEY });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      sku: "PLY-NEG",
      name: "Playera negra",
      description: "Algodón 100%",
      stock: 7,
      unit: "pieza",
      price: 199,
      currency: "MXN",
      available: true,
      // Foto (feature 004 de MS-Stock): URL absoluta y pública, servida por
      // esta misma app en el entorno de pruebas.
      image_url: "http://localhost:3000/icon-192.png",
      // Tallas (feature 005): un producto simple las lleva vacías.
      variants: [],
      label: null,
      parent_sku: null,
    });
    const inactive = await get("v1/agent/products/GOR-02", { key: KEY });
    expect(inactive.status).toBe(404);
    expect((await inactive.json()).error.code).toBe("NOT_FOUND");
  });

  it("image_url: null en los productos sin foto, y en la búsqueda viaja igual que en el exacto", async () => {
    const gorra = await (await get("v1/agent/products/GOR-01", { key: KEY })).json();
    expect(gorra.image_url).toBeNull();
    const body = await (await get("v1/agent/search", { key: KEY, query: "q=playera" })).json();
    expect(body.results.map((p: { sku: string; image_url: string | null }) => [p.sku, p.image_url])).toEqual([
      ["PLY-NEG", "http://localhost:3000/icon-192.png"],
      ["PLY-BLA", null],
      ["PLY-ROJ", null],
      // 028: réplica del catálogo real; cada foto con URL distinta (dedupe por URL en el motor).
      ["PLA-AZL", "http://localhost:3000/icon-512.png?m=azl"],
      ["PLA-VRD", "http://localhost:3000/icon-192.png?m=vrd"],
      ["PLA-GRS", "http://localhost:3000/icon-512.png?m=grs"],
      ["PLA-AMA", "http://localhost:3000/icon-192.png?m=ama"],
    ]);
  });

  it("búsqueda sin acentos ni mayúsculas, q corta → 422, limit acota y marca truncated", async () => {
    const r = await get("v1/agent/search", { key: KEY, query: "q=PLÁYERA" });
    const body = await r.json();
    expect(body.results.map((p: { sku: string }) => p.sku)).toEqual([
      "PLY-NEG", "PLY-BLA", "PLY-ROJ", "PLA-AZL", "PLA-VRD", "PLA-GRS", "PLA-AMA",
    ]);
    expect(body.truncated).toBe(false);
    expect((await get("v1/agent/search", { key: KEY, query: "q=a" })).status).toBe(422);
    const limited = await (await get("v1/agent/search", { key: KEY, query: "q=gor&limit=1" })).json();
    expect(limited.results).toHaveLength(1);
    expect(limited.truncated).toBe(false); // GOR-02 es inactiva: solo hay una gorra
  });

  it("tallas (005): el modelo lleva variants en orden; el SKU de una talla devuelve la talla; buscar por SKU de talla devuelve el modelo", async () => {
    const roja = await (await get("v1/agent/products/ply-roj", { key: KEY })).json();
    expect(roja.stock).toBe(12);
    expect(roja.label).toBeNull();
    expect(roja.parent_sku).toBeNull();
    expect(roja.variants).toEqual([
      { sku: "PLY-ROJ-CH", label: "CH", stock: 4, available: true },
      { sku: "PLY-ROJ-M", label: "M", stock: 0, available: false },
      { sku: "PLY-ROJ-G", label: "G", stock: 7, available: true },
      { sku: "PLY-ROJ-XG", label: "XG", stock: 1, available: true },
    ]);
    const g = await (await get("v1/agent/products/PLY-ROJ-G", { key: KEY })).json();
    expect(g).toMatchObject({
      sku: "PLY-ROJ-G",
      name: "Playera roja",
      price: 219,
      stock: 7,
      available: true,
      variants: [],
      label: "G",
      parent_sku: "PLY-ROJ",
    });
    expect((await get("v1/agent/products/PLY-ROJ-XXG", { key: KEY })).status).toBe(404);
    const found = await (await get("v1/agent/search", { key: KEY, query: "q=PLY-ROJ-G" })).json();
    expect(found.results.map((p: { sku: string }) => p.sku)).toEqual(["PLY-ROJ"]);
  });

  it("028: el plural de la consulta encuentra el nombre en singular (misma regla que MS-Stock)", async () => {
    const plural = await (await get("v1/agent/search", { key: KEY, query: "q=playeras&limit=25" })).json();
    expect(plural.results.map((p: { sku: string }) => p.sku)).toEqual([
      "PLY-NEG", "PLY-BLA", "PLY-ROJ", "PLA-AZL", "PLA-VRD", "PLA-GRS", "PLA-AMA",
    ]);
    const pantalones = await (await get("v1/agent/search", { key: KEY, query: "q=pantalones" })).json();
    expect(pantalones.results.map((p: { sku: string }) => p.sku)).toEqual(["PAN-AZ", "PAN-NG"]);
    const negras = await (await get("v1/agent/search", { key: KEY, query: "q=playeras+negras" })).json();
    expect(negras.results.map((p: { sku: string }) => p.sku)).toEqual(["PLY-NEG"]);
    expect((await (await get("v1/agent/search", { key: KEY, query: "q=zapatos" })).json()).results).toEqual([]);
  });

  it("028: los modelos nuevos llevan sus tallas; el SKU de una talla devuelve la talla (incluidas numéricas)", async () => {
    const gris = await (await get("v1/agent/products/PLA-GRS", { key: KEY })).json();
    expect(gris).toMatchObject({ price: 250, stock: 7, image_url: "http://localhost:3000/icon-512.png?m=grs" });
    expect(gris.variants).toEqual([
      { sku: "PLA-GRS-M", label: "M", stock: 0, available: false },
      { sku: "PLA-GRS-G", label: "G", stock: 3, available: true },
      { sku: "PLA-GRS-XG", label: "XG", stock: 4, available: true },
    ]);
    const g = await (await get("v1/agent/products/PLA-GRS-G", { key: KEY })).json();
    expect(g).toMatchObject({ sku: "PLA-GRS-G", label: "G", parent_sku: "PLA-GRS", stock: 3, variants: [] });
    const t32 = await (await get("v1/agent/products/PAN-AZ-32", { key: KEY })).json();
    expect(t32).toMatchObject({ sku: "PAN-AZ-32", name: "Pantalón azul", label: "32", parent_sku: "PAN-AZ", stock: 4 });
    expect((await get("v1/agent/products/PAN-NG", { key: KEY })).status).toBe(200);
    const negro = await (await get("v1/agent/products/PAN-NG", { key: KEY })).json();
    expect(negro.image_url).toBeNull();
  });

  it("modo down → 503 en /v1 y /health; unauthorized → 401 aunque la llave sea buena; garbage → no JSON", async () => {
    await setMode("down");
    expect((await get("health")).status).toBe(503);
    expect((await get("v1/agent/products/PLY-NEG", { key: KEY })).status).toBe(503);
    await setMode("unauthorized");
    expect((await get("v1/agent/products/PLY-NEG", { key: KEY })).status).toBe(401);
    await setMode("garbage");
    expect(await (await get("v1/agent/products/PLY-NEG", { key: KEY })).text()).toBe("not json");
    expect((await setMode("otro")).status).toBe(422);
  });

  it("portal/sso verifica el pase y registra a quién dejó entrar", async () => {
    const token = await new SignJWT({ name: "Gerardo", next: "/portal/products/PLY-NEG" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("http://localhost:3000")
      .setAudience(BASE)
      .setSubject("usr_1")
      .setJti("11111111-1111-1111-1111-111111111111")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(new TextEncoder().encode(SECRET));
    const r = await get("portal/sso", { query: `token=${encodeURIComponent(token)}` });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Gerardo desde Uniko");
    expect(stockMockSnapshot().lastSso).toMatchObject({
      iss: "http://localhost:3000",
      aud: BASE,
      sub: "usr_1",
      name: "Gerardo",
      next: "/portal/products/PLY-NEG",
    });
  });

  it("portal/sso rechaza otro secreto y otra audiencia", async () => {
    const mk = (secret: string, aud: string) =>
      new SignJWT({ name: "X" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("http://localhost:3000")
        .setAudience(aud)
        .setSubject("u")
        .setJti("22222222-2222-2222-2222-222222222222")
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(new TextEncoder().encode(secret));
    const bad = await get("portal/sso", { query: `token=${await mk("o".repeat(40), BASE)}` });
    expect(bad.status).toBe(400);
    const wrongAud = await get("portal/sso", { query: `token=${await mk(SECRET, "http://otra")}` });
    expect(wrongAud.status).toBe(400);
    expect(stockMockSnapshot().lastSso).toBeNull();
  });
});

/**
 * 032 — El catálogo PDF del negocio (contrato §4b de MS-Stock): misma llave y mismos
 * modos infelices que el resto de `/v1/agent/*`, conmutable con `_catalog`, y una URL
 * que cambia con cada catálogo puesto (como un reemplazo real). El PDF se sirve sin
 * llave, como lo sirve el almacenamiento público de MS-Stock.
 */
describe("032 — stock-mock: catálogo PDF", () => {
  beforeEach(() => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STOCK_API_KEY", KEY);
    vi.stubEnv("STOCK_SSO_SECRET", SECRET);
    vi.stubEnv("STOCK_BASE_URL", BASE);
    resetStockMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetStockMock();
  });

  it("sin llave → 401 y queda registrado; con llave → la forma del contrato con la URL versionada", async () => {
    expect((await get("v1/agent/catalog")).status).toBe(401);
    const r = await get("v1/agent/catalog", { key: KEY });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      url: "http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=1",
      filename: "Catálogo de prueba.pdf",
      updated_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.updated_at))).toBe(false);
    expect(stockMockSnapshot().calls).toEqual([
      { path: "/v1/agent/catalog", authorized: false },
      { path: "/v1/agent/catalog", authorized: true },
    ]);
    expect(stockMockSnapshot().catalog).toMatchObject({ filename: "Catálogo de prueba.pdf", version: 1 });
  });

  it("_catalog lo quita (404 como MS-Stock) y lo vuelve a poner con otro nombre y otra URL", async () => {
    expect((await setCatalog({ present: false })).status).toBe(200);
    const sin = await get("v1/agent/catalog", { key: KEY });
    expect(sin.status).toBe(404);
    expect(await sin.json()).toEqual({ error: { code: "NOT_FOUND", message: "No hay catálogo." } });

    expect((await setCatalog({ present: true, filename: "Catálogo Otoño 2026.pdf" })).status).toBe(200);
    const otro = await (await get("v1/agent/catalog", { key: KEY })).json();
    expect(otro.filename).toBe("Catálogo Otoño 2026.pdf");
    expect(otro.url).toBe("http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=2");

    // Presente sin nombre: conserva el que tenía; la URL vuelve a cambiar.
    await setCatalog({ present: true });
    const igual = await (await get("v1/agent/catalog", { key: KEY })).json();
    expect(igual.filename).toBe("Catálogo Otoño 2026.pdf");
    expect(igual.url).toBe("http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=3");
  });

  it("_catalog con un cuerpo fuera de forma → 422 y el catálogo no cambia", async () => {
    const malos: unknown[] = [
      {},
      { present: "sí" },
      { present: true, filename: "catalogo.docx" },
      { present: true, filename: "x.pd" },
      { present: true, filename: `${"x".repeat(97)}.pdf` },
    ];
    for (const body of malos) {
      const r = await setCatalog(body);
      expect(r.status, JSON.stringify(body).slice(0, 60)).toBe(422);
      expect((await r.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(stockMockSnapshot().catalog).toMatchObject({ filename: "Catálogo de prueba.pdf", version: 1 });
  });

  it("los modos infelices aplican al catálogo como al resto de /v1/agent/*", async () => {
    await setMode("down");
    expect((await get("v1/agent/catalog", { key: KEY })).status).toBe(503);
    await setMode("unauthorized");
    expect((await get("v1/agent/catalog", { key: KEY })).status).toBe(401);
    await setMode("garbage");
    expect(await (await get("v1/agent/catalog", { key: KEY })).text()).toBe("not json");
  });

  it("catalogo.pdf es público (sin llave ni modos infelices) y es un PDF de verdad", async () => {
    await setMode("down");
    const r = await get("catalogo.pdf");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    const pdf = await r.text();
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    // El visor del navegador lo abre: `startxref` apunta a la tabla `xref`.
    const start = Number(/startxref\s+(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(start, start + 4)).toBe("xref");
    expect(stockMockSnapshot().calls).toEqual([]);
  });

  it("_reset vuelve al catálogo de prueba con v=1", async () => {
    await setCatalog({ present: true, filename: "Otro.pdf" });
    await setCatalog({ present: false });
    resetStockMock();
    const body = await (await get("v1/agent/catalog", { key: KEY })).json();
    expect(body.filename).toBe("Catálogo de prueba.pdf");
    expect(body.url).toBe("http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=1");
  });

  it("en producción no existe: v1/agent/catalog, catalogo.pdf y _catalog → 404", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("v1/agent/catalog", { key: KEY })).status).toBe(404);
    expect((await get("catalogo.pdf")).status).toBe(404);
    expect((await setCatalog({ present: false })).status).toBe(404);
  });

  /**
   * Las dos categorías del cierre de check_stock (FR-1710): más de 10 con existencia
   * (12 calcetines, cada uno con su foto) y de 6 a 10 (7 sudaderas, sin foto). Van al
   * final del catálogo y no coinciden con ninguna búsqueda anterior.
   */
  it("«calcetines» trae 12 con existencia y foto distinta; «sudaderas» 7 sin foto; sin recorte", async () => {
    type Pub = { sku: string; stock: number; available: boolean; image_url: string | null };
    const cal = await (await get("v1/agent/search", { key: KEY, query: "q=calcetines&limit=25" })).json();
    expect(cal.results.map((p: Pub) => p.sku)).toEqual(
      Array.from({ length: 12 }, (_, i) => `CAL-${String(i + 1).padStart(2, "0")}`)
    );
    expect(cal.truncated).toBe(false);
    expect(cal.results.every((p: Pub) => p.stock > 0 && p.available)).toBe(true);
    expect(new Set(cal.results.map((p: Pub) => p.image_url)).size).toBe(12);
    expect(cal.results[0].image_url).toBe("http://localhost:3000/icon-192.png?m=cal01");

    const singular = await (await get("v1/agent/search", { key: KEY, query: "q=calcetin&limit=25" })).json();
    expect(singular.results).toHaveLength(12);

    const sud = await (await get("v1/agent/search", { key: KEY, query: "q=sudaderas&limit=25" })).json();
    expect(sud.results.map((p: Pub) => p.sku)).toEqual(
      Array.from({ length: 7 }, (_, i) => `SUD-0${i + 1}`)
    );
    expect(sud.truncated).toBe(false);
    expect(sud.results.every((p: Pub) => p.stock > 0 && p.image_url === null)).toBe(true);
  });

  it("las categorías nuevas no se cuelan en las búsquedas de siempre", async () => {
    const skus = async (q: string) =>
      (await (await get("v1/agent/search", { key: KEY, query: `q=${q}&limit=25` })).json()).results.map(
        (p: { sku: string }) => p.sku
      );
    expect(await skus("playera+negra")).toEqual(["PLY-NEG"]);
    expect(await skus("pantalones")).toEqual(["PAN-AZ", "PAN-NG"]);
    expect(await skus("gorra")).toEqual(["GOR-01"]);
    expect(await skus("zapatos")).toEqual([]);
  });
});
