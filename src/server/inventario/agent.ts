import { lookup, type StockProduct } from "@/server/inventario/client";

/**
 * 026 — Lo que el agente incluido puede hacer con el inventario: consultar.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de inventarios:
 * el turno pide "consulta esto" y recibe el texto que hay que mandar (FR-1111).
 *
 * Regla que atraviesa todo: el modelo NO redacta existencias ni precios. Pide
 * consultar, y el sistema pega los datos reales. Si MS-Stock no responde, el
 * turno lo dice con `ok: false` y el pipeline degrada (FR-1112) — nunca se
 * afirma una existencia que no vino de la consulta.
 */

export type StockTurn = {
  /** Lo que hay que enviarle al cliente (vacío si no hay ni datos ni frase). */
  text: string;
  /** false ⇒ el conector falló; el turno sigue, sin inventario. */
  ok: boolean;
};

export async function checkStockTurn(input: {
  query: string;
  intro?: string;
}): Promise<StockTurn> {
  const intro = input.intro?.trim() ?? "";
  const found = await lookup(input.query);
  if (!found.ok) {
    // Motivo tipado, sin la consulta completa ni la llave: basta para
    // diagnosticar en el log del servidor (FR-1112).
    console.error(`[agente] inventario: ${found.error} al consultar MS-Stock`);
    return { ok: false, text: intro };
  }
  const { products, truncated } = found.data;
  if (products.length === 0) {
    return { ok: true, text: `No encontré productos para «${input.query.trim()}».` };
  }
  const lines = products.map(formatProduct);
  if (truncated) lines.push("Hay más coincidencias, ¿me dices cuál te interesa?");
  return { ok: true, text: [intro, ...lines].filter(Boolean).join("\n") };
}

/** `Playera negra (PLY-NEG): 7 pieza — $199 MXN` · agotado · sin precio. */
export function formatProduct(p: StockProduct): string {
  const existencia = p.stock > 0 ? `${formatQuantity(p.stock)} ${p.unit}` : "agotado";
  const precio = p.price === null ? "sin precio" : formatPrice(p.price, p.currency);
  return `${p.name} (${p.sku}): ${existencia} — ${precio}`;
}

function formatQuantity(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(n);
}

function formatPrice(amount: number, currency: string): string {
  // "$1,234.50 MXN": el símbolo lo pone Intl y el código va explícito porque
  // "$" es ambiguo entre monedas.
  try {
    // Enteros sin centavos ("$199"); con fracción, siempre dos ("$1,234.50").
    const decimals = Number.isInteger(amount) ? 0 : 2;
    const formatted = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
    return `${formatted} ${currency}`;
  } catch {
    // Moneda que Intl no conoce: número y código, sin símbolo.
    return `${formatQuantity(amount)} ${currency}`;
  }
}
