import { z } from "zod";
import { getEnv } from "@/lib/env";

/**
 * 026 — Adaptador de MS-Stock (FR-1110, FR-1114). Es el ÚNICO módulo que
 * conoce las rutas y la forma HTTP del servicio de inventario; el dominio pide
 * "busca esto" y recibe datos o un motivo de fallo tipado.
 *
 * Contrato del otro lado: ../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md
 * (§4). Tres reglas que atraviesan todo:
 *  - 3 s por llamada y sin reintentos dentro del turno: el cliente está esperando
 *    en WhatsApp y un inventario lento no puede volverse un agente mudo.
 *  - Nunca lanza. El pipeline decide qué hacer con cada `error` (degradar).
 *  - La llave viaja solo en `X-API-Key` y jamás en un log.
 */

export const TIMEOUT_MS = 3_000;
/** Cuántas coincidencias se le enseñan al cliente (el contrato admite hasta 25). */
export const SEARCH_LIMIT = 5;

export const stockProductSchema = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  stock: z.number(),
  unit: z.string(),
  price: z.number().nullable(),
  currency: z.string(),
  available: z.boolean(),
});
export type StockProduct = z.infer<typeof stockProductSchema>;

export const searchResultSchema = z.object({
  results: z.array(stockProductSchema),
  truncated: z.boolean(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export type StockError =
  | "not_found"
  | "unauthorized"
  | "unavailable"
  | "timeout"
  | "invalid"
  | "network";

export type StockResult<T> = { ok: true; data: T } | { ok: false; error: StockError };

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

/** Sin espacios ni signos: lo que MS-Stock aceptaría como SKU. */
export function looksLikeSku(query: string): boolean {
  return SKU_RE.test(query);
}

function baseUrl(): string {
  const url = getEnv().STOCK_BASE_URL;
  if (!url) throw new Error("STOCK_BASE_URL no configurada");
  return url;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  opts: { auth: boolean }
): Promise<StockResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth) headers["x-api-key"] = getEnv().STOCK_API_KEY ?? "";
    const res = await fetch(`${baseUrl()}${path}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (res.status === 401) return { ok: false, error: "unauthorized" };
    if (res.status === 422) return { ok: false, error: "invalid" };
    if (!res.ok) return { ok: false, error: "unavailable" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: "invalid" };
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return { ok: true, data: parsed.data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    // Sin la llave y sin la URL completa: el motivo basta para diagnosticar.
    console.error(`[inventario] MS-Stock inalcanzable en ${path}: ${describe(err)}`);
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** `GET /v1/agent/products/{sku}` — solo productos activos; el SKU va canónico. */
export function getProduct(sku: string): Promise<StockResult<StockProduct>> {
  return request(
    `/v1/agent/products/${encodeURIComponent(sku.trim().toUpperCase())}`,
    stockProductSchema,
    { auth: true }
  );
}

/** `GET /v1/agent/search?q=&limit=` — nombre o SKU, sin acentos ni mayúsculas. */
export function searchProducts(
  query: string,
  limit: number = SEARCH_LIMIT
): Promise<StockResult<SearchResult>> {
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  return request(`/v1/agent/search?${params}`, searchResultSchema, { auth: true });
}

/**
 * Lo que el agente necesita: si la consulta tiene forma de SKU, primero el
 * producto exacto; si no existe (o no la tiene), la búsqueda.
 */
export async function lookup(
  query: string
): Promise<StockResult<{ products: StockProduct[]; truncated: boolean }>> {
  const q = query.trim();
  if (looksLikeSku(q)) {
    const exact = await getProduct(q);
    if (exact.ok) return { ok: true, data: { products: [exact.data], truncated: false } };
    if (exact.error !== "not_found") return exact;
  }
  const found = await searchProducts(q);
  if (!found.ok) return found;
  return { ok: true, data: { products: found.data.results, truncated: found.data.truncated } };
}

const healthSchema = z.object({ status: z.string() });

/** `GET /health` — sin llave; 200 ⇒ servicio y base arriba. */
export async function health(): Promise<StockResult<true>> {
  const r = await request("/health", healthSchema, { auth: false });
  if (!r.ok) return r.error === "not_found" ? { ok: false, error: "unavailable" } : r;
  return { ok: true, data: true };
}
