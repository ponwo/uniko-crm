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
];

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

type MockState = {
  mode: StockMockMode;
  lastSso: LastSso | null;
  calls: { path: string; authorized: boolean }[];
};

const globalForMock = globalThis as unknown as { __stockMock?: MockState };

export function stockMockState(): MockState {
  if (!globalForMock.__stockMock) {
    globalForMock.__stockMock = { mode: "ok", lastSso: null, calls: [] };
  }
  return globalForMock.__stockMock;
}

export function resetStockMock(): void {
  const s = stockMockState();
  s.mode = "ok";
  s.lastSso = null;
  s.calls.length = 0;
}

export function setStockMockMode(mode: StockMockMode): void {
  stockMockState().mode = mode;
}

export function stockMockSnapshot(): MockState {
  const s = stockMockState();
  return { mode: s.mode, lastSso: s.lastSso, calls: [...s.calls] };
}

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

/** Como MS-Stock (005): coincide por nombre o SKU del padre, o por SKU de una talla. */
export function searchActive(q: string, limit: number): { results: MockProduct[]; truncated: boolean } {
  const needle = normalize(q);
  const matches = STOCK_MOCK_CATALOG.filter(
    (p) =>
      p.active &&
      (normalize(p.name).includes(needle) ||
        normalize(p.sku).includes(needle) ||
        (p.variants ?? []).some((v) => normalize(variantSku(p, v.label)).includes(needle)))
  );
  return { results: matches.slice(0, limit), truncated: matches.length > limit };
}
