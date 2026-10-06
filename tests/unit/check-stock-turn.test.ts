import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogInfo,
  StockProduct,
  StockResult,
  StockVariant,
} from "@/server/inventario/client";

/**
 * 026 — El sistema pega los datos (FR-1111): formato pequeño y determinista;
 * y ante cualquier error del adaptador el turno dice `ok: false` para que el
 * pipeline degrade (FR-1112).
 *
 * 028 — El turno es una LISTA de mensajes (`messages`, cada uno con `text` y
 * `imageUrl`): con un producto, uno solo con el texto de siempre (FR-1302);
 * con varios, uno por producto mostrado (FR-1301, FR-1305, FR-1307). `textOf`
 * une los textos con "\n" para fijar las redacciones de la 026 tal cual.
 */

type Lookup = StockResult<{ products: StockProduct[]; truncated: boolean }>;
const lookup = vi.fn<(q: string) => Promise<Lookup>>();
/** 032 — El catálogo que consulta el cierre; por defecto no hay (el cierre de siempre). */
const getCatalog = vi.fn<() => Promise<StockResult<CatalogInfo>>>();
vi.mock("@/server/inventario/client", () => ({
  lookup: (q: string) => lookup(q),
  getCatalog: () => getCatalog(),
}));

const { checkStockTurn, selectProducts } = await import("@/server/inventario/agent");
type Turn = Awaited<ReturnType<typeof checkStockTurn>>;
/** Todo el texto del turno, en orden, como lo leería el cliente. */
const textOf = (turn: Turn) => turn.messages.map((m) => m.text).join("\n");
/** La foto del primer mensaje (la única que existía hasta la 028). */
const imageOf = (turn: Turn) => turn.messages[0]?.imageUrl ?? null;

const negra: StockProduct = {
  sku: "PLY-NEG",
  name: "Playera negra",
  description: null,
  stock: 7,
  unit: "pieza",
  price: 199,
  currency: "MXN",
  available: true,
  image_url: null,
  variants: [],
  label: null,
  parent_sku: null,
};
const FOTO = "https://img.stock.example/products/1/ply-neg.jpg";
/** Modelo con tallas (MS-Stock 005): existencia por talla, en el orden del negocio. */
const roja: StockProduct = {
  ...negra,
  sku: "PLY-ROJ",
  name: "Playera roja",
  price: 219,
  stock: 12,
  variants: [
    { sku: "PLY-ROJ-CH", label: "CH", stock: 4, available: true },
    { sku: "PLY-ROJ-M", label: "M", stock: 0, available: false },
    { sku: "PLY-ROJ-G", label: "G", stock: 7, available: true },
    { sku: "PLY-ROJ-XG", label: "XG", stock: 1, available: true },
  ],
};

/** Réplica del catálogo real de la instancia de pruebas (y del stock-mock, 028). */
const talla = (sku: string, label: string, stock: number): StockVariant => ({
  sku: `${sku}-${label}`,
  label,
  stock,
  available: stock > 0,
});
const modelo = (
  sku: string,
  name: string,
  price: number,
  tallas: [string, number][],
  image_url: string | null
): StockProduct => ({
  ...negra,
  sku,
  name,
  price,
  image_url,
  stock: tallas.reduce((acc, [, n]) => acc + n, 0),
  available: tallas.some(([, n]) => n > 0),
  variants: tallas.map(([label, n]) => talla(sku, label, n)),
});
const blanca: StockProduct = { ...negra, sku: "PLY-BLA", name: "Playera blanca", stock: 0, available: false };
const azul = modelo("PLA-AZL", "Playera azul", 800, [["XCH", 1], ["CH", 5], ["XG", 2]], "https://img.stock.example/azl.jpg");
const verde = modelo("PLA-VRD", "Playera verde", 200, [["CH", 2], ["M", 10], ["XG", 10]], "https://img.stock.example/vrd.jpg");
const gris = modelo("PLA-GRS", "Playera gris", 250, [["M", 0], ["G", 3], ["XG", 4]], "https://img.stock.example/grs.jpg");
const amarilla = modelo("PLA-AMA", "Playera amarilla", 150, [["CH", 1]], "https://img.stock.example/ama.jpg");
const pantalonAzul = modelo("PAN-AZ", "Pantalón azul", 650, [["30", 2], ["32", 4], ["34", 0]], "https://img.stock.example/pan.jpg");
const pantalonNegro = modelo("PAN-NG", "Pantalón negro", 650, [["32", 1], ["34", 3], ["36", 2]], null);
/** "playera" en el mock: 7 modelos, 6 con existencia, en orden de catálogo. */
const PLAYERAS = [{ ...negra, image_url: FOTO }, blanca, roja, azul, verde, gris, amarilla];

function con(products: StockProduct[], truncated = false) {
  lookup.mockResolvedValue({ ok: true, data: { products, truncated } });
}

// Con llaves a propósito: una función devuelta por `beforeEach` es un teardown y Vitest
// la llama al terminar cada test — devolver el espía lo invocaría (y contaría) de más.
beforeEach(() => {
  getCatalog.mockResolvedValue({ ok: false, error: "not_found" });
});
afterEach(() => {
  lookup.mockReset();
  getCatalog.mockReset();
});

describe("026 — checkStockTurn", () => {
  it("un producto: una línea con existencia, unidad y precio con moneda", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [negra], truncated: false } });
    const turn = await checkStockTurn({ query: "playera negra" });
    expect(turn.ok).toBe(true);
    expect(textOf(turn)).toBe("Playera negra (PLY-NEG): 7 pieza — $199 MXN");
    expect(lookup).toHaveBeenCalledWith("playera negra");
  });

  it("028 — forma del turno: con un producto, UN mensaje con el texto de siempre y su foto", async () => {
    con([{ ...negra, image_url: FOTO }]);
    const turn = await checkStockTurn({ query: "playera negra", intro: "Claro:" });
    expect(turn).toEqual({
      ok: true,
      messages: [{ text: "Claro:\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN", imageUrl: FOTO }],
    });
  });

  it("la frase de entrada del modelo va antes de los datos", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [negra], truncated: false } });
    const turn = await checkStockTurn({ query: "playera", intro: "Claro, te digo:" });
    expect(textOf(turn)).toBe("Claro, te digo:\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN");
  });

  it("agotado, sin precio y decimales (un producto cada vez: la redacción de la 026)", async () => {
    const casos: [StockProduct, string][] = [
      [
        { ...negra, sku: "PLY-BLA", name: "Playera blanca", stock: 0, available: false },
        "Playera blanca (PLY-BLA): agotado — $199 MXN",
      ],
      [{ ...negra, sku: "GOR-01", name: "Gorra", stock: 3, price: null }, "Gorra (GOR-01): 3 pieza — sin precio"],
      [
        { ...negra, sku: "HAR-01", name: "Harina", stock: 2.5, unit: "kg", price: 1234.5 },
        "Harina (HAR-01): 2.5 kg — $1,234.50 MXN",
      ],
    ];
    for (const [producto, esperado] of casos) {
      con([producto]);
      expect(textOf(await checkStockTurn({ query: "x" }))).toBe(esperado);
    }
  });

  // 032 (FR-1710): sin catálogo —el mock por defecto— el recorte sigue cerrando con «Hay
  // más coincidencias…»; con catálogo, ofrece el catálogo (ver el bloque 032 al final).
  it("truncado: máximo 5 productos y pide precisar (028: un mensaje por producto, el cierre aparte)", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...negra,
      sku: `S-${i}`,
      name: `Prod ${i}`,
    }));
    lookup.mockResolvedValue({ ok: true, data: { products: many, truncated: true } });
    const turn = await checkStockTurn({ query: "prod" });
    expect(turn.messages).toHaveLength(6);
    expect(turn.messages[5]).toEqual({
      text: "Hay más coincidencias, ¿me dices cuál te interesa?",
      imageUrl: null,
    });
    // Con un solo producto y truncated (SKU exacto nunca lo marca; la búsqueda podría): el mismo cierre.
    lookup.mockResolvedValue({ ok: true, data: { products: [negra], truncated: true } });
    expect(textOf(await checkStockTurn({ query: "prod" })).split("\n")).toEqual([
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN",
      "Hay más coincidencias, ¿me dices cuál te interesa?",
    ]);
  });

  it("foto: la URL del primer producto va aparte, nunca dentro del texto", async () => {
    lookup.mockResolvedValue({
      ok: true,
      data: { products: [{ ...negra, image_url: FOTO }], truncated: false },
    });
    const turn = await checkStockTurn({ query: "playera negra" });
    expect(imageOf(turn)).toBe(FOTO);
    expect(textOf(turn)).toBe("Playera negra (PLY-NEG): 7 pieza — $199 MXN");
    expect(textOf(turn)).not.toContain("http");
  });

  it("foto (028, deroga FR-1119): con varios resultados, la de CADA producto con existencia, en su mensaje", async () => {
    const segunda = "https://img.stock.example/2.jpg";
    lookup.mockResolvedValue({
      ok: true,
      data: {
        products: [
          { ...negra, image_url: FOTO },
          { ...negra, sku: "PLY-BLA", name: "Playera blanca", image_url: segunda },
        ],
        truncated: true,
      },
    });
    const turn = await checkStockTurn({ query: "playera" });
    expect(turn.messages.map((m) => m.imageUrl)).toEqual([FOTO, segunda, null]);
    expect(textOf(turn)).not.toContain("http");
  });

  it("foto (028): si el primero no tiene, su línea va como texto y el segundo sí lleva la suya", async () => {
    lookup.mockResolvedValue({
      ok: true,
      data: {
        products: [negra, { ...negra, sku: "PLY-BLA", image_url: FOTO }],
        truncated: false,
      },
    });
    const turn = await checkStockTurn({ query: "playera" });
    expect(turn.messages.map((m) => m.imageUrl)).toEqual([null, FOTO]);
  });

  /* ---------- Tallas (extensión 2026-09-14, FR-1124) ---------- */

  it("modelo sin talla pedida: una línea con precio y la existencia de cada talla en orden", async () => {
    con([roja]);
    const turn = await checkStockTurn({ query: "playera roja" });
    expect(textOf(turn)).toBe("Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1");
  });

  it("talla pedida con existencia: solo esa talla", async () => {
    con([roja]);
    const turn = await checkStockTurn({ query: "playera roja", size: "g" });
    expect(textOf(turn)).toBe("Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN");
  });

  it("talla pedida agotada: lo dice y ofrece las que sí hay", async () => {
    con([roja]);
    const turn = await checkStockTurn({ query: "playera roja", size: "M" });
    expect(textOf(turn)).toBe(
      "Playera roja (PLY-ROJ) talla M: agotada — $219 MXN. Con existencia: CH 4, G 7, XG 1"
    );
  });

  it("talla que el modelo no tiene: lo dice y lista sus tallas", async () => {
    con([roja]);
    const turn = await checkStockTurn({ query: "playera roja", size: "XXG" });
    expect(textOf(turn)).toBe(
      "Playera roja (PLY-ROJ) no viene en talla XXG. Tallas: CH 4, M agotada, G 7, XG 1"
    );
  });

  it("equivalencias solo de respaldo: «grande» ⇒ G, «extra grande» ⇒ XG, con acentos", async () => {
    con([roja]);
    expect(textOf(await checkStockTurn({ query: "playera roja", size: "grande" }))).toContain(
      "talla G: 7 pieza"
    );
    expect(textOf(await checkStockTurn({ query: "playera roja", size: "Extra Grande" }))).toContain(
      "talla XG: 1 pieza"
    );
    // Una etiqueta literal gana a la equivalencia: el negocio manda.
    const literal = { ...roja, variants: [{ sku: "X-L", label: "L", stock: 2, available: true }] };
    con([literal]);
    expect(textOf(await checkStockTurn({ query: "x", size: "L" }))).toContain("talla L: 2 pieza");
  });

  it("talla resuelta por SKU exacto: muestra su etiqueta y su existencia", async () => {
    con([{ ...negra, sku: "PLY-ROJ-G", name: "Playera roja", price: 219, label: "G", parent_sku: "PLY-ROJ" }]);
    const turn = await checkStockTurn({ query: "PLY-ROJ-G" });
    expect(textOf(turn)).toBe("Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN");
  });

  it("producto simple con talla pedida: se ignora la talla; modelo sin tallas activas: agotado", async () => {
    con([negra]);
    expect(textOf(await checkStockTurn({ query: "playera negra", size: "G" }))).toBe(
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN"
    );
    con([{ ...roja, variants: [], stock: 0, available: false }]);
    expect(textOf(await checkStockTurn({ query: "playera roja" }))).toBe(
      "Playera roja (PLY-ROJ): agotado — $219 MXN"
    );
  });

  it("la foto del modelo va una sola vez, aparte del texto, con las tallas en la línea", async () => {
    con([{ ...roja, image_url: FOTO }]);
    const turn = await checkStockTurn({ query: "playera roja", size: "G" });
    expect(imageOf(turn)).toBe(FOTO);
    expect(textOf(turn)).not.toContain("http");
  });

  it("sin coincidencias: lo dice y sigue siendo un turno válido", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [], truncated: false } });
    const turn = await checkStockTurn({ query: "zapatos" });
    expect(turn).toEqual({
      ok: true,
      messages: [{ text: "No encontré productos para «zapatos».", imageUrl: null }],
    });
  });

  it("cualquier error del adaptador: ok=false y el texto es la frase del modelo o nada", async () => {
    for (const error of ["unavailable", "timeout", "unauthorized", "invalid", "network"] as const) {
      lookup.mockResolvedValue({ ok: false, error });
      expect(await checkStockTurn({ query: "x", intro: "Déjame revisar." })).toEqual({
        ok: false,
        messages: [{ text: "Déjame revisar.", imageUrl: null }],
      });
      expect(await checkStockTurn({ query: "x" })).toEqual({ ok: false, messages: [] });
    }
  });
});

/* ---------- 028 · US1: talla pedida con varios modelos (FR-1301, FR-1303..FR-1305) ---------- */

describe("028 — talla pedida con varios modelos", () => {
  it("solo los que tienen existencia en esa talla, uno por mensaje, con su foto y su precio", async () => {
    con(PLAYERAS);
    const turn = await checkStockTurn({ query: "playeras", size: "G", intro: "Déjame revisar." });
    expect(turn.ok).toBe(true);
    expect(turn.messages).toEqual([
      // Sin tallas y con existencia: es de talla única, se muestra con su línea de siempre (FR-1304).
      { text: "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN", imageUrl: FOTO },
      // Sin foto: texto en su lugar del orden.
      { text: "Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN", imageUrl: null },
      { text: "Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN", imageUrl: gris.image_url },
    ]);
    // Agotados en la talla, sin la talla y agotados sin tallas: ni una palabra.
    for (const m of turn.messages) {
      expect(m.text).not.toMatch(/agotad|no viene|Tallas:/);
    }
  });

  it("agotada en la talla pedida (roja, gris en M) y sin la talla (azul, amarilla): se omiten", async () => {
    con(PLAYERAS);
    const turn = await checkStockTurn({ query: "playeras", size: "M" });
    expect(turn.messages.map((m) => m.text)).toEqual([
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN",
      "Playera verde (PLA-VRD) talla M: 10 pieza — $200 MXN",
    ]);
    expect(turn.messages.map((m) => m.imageUrl)).toEqual([FOTO, verde.image_url]);
  });

  it("la equivalencia sigue valiendo con varios: «extra chica» ⇒ XCH", async () => {
    con(PLAYERAS);
    const turn = await checkStockTurn({ query: "playeras", size: "extra chica" });
    expect(turn.messages.map((m) => m.text)).toEqual([
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN",
      "Playera azul (PLA-AZL) talla XCH: 1 pieza — $800 MXN",
    ]);
  });

  it("ninguno con existencia en la talla: una sola frase con la consulta y la talla tal cual, sin fotos", async () => {
    con([pantalonAzul, pantalonNegro]);
    const turn = await checkStockTurn({ query: "pantalones", size: "40", intro: "Déjame revisar." });
    expect(turn.messages).toEqual([
      { text: "Déjame revisar.\nPor ahora no tengo pantalones en talla 40.", imageUrl: null },
    ]);
    // 34: el azul la trae agotada y el negro con existencia ⇒ solo el negro (sin foto ⇒ texto).
    const treinta4 = await checkStockTurn({ query: "pantalones", size: "34" });
    expect(treinta4.messages).toEqual([
      { text: "Pantalón negro (PAN-NG) talla 34: 3 pieza — $650 MXN", imageUrl: null },
    ]);
  });

  it("el orden es el de MS-Stock y la frase de entrada solo va en el primer mensaje", async () => {
    con([pantalonNegro, pantalonAzul]);
    const turn = await checkStockTurn({ query: "pantalones", size: "32", intro: "Claro:" });
    expect(turn.messages).toEqual([
      { text: "Claro:\nPantalón negro (PAN-NG) talla 32: 1 pieza — $650 MXN", imageUrl: null },
      { text: "Pantalón azul (PAN-AZ) talla 32: 4 pieza — $650 MXN", imageUrl: pantalonAzul.image_url },
    ]);
  });

  it("un solo producto resuelto con talla: exactamente como en la 026 (FR-1302)", async () => {
    con([{ ...roja, image_url: FOTO }]);
    expect(await checkStockTurn({ query: "playera roja", size: "M" })).toEqual({
      ok: true,
      messages: [
        {
          text: "Playera roja (PLY-ROJ) talla M: agotada — $219 MXN. Con existencia: CH 4, G 7, XG 1",
          imageUrl: FOTO,
        },
      ],
    });
  });
});

/* ---------- 028 · US3: sin talla, varios modelos (FR-1305, FR-1307, FR-1308; cierre con más de 10: FR-1710 de la 032) ---------- */

describe("028 — sin talla pedida con varios modelos", () => {
  it("solo los con existencia, la línea vigente de cada uno (tallas o simple), su foto; agotados omitidos; tope 5 + cierre", async () => {
    con(PLAYERAS);
    const turn = await checkStockTurn({ query: "playeras", intro: "Déjame revisar." });
    expect(turn.messages).toEqual([
      { text: "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN", imageUrl: FOTO },
      { text: "Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1", imageUrl: null },
      { text: "Playera azul (PLA-AZL) — $800 MXN. Tallas: XCH 1, CH 5, XG 2", imageUrl: azul.image_url },
      { text: "Playera verde (PLA-VRD) — $200 MXN. Tallas: CH 2, M 10, XG 10", imageUrl: verde.image_url },
      { text: "Playera gris (PLA-GRS) — $250 MXN. Tallas: M agotada, G 3, XG 4", imageUrl: gris.image_url },
      { text: "Hay más coincidencias, ¿me dices cuál te interesa?", imageUrl: null },
    ]);
    // La blanca (agotada) no aparece; la amarilla quedó fuera por el tope, no por agotada.
    expect(textOf(turn)).not.toContain("PLY-BLA");
  });

  it("nunca más de 5 imágenes ni la misma foto dos veces en un turno (SC-004)", async () => {
    const misma = "https://img.stock.example/misma.jpg";
    const seis = Array.from({ length: 6 }, (_, i) => ({ ...negra, sku: `S-${i}`, name: `Prod ${i}`, image_url: misma }));
    con(seis);
    const turn = await checkStockTurn({ query: "prod" });
    // Misma URL en todos ⇒ solo la primera lleva foto.
    expect(turn.messages.filter((m) => m.imageUrl).length).toBe(1);
    const distintas = seis.map((p, i) => ({ ...p, image_url: `https://img.stock.example/${i}.jpg` }));
    con(distintas);
    const turn2 = await checkStockTurn({ query: "prod" });
    expect(turn2.messages.filter((m) => m.imageUrl).length).toBe(5);
    expect(new Set(turn2.messages.map((m) => m.imageUrl).filter(Boolean)).size).toBe(5);
    expect(turn2.messages).toHaveLength(6); // 5 productos + cierre
  });

  it("todos agotados: una sola frase con la consulta; MS-Stock truncated con pocos: también el cierre", async () => {
    con([blanca, { ...blanca, sku: "PLY-BL2", name: "Playera blanca 2" }]);
    expect(await checkStockTurn({ query: "playera blanca" })).toEqual({
      ok: true,
      messages: [{ text: "Por ahora no tengo playera blanca con existencia.", imageUrl: null }],
    });
    con([{ ...negra, image_url: FOTO }, verde], true);
    const turn = await checkStockTurn({ query: "playera" });
    expect(turn.messages.map((m) => m.text)).toEqual([
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN",
      "Playera verde (PLA-VRD) — $200 MXN. Tallas: CH 2, M 10, XG 10",
      "Hay más coincidencias, ¿me dices cuál te interesa?",
    ]);
  });

  it("un solo modelo sin talla: exactamente como en la 026 (agotado incluido)", async () => {
    con([{ ...roja, image_url: FOTO }]);
    expect(await checkStockTurn({ query: "playera roja" })).toEqual({
      ok: true,
      messages: [{ text: "Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1", imageUrl: FOTO }],
    });
    con([blanca]);
    expect(textOf(await checkStockTurn({ query: "playera blanca" }))).toBe("Playera blanca (PLY-BLA): agotado — $199 MXN");
  });
});

/**
 * 032 — El cierre de check_stock (FR-1710, deroga en parte FR-1308). Se cuentan los
 * productos con existencia que quedan tras el filtro: de 6 a 10, «Hay más
 * coincidencias…» sin consultar el catálogo; con más de 10, o si MS-Stock recortó, se
 * consulta y, si hay catálogo, se ofrece. Los productos mostrados, sus fotos y su
 * orden no cambian por esto.
 */
describe("032 — el cierre de check_stock y el catálogo", () => {
  const HAY_MAS = "Hay más coincidencias, ¿me dices cuál te interesa?";
  const OFERTA = "Hay más modelos en nuestro catálogo, ¿te lo mando?";
  const CATALOGO = {
    ok: true as const,
    data: {
      url: "https://img.stock.example/catalog/ab12.pdf",
      filename: "Catálogo.pdf",
      updated_at: "2026-10-04T18:00:00Z",
    },
  };
  /** `n` productos con existencia, cada uno con su foto. */
  const varios = (n: number): StockProduct[] =>
    Array.from({ length: n }, (_, i) => ({
      ...negra,
      sku: `CAL-${String(i + 1).padStart(2, "0")}`,
      name: `Calcetín ${i + 1}`,
      image_url: `https://img.stock.example/cal${i + 1}.jpg`,
    }));

  it("5 con existencia: los 5, sin cierre y sin consultar el catálogo", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    con(varios(5));
    const turn = await checkStockTurn({ query: "calcetín" });
    expect(turn.messages).toHaveLength(5);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("de 6 a 10: 5 + «Hay más coincidencias…», sin consultar el catálogo aunque lo haya", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    for (const n of [6, 10]) {
      con(varios(n));
      const turn = await checkStockTurn({ query: "calcetín" });
      expect(turn.messages, `${n}`).toHaveLength(6);
      expect(turn.messages[5]).toEqual({ text: HAY_MAS, imageUrl: null });
    }
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("más de 10 con catálogo: 5 + el ofrecimiento, con una sola consulta", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    for (const n of [11, 12]) {
      getCatalog.mockClear();
      con(varios(n));
      const turn = await checkStockTurn({ query: "calcetín" });
      expect(turn.messages, `${n}`).toHaveLength(6);
      expect(turn.messages[5]).toEqual({ text: OFERTA, imageUrl: null });
      expect(getCatalog).toHaveBeenCalledTimes(1);
    }
  });

  it("más de 10 sin catálogo, o con MS-Stock fallando en esa consulta: el cierre de siempre", async () => {
    for (const error of ["not_found", "timeout", "unavailable"] as const) {
      getCatalog.mockResolvedValue({ ok: false, error });
      con(varios(11));
      const turn = await checkStockTurn({ query: "calcetín" });
      expect(turn.ok, error).toBe(true);
      expect(turn.messages, error).toHaveLength(6);
      expect(turn.messages[5], error).toEqual({ text: HAY_MAS, imageUrl: null });
    }
  });

  it("recorte de MS-Stock: con catálogo se ofrece aunque queden pocos; sin él, el de siempre", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    con(varios(2), true);
    expect((await checkStockTurn({ query: "calcetín" })).messages.at(-1)?.text).toBe(OFERTA);
    con([negra], true);
    expect(textOf(await checkStockTurn({ query: "playera negra" })).split("\n")).toEqual([
      "Playera negra (PLY-NEG): 7 pieza — $199 MXN",
      OFERTA,
    ]);
    getCatalog.mockResolvedValue({ ok: false, error: "not_found" });
    con(varios(2), true);
    expect((await checkStockTurn({ query: "calcetín" })).messages.at(-1)?.text).toBe(HAY_MAS);
  });

  it("se cuenta tras el filtro: 12 agotados ⇒ la frase; 12 con 3 en la talla ⇒ 3, sin cierre ni consulta", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    con(varios(12).map((p) => ({ ...p, stock: 0, available: false })));
    expect(textOf(await checkStockTurn({ query: "calcetines" }))).toBe(
      "Por ahora no tengo calcetines con existencia."
    );
    const conTallas = varios(12).map((p, i) => ({
      ...p,
      variants: [talla(p.sku, "G", i < 3 ? 2 : 0), talla(p.sku, "M", 5)],
    }));
    con(conTallas);
    const enG = await checkStockTurn({ query: "calcetín", size: "G" });
    expect(enG.messages).toHaveLength(3);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("los 5 mensajes de producto (texto, foto y orden) son idénticos con y sin catálogo", async () => {
    getCatalog.mockResolvedValue(CATALOGO);
    con(varios(12));
    const conCatalogo = await checkStockTurn({ query: "calcetín", intro: "Déjame revisar." });
    getCatalog.mockResolvedValue({ ok: false, error: "not_found" });
    con(varios(12));
    const sinCatalogo = await checkStockTurn({ query: "calcetín", intro: "Déjame revisar." });
    expect(conCatalogo.messages.slice(0, 5)).toEqual(sinCatalogo.messages.slice(0, 5));
    expect(conCatalogo.messages[0]?.text.startsWith("Déjame revisar.\n")).toBe(true);
    expect(conCatalogo.messages.slice(0, 5).every((m) => m.imageUrl !== null)).toBe(true);
  });

  it("selectProducts cuenta el total tras el filtro, no solo los mostrados", () => {
    const r = selectProducts(varios(12), "");
    expect(r.shown).toHaveLength(5);
    expect(r.total).toBe(12);
    expect(r.more).toBe(true);
    expect(selectProducts(varios(3), "").total).toBe(3);
  });
});
