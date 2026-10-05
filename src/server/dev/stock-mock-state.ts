/**
 * 026 — Estado del MS-Stock de mentira (solo entorno de pruebas).
 *
 * Existe para que el self-test pueda AFIRMAR sobre lo que el conector le pidió
 * al servicio de inventario (qué buscó, con qué llave, si el pase SSO llegó
 * con el nombre correcto) y para poner el servicio en un modo infeliz
 * (`down`, `unauthorized`, `slow`, `garbage`) sin tumbar nada real.
 *
 * El catálogo es fijo y pequeño a propósito: lo que se prueba es la mecánica
 * (consultar, pegar, degradar), no el inventario de nadie.
 */

export type StockMockMode = "ok" | "unauthorized" | "down" | "slow" | "garbage";

export type MockProduct = {
  sku: string;
  name: string;
  description: string | null;
  stock: number;
  unit: string;
  price: number | null;
  currency: string;
  active: boolean;
  /**
   * Foto principal (feature 004 de MS-Stock): ruta pública dentro de ESTA app
   * (un PNG real que el navegador puede pintar), o null. La URL absoluta se
   * arma con el origen de la petición, como haría MS-Stock con su CDN.
   */
  imagePath: string | null;
  /**
   * Tallas (feature 005 de MS-Stock): un modelo lleva sus tallas en el orden del
   * negocio, cada una con SKU derivado `<modelo>-<etiqueta>` y su propia
   * existencia; `stock` del modelo = suma de sus tallas.
   */
  variants?: { label: string; stock: number }[];
};

export const STOCK_MOCK_CATALOG: MockProduct[] = [
  { sku: "PLY-NEG", name: "Playera negra", description: "Algodón 100%", stock: 7, unit: "pieza", price: 199, currency: "MXN", active: true, imagePath: "/icon-192.png" },
  { sku: "PLY-BLA", name: "Playera blanca", description: null, stock: 0, unit: "pieza", price: 199, currency: "MXN", active: true, imagePath: null },
  { sku: "GOR-01", name: "Gorra", description: null, stock: 3, unit: "pieza", price: null, currency: "MXN", active: true, imagePath: null },
  { sku: "TAZ-01", name: "Taza", description: "Cerámica", stock: 12, unit: "pieza", price: 89, currency: "MXN", active: true, imagePath: "/icon-512.png" },
  { sku: "GOR-02", name: "Gorra vieja", description: null, stock: 1, unit: "pieza", price: 50, currency: "MXN", active: false, imagePath: "/icon-192.png" },
  // Modelo con tallas (005): va al final para no mover el orden de las búsquedas previas.
  { sku: "PLY-ROJ", name: "Playera roja", description: null, stock: 12, unit: "pieza", price: 219, currency: "MXN", active: true, imagePath: null, variants: [
    { label: "CH", stock: 4 },
    { label: "M", stock: 0 },
    { label: "G", stock: 7 },
    { label: "XG", stock: 1 },
  ] },
  // 028: réplica del catálogo real (tallas cruzadas, fotos con URL distinta por modelo,
  // una talla que solo un modelo trae, una agotada en unos y con existencia en otros,
  // y más de cinco con existencia). También al final, por el mismo motivo.
  { sku: "PLA-AZL", name: "Playera azul", description: null, stock: 8, unit: "pieza", price: 800, currency: "MXN", active: true, imagePath: "/icon-512.png?m=azl", variants: [
    { label: "XCH", stock: 1 },
    { label: "CH", stock: 5 },
    { label: "XG", stock: 2 },
  ] },
  { sku: "PLA-VRD", name: "Playera verde", description: null, stock: 22, unit: "pieza", price: 200, currency: "MXN", active: true, imagePath: "/icon-192.png?m=vrd", variants: [
    { label: "CH", stock: 2 },
    { label: "M", stock: 10 },
    { label: "XG", stock: 10 },
  ] },
  { sku: "PLA-GRS", name: "Playera gris", description: null, stock: 7, unit: "pieza", price: 250, currency: "MXN", active: true, imagePath: "/icon-512.png?m=grs", variants: [
    { label: "M", stock: 0 },
    { label: "G", stock: 3 },
    { label: "XG", stock: 4 },
  ] },
  { sku: "PLA-AMA", name: "Playera amarilla", description: null, stock: 1, unit: "pieza", price: 150, currency: "MXN", active: true, imagePath: "/icon-192.png?m=ama", variants: [
    { label: "CH", stock: 1 },
  ] },
  { sku: "PAN-AZ", name: "Pantalón azul", description: null, stock: 6, unit: "pieza", price: 650, currency: "MXN", active: true, imagePath: "/icon-512.png?m=pan", variants: [
    { label: "30", stock: 2 },
    { label: "32", stock: 4 },
    { label: "34", stock: 0 },
  ] },
  { sku: "PAN-NG", name: "Pantalón negro", description: null, stock: 6, unit: "pieza", price: 650, currency: "MXN", active: true, imagePath: null, variants: [
    { label: "32", stock: 1 },
    { label: "34", stock: 3 },
    { label: "36", stock: 2 },
  ] },
];

/**
 * 028 — Misma regla que `singular_candidates` de MS-Stock (ajuste a FR-017 de su 001):
 * cada palabra de cuatro letras o más pierde la `s` final y, si termina en `es`,
 * también `es`; a lo sumo dos candidatos distintos de la frase original.
 */
export function singularCandidates(needle: string): string[] {
  const words = needle.split(" ");
  const variant = (stripEs: boolean) =>
    words
      .map((w) => {
        if (w.length >= 4 && stripEs && w.endsWith("es")) return w.slice(0, -2);
        if (w.length >= 4 && w.endsWith("s")) return w.slice(0, -1);
        return w;
      })
      .join(" ");
  const out: string[] = [];
  for (const c of [variant(false), variant(true)]) {
    if (c !== needle && !out.includes(c)) out.push(c);
  }
  return out;
}

export function variantSku(model: MockProduct, label: string): string {
  return `${model.sku}-${label.toUpperCase()}`;
}

export type LastSso = {
  iss: string;
  aud: string;
  sub: string;
  name: string;
  jti: string;
  next?: string;
  exp: number;
  iat: number;
};

/**
 * 032 — El catálogo PDF del negocio (contrato §4b de MS-Stock). `version` viaja en la
 * URL (`catalogo.pdf?v=<n>`) y sube cada vez que se pone un catálogo: como en
 * MS-Stock, un reemplazo cambia la URL y el motor nunca debe mandar la vieja.
 */
export type MockCatalog = { filename: string; updatedAt: string; version: number };

export const MOCK_CATALOG_FILENAME = "Catálogo de prueba.pdf";
const MOCK_CATALOG_UPDATED_AT = "2026-10-04T18:00:00.000Z";

type MockState = {
  mode: StockMockMode;
  lastSso: LastSso | null;
  calls: { path: string; authorized: boolean }[];
  /** 032 — `null` ⇒ «no hay catálogo» (404, como MS-Stock). */
  catalog: MockCatalog | null;
  /** La última versión entregada: un catálogo puesto otra vez nunca repite URL. */
  catalogVersion: number;
};

const globalForMock = globalThis as unknown as { __stockMock?: MockState };

function defaultCatalog(): MockCatalog {
  return { filename: MOCK_CATALOG_FILENAME, updatedAt: MOCK_CATALOG_UPDATED_AT, version: 1 };
}

export function stockMockState(): MockState {
  if (!globalForMock.__stockMock) {
    globalForMock.__stockMock = {
      mode: "ok",
      lastSso: null,
      calls: [],
      catalog: defaultCatalog(),
      catalogVersion: 1,
    };
  }
  // Un estado creado antes de la 032 (recarga en caliente de `next dev`) no trae el
  // catálogo: se completa en vez de fallar.
  const s = globalForMock.__stockMock as MockState & { catalogVersion?: number };
  if (s.catalogVersion === undefined) {
    s.catalog = defaultCatalog();
    s.catalogVersion = 1;
  }
  return s;
}

export function resetStockMock(): void {
  const s = stockMockState();
  s.mode = "ok";
  s.lastSso = null;
  s.calls.length = 0;
  s.catalog = defaultCatalog();
  s.catalogVersion = 1;
}

export function setStockMockMode(mode: StockMockMode): void {
  stockMockState().mode = mode;
}

/** 032 — Pone el catálogo (con el nombre dado, o el que ya tenía) o lo quita. */
export function setStockMockCatalog(present: boolean, filename?: string): void {
  const s = stockMockState();
  if (!present) {
    s.catalog = null;
    return;
  }
  s.catalogVersion += 1;
  s.catalog = {
    filename: filename ?? s.catalog?.filename ?? MOCK_CATALOG_FILENAME,
    updatedAt: new Date().toISOString(),
    version: s.catalogVersion,
  };
}

export function stockMockSnapshot(): MockState {
  const s = stockMockState();
  return {
    mode: s.mode,
    lastSso: s.lastSso,
    calls: [...s.calls],
    catalog: s.catalog,
    catalogVersion: s.catalogVersion,
  };
}

/**
 * 032 — Un PDF mínimo pero válido (una página), con los offsets de `xref`
 * calculados para que el visor del navegador lo abra desde la bandeja. Solo ASCII:
 * cada carácter es un byte, así que `length` es el offset.
 */
function buildMockCatalogPdf(): string {
  const content = "BT /F1 24 Tf 72 760 Td (Catalogo de prueba - Uniko, entorno de pruebas) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export const MOCK_CATALOG_PDF = buildMockCatalogPdf();

/** Misma normalización que MS-Stock: sin acentos, sin mayúsculas. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Forma pública, la misma que `/v1/agent/*` de MS-Stock (contrato §4). Con `label`,
 * es la talla de ese modelo como producto: hereda nombre, precio y foto del modelo;
 * existencia propia; `variants` vacía; `parent_sku` el del modelo.
 */
export function toPublic(p: MockProduct, origin: string, label?: string) {
  const image_url = p.imagePath ? `${origin}${p.imagePath}` : null;
  const base = {
    name: p.name,
    description: p.description,
    unit: p.unit,
    price: p.price,
    currency: p.currency,
    image_url,
  };
  const talla = label ? p.variants?.find((v) => v.label === label) : undefined;
  if (label && talla) {
    return {
      sku: variantSku(p, label),
      ...base,
      stock: talla.stock,
      available: talla.stock > 0,
      variants: [],
      label: talla.label,
      parent_sku: p.sku,
    };
  }
  const variants = (p.variants ?? []).map((v) => ({
    sku: variantSku(p, v.label),
    label: v.label,
    stock: v.stock,
    available: v.stock > 0,
  }));
  return { sku: p.sku, ...base, stock: p.stock, available: p.stock > 0, variants, label: null, parent_sku: null };
}

/** Modelo o producto simple activo por SKU; o la talla activa (`{ model, label }`). */
export function findActiveBySku(sku: string): MockProduct | undefined {
  const canonical = sku.trim().toUpperCase();
  return STOCK_MOCK_CATALOG.find((p) => p.active && p.sku === canonical);
}

export function findActiveVariantBySku(sku: string): { model: MockProduct; label: string } | undefined {
  const canonical = sku.trim().toUpperCase();
  for (const p of STOCK_MOCK_CATALOG) {
    if (!p.active) continue;
    const v = p.variants?.find((x) => variantSku(p, x.label) === canonical);
    if (v) return { model: p, label: v.label };
  }
  return undefined;
}

/**
 * Como MS-Stock (005): coincide por nombre o SKU del padre, o por SKU de una talla;
 * y (028) el nombre también se prueba con los candidatos en singular de la consulta.
 */
export function searchActive(q: string, limit: number): { results: MockProduct[]; truncated: boolean } {
  const needle = normalize(q);
  const byName = [needle, ...singularCandidates(needle)];
  const matches = STOCK_MOCK_CATALOG.filter(
    (p) =>
      p.active &&
      (byName.some((n) => normalize(p.name).includes(n)) ||
        normalize(p.sku).includes(needle) ||
        (p.variants ?? []).some((v) => normalize(variantSku(p, v.label)).includes(needle)))
  );
  return { results: matches.slice(0, limit), truncated: matches.length > limit };
}
