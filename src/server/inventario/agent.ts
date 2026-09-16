import { lookup, type StockProduct, type StockVariant } from "@/server/inventario/client";

/**
 * 026 — Lo que el agente incluido puede hacer con el inventario: consultar.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de inventarios:
 * el turno pide "consulta esto" y recibe lo que hay que mandar (FR-1111).
 *
 * Regla que atraviesa todo: el modelo NO redacta existencias ni precios. Pide
 * consultar, y el sistema pega los datos reales. Si MS-Stock no responde, el
 * turno lo dice con `ok: false` y el pipeline degrada (FR-1112) — nunca se
 * afirma una existencia que no vino de la consulta.
 *
 * Tallas (extensión 2026-09-14, FR-1124): un modelo con tallas se responde en una
 * línea con la existencia de cada talla; si el cliente pidió una talla (`size`),
 * con la de esa talla. El modelo tampoco redacta esto: solo separa nombre base y
 * talla.
 *
 * 028 — El turno ya no es "un texto y a lo sumo una foto" sino una LISTA de
 * mensajes en orden (`messages`), cada uno con su texto y, si el producto la
 * tiene, su foto (FR-1301..FR-1308). Con un solo producto resuelto la lista tiene
 * un elemento con el texto de siempre (FR-1302): nada de la 026 cambia ahí.
 */

/** Un mensaje que hay que mandar, en orden. Texto (o pie, si hay foto) y foto por URL. */
export type StockMessage = {
  text: string;
  /**
   * Foto del producto de esta línea (contrato §4), o null ⇒ texto. Va aparte del
   * texto a propósito: la manda el motor como mensaje de imagen, nunca el modelo
   * ni el texto (FR-1121).
   */
  imageUrl: string | null;
};

export type StockTurn = {
  /** false ⇒ el conector falló; el turno sigue, sin inventario (FR-1112). */
  ok: boolean;
  /** Lo que hay que enviarle al cliente, en orden (vacío si no hay ni datos ni frase). */
  messages: StockMessage[];
};

/** Productos mostrados a lo sumo por turno (FR-1308). */
export const SHOW_LIMIT = 5;
/** Imágenes a lo sumo por turno (FR-1305): tope explícito, no una prohibición. */
export const MAX_PHOTOS = 5;

const HAY_MAS = "Hay más coincidencias, ¿me dices cuál te interesa?";

export async function checkStockTurn(input: {
  query: string;
  size?: string;
  intro?: string;
}): Promise<StockTurn> {
  const intro = input.intro?.trim() ?? "";
  const size = input.size?.trim() ?? "";
  const found = await lookup(input.query);
  if (!found.ok) {
    // Motivo tipado, sin la consulta completa ni la llave: basta para
    // diagnosticar en el log del servidor (FR-1112).
    console.error(`[agente] inventario: ${found.error} al consultar MS-Stock`);
    return { ok: false, messages: intro ? [{ text: intro, imageUrl: null }] : [] };
  }
  const { products, truncated } = found.data;
  if (products.length === 0) {
    return {
      ok: true,
      messages: [{ text: `No encontré productos para «${input.query.trim()}».`, imageUrl: null }],
    };
  }
  const lines = products.map((p) => formatProduct(p, size));
  if (truncated) lines.push(HAY_MAS);
  return {
    ok: true,
    messages: withIntro(intro, [
      { text: lines.join("\n"), imageUrl: products[0]?.image_url ?? null },
    ]),
  };
}

/** La frase de entrada del modelo va al frente del primer mensaje; nunca sola (FR-1305). */
function withIntro(intro: string, messages: StockMessage[]): StockMessage[] {
  if (!intro) return messages;
  const [first, ...rest] = messages;
  if (!first) return [{ text: intro, imageUrl: null }];
  return [{ ...first, text: `${intro}\n${first.text}` }, ...rest];
}

/**
 * Una línea por producto, siempre redactada por el sistema:
 * - simple: `Playera negra (PLY-NEG): 7 pieza — $199 MXN` · agotado · sin precio;
 * - talla resuelta por SKU: `Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN`;
 * - modelo sin talla pedida: `Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1`;
 * - modelo con talla pedida: la existencia de esa talla; "agotada" más las que sí
 *   hay; o "no viene en talla X" más las que tiene.
 */
export function formatProduct(p: StockProduct, size: string = ""): string {
  const precio = p.price === null ? "sin precio" : formatPrice(p.price, p.currency);
  if (p.label !== null) {
    return `${p.name} (${p.sku}) talla ${p.label}: ${existenciaDe(p.stock, p.unit)} — ${precio}`;
  }
  if (p.variants.length === 0) {
    return `${p.name} (${p.sku}): ${existenciaDe(p.stock, p.unit)} — ${precio}`;
  }
  const head = `${p.name} (${p.sku})`;
  if (!size) return `${head} — ${precio}. Tallas: ${listaTallas(p.variants)}`;
  const talla = matchVariant(p.variants, size);
  if (!talla) {
    return `${head} no viene en talla ${size}. Tallas: ${listaTallas(p.variants)}`;
  }
  if (talla.stock <= 0) {
    const otras = p.variants.filter((v) => v.stock > 0);
    const resto = otras.length > 0 ? ` Con existencia: ${listaTallas(otras)}` : "";
    return `${head} talla ${talla.label}: agotada — ${precio}.${resto}`;
  }
  return `${head} talla ${talla.label}: ${existenciaDe(talla.stock, p.unit)} — ${precio}`;
}

/** `CH 4, M agotada, G 7, XG 1` — en el orden del negocio, agotadas incluidas. */
function listaTallas(variants: StockVariant[]): string {
  return variants
    .map((v) => `${v.label} ${v.stock > 0 ? formatQuantity(v.stock) : "agotada"}`)
    .join(", ");
}

function existenciaDe(stock: number, unit: string): string {
  return stock > 0 ? `${formatQuantity(stock)} ${unit}` : "agotado";
}

/**
 * Equivalencias de respaldo cuando ninguna etiqueta coincide literalmente: las
 * etiquetas son las del negocio; esto solo traduce cómo la gente escribe la talla.
 */
const EQUIVALENCIAS: Record<string, string[]> = {
  xch: ["extra chica", "extrachica", "xs", "extra small"],
  ch: ["chica", "s", "small"],
  m: ["mediana", "medium", "med"],
  g: ["grande", "l", "large"],
  xg: ["extra grande", "extragrande", "xl", "extra large"],
  xxg: ["xxl", "extra extra grande", "doble extra"],
};

export function matchVariant(variants: StockVariant[], size: string): StockVariant | null {
  const wanted = normalize(size);
  if (!wanted) return null;
  const literal = variants.find((v) => normalize(v.label) === wanted);
  if (literal) return literal;
  const canon = Object.entries(EQUIVALENCIAS).find(([, words]) => words.includes(wanted))?.[0];
  if (!canon) return null;
  return variants.find((v) => normalize(v.label) === canon) ?? null;
}

/** Misma regla que MS-Stock: sin acentos, sin mayúsculas, espacios colapsados. */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
