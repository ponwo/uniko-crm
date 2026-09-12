import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockProduct, StockResult } from "@/server/inventario/client";

/**
 * 026 — El sistema pega los datos (FR-1111): formato pequeño y determinista,
 * una línea por producto, máximo 5; y ante cualquier error del adaptador el
 * turno dice `ok: false` para que el pipeline degrade (FR-1112).
 */

type Lookup = StockResult<{ products: StockProduct[]; truncated: boolean }>;
const lookup = vi.fn<(q: string) => Promise<Lookup>>();
vi.mock("@/server/inventario/client", () => ({ lookup: (q: string) => lookup(q) }));

const { checkStockTurn } = await import("@/server/inventario/agent");

const negra: StockProduct = {
  sku: "PLY-NEG",
  name: "Playera negra",
  description: null,
  stock: 7,
  unit: "pieza",
  price: 199,
  currency: "MXN",
  available: true,
};

afterEach(() => lookup.mockReset());

describe("026 — checkStockTurn", () => {
  it("un producto: una línea con existencia, unidad y precio con moneda", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [negra], truncated: false } });
    const turn = await checkStockTurn({ query: "playera negra" });
    expect(turn.ok).toBe(true);
    expect(turn.text).toBe("Playera negra (PLY-NEG): 7 pieza — $199 MXN");
    expect(lookup).toHaveBeenCalledWith("playera negra");
  });

  it("la frase de entrada del modelo va antes de los datos", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [negra], truncated: false } });
    const turn = await checkStockTurn({ query: "playera", intro: "Claro, te digo:" });
    expect(turn.text).toBe("Claro, te digo:\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN");
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
    expect(turn.text.split("\n")).toEqual([
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
    const lines = turn.text.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("Hay más coincidencias, ¿me dices cuál te interesa?");
  });

  it("sin coincidencias: lo dice y sigue siendo un turno válido", async () => {
    lookup.mockResolvedValue({ ok: true, data: { products: [], truncated: false } });
    const turn = await checkStockTurn({ query: "zapatos" });
    expect(turn).toEqual({ ok: true, text: "No encontré productos para «zapatos»." });
  });

  it("cualquier error del adaptador: ok=false y el texto es la frase del modelo o nada", async () => {
    for (const error of ["unavailable", "timeout", "unauthorized", "invalid", "network"] as const) {
      lookup.mockResolvedValue({ ok: false, error });
      expect(await checkStockTurn({ query: "x", intro: "Déjame revisar." })).toEqual({
        ok: false,
        text: "Déjame revisar.",
      });
      expect(await checkStockTurn({ query: "x" })).toEqual({ ok: false, text: "" });
    }
  });
});
