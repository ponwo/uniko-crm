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
};

export const STOCK_MOCK_CATALOG: MockProduct[] = [
  { sku: "PLY-NEG", name: "Playera negra", description: "Algodón 100%", stock: 7, unit: "pieza", price: 199, currency: "MXN", active: true },
  { sku: "PLY-BLA", name: "Playera blanca", description: null, stock: 0, unit: "pieza", price: 199, currency: "MXN", active: true },
  { sku: "GOR-01", name: "Gorra", description: null, stock: 3, unit: "pieza", price: null, currency: "MXN", active: true },
  { sku: "TAZ-01", name: "Taza", description: "Cerámica", stock: 12, unit: "pieza", price: 89, currency: "MXN", active: true },
  { sku: "GOR-02", name: "Gorra vieja", description: null, stock: 1, unit: "pieza", price: 50, currency: "MXN", active: false },
];

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

/** Forma pública, la misma que `/v1/agent/*` de MS-Stock. */
export function toPublic(p: MockProduct) {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    stock: p.stock,
    unit: p.unit,
    price: p.price,
    currency: p.currency,
    available: p.stock > 0,
  };
}

export function findActiveBySku(sku: string): MockProduct | undefined {
  const canonical = sku.trim().toUpperCase();
  return STOCK_MOCK_CATALOG.find((p) => p.active && p.sku === canonical);
}

export function searchActive(q: string, limit: number): { results: MockProduct[]; truncated: boolean } {
  const needle = normalize(q);
  const matches = STOCK_MOCK_CATALOG.filter(
    (p) => p.active && (normalize(p.name).includes(needle) || normalize(p.sku).includes(needle))
  );
  return { results: matches.slice(0, limit), truncated: matches.length > limit };
}
