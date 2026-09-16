import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockProduct, StockResult } from "@/server/inventario/client";

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
vi.mock("@/server/inventario/client", () => ({ lookup: (q: string) => lookup(q) }));

const { checkStockTurn } = await import("@/server/inventario/agent");
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

function con(products: StockProduct[], truncated = false) {
  lookup.mockResolvedValue({ ok: true, data: { products, truncated } });
}

afterEach(() => lookup.mockReset());

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

  it("agotado, sin precio y decimales", async () => {
    lookup.mockResolvedValue({
      ok: true,
      data: {
        products: [
          { ...negra, sku: "PLY-BLA", name: "Playera blanca", stock: 0, available: false },
          { ...negra, sku: "GOR-01", name: "Gorra", stock: 3, price: null },
          { ...negra, sku: "HAR-01", name: "Harina", stock: 2.5, unit: "kg", price: 1234.5 },
        ],
        truncated: false,
      },
    });
    const turn = await checkStockTurn({ query: "x" });
    expect(textOf(turn).split("\n")).toEqual([
      "Playera blanca (PLY-BLA): agotado — $199 MXN",
      "Gorra (GOR-01): 3 pieza — sin precio",
      "Harina (HAR-01): 2.5 kg — $1,234.50 MXN",
    ]);
  });

  it("truncado: máximo 5 líneas y pide precisar", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...negra,
      sku: `S-${i}`,
      name: `Prod ${i}`,
    }));
    lookup.mockResolvedValue({ ok: true, data: { products: many, truncated: true } });
    const turn = await checkStockTurn({ query: "prod" });
    const lines = textOf(turn).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("Hay más coincidencias, ¿me dices cuál te interesa?");
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

  it("foto: con varios resultados, a lo sumo la del primero", async () => {
    lookup.mockResolvedValue({
      ok: true,
      data: {
        products: [
          { ...negra, image_url: FOTO },
          { ...negra, sku: "PLY-BLA", name: "Playera blanca", image_url: "https://img.stock.example/2.jpg" },
        ],
        truncated: true,
      },
    });
    const turn = await checkStockTurn({ query: "playera" });
    expect(imageOf(turn)).toBe(FOTO);
    expect(textOf(turn)).not.toContain("http");
  });

  it("foto: si el primero no tiene, ninguna (aunque el segundo sí)", async () => {
    lookup.mockResolvedValue({
      ok: true,
      data: {
        products: [negra, { ...negra, sku: "PLY-BLA", image_url: FOTO }],
        truncated: false,
      },
    });
    const turn = await checkStockTurn({ query: "playera" });
    expect(imageOf(turn)).toBeNull();
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
