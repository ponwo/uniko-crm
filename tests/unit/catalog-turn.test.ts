import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogInfo, StockResult } from "@/server/inventario/client";

/**
 * 032 — El turno de `send_catalog` (FR-1702..FR-1708). El modelo solo decide CUÁNDO
 * mandar el catálogo; el sistema lo pide a MS-Stock (una vez, sin reintentos), arma
 * el pie y devuelve lo que hay que enviar —el documento y el texto de respaldo— o
 * `ok: false` para que el pipeline degrade a la frase del modelo.
 */

const getCatalog = vi.fn<() => Promise<StockResult<CatalogInfo>>>();
vi.mock("@/server/inventario/client", () => ({ getCatalog: () => getCatalog() }));

const { buildCatalogCaption, CATALOG_FOOTER, sendCatalogTurn } = await import(
  "@/server/inventario/agent"
);

const FOOTER = "Dime modelo y talla y te confirmo existencia y precio";
const CATALOG: CatalogInfo = {
  url: "https://img.stock.example/catalog/ab12.pdf",
  filename: "Catálogo Otoño 2026.pdf",
  updated_at: "2026-10-04T18:00:00Z",
};
/** Lo que cabe de frase de entrada sin recortar: 1024 − "\n\n" − la frase fija. */
const CABE = 1024 - 2 - FOOTER.length;
const SUSTITUTO_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

afterEach(() => getCatalog.mockReset());

describe("032 — el pie del catálogo (FR-1703, FR-1704)", () => {
  it("la frase fija es la del contrato §4b", () => {
    expect(CATALOG_FOOTER).toBe(FOOTER);
  });

  it("sin frase de entrada (o solo espacios): el pie es la frase fija sola", () => {
    expect(buildCatalogCaption("")).toBe(FOOTER);
    expect(buildCatalogCaption("   \n ")).toBe(FOOTER);
  });

  it("con frase: la frase, una línea en blanco y la frase fija", () => {
    expect(buildCatalogCaption("¡Claro!")).toBe(`¡Claro!\n\n${FOOTER}`);
    expect(buildCatalogCaption("  ¡Claro!  ")).toBe(`¡Claro!\n\n${FOOTER}`);
  });

  it("una frase que cabe justo no se recorta (1024 exactos)", () => {
    const justa = "a".repeat(CABE);
    const pie = buildCatalogCaption(justa);
    expect(pie).toBe(`${justa}\n\n${FOOTER}`);
    expect(pie.length).toBe(1024);
  });

  it("una frase que no cabe se recorta con «…»; la frase fija nunca", () => {
    for (const largo of [CABE + 1, 2000]) {
      const pie = buildCatalogCaption("a".repeat(largo));
      expect(pie.length).toBeLessThanOrEqual(1024);
      expect(pie.endsWith(`…\n\n${FOOTER}`)).toBe(true);
      expect(pie.startsWith("a".repeat(900))).toBe(true);
    }
  });

  it("el recorte no deja espacios antes de «…» ni parte un emoji", () => {
    const conEspacios = `${"a".repeat(CABE - 12)}${" ".repeat(20)}${"b".repeat(100)}`;
    const pie = buildCatalogCaption(conEspacios);
    expect(pie.length).toBeLessThanOrEqual(1024);
    expect(pie).not.toMatch(/\s…/);

    const conEmoji = `${"a".repeat(CABE - 2)}${"😀".repeat(10)}`;
    const pieEmoji = buildCatalogCaption(conEmoji);
    expect(pieEmoji.length).toBeLessThanOrEqual(1024);
    expect(pieEmoji).not.toMatch(SUSTITUTO_SUELTO);
    expect(pieEmoji.endsWith(`…\n\n${FOOTER}`)).toBe(true);
  });
});

describe("032 — sendCatalogTurn (FR-1702, FR-1705, FR-1708)", () => {
  it("con catálogo: el documento (URL y nombre de MS-Stock, el pie) y el respaldo pie + URL", async () => {
    getCatalog.mockResolvedValue({ ok: true, data: CATALOG });
    const turn = await sendCatalogTurn({ intro: "¡Claro!" });
    const pie = `¡Claro!\n\n${FOOTER}`;
    expect(turn).toEqual({
      ok: true,
      document: { url: CATALOG.url, filename: CATALOG.filename, caption: pie },
      fallbackText: `${pie}\n${CATALOG.url}`,
    });
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it("sin frase del modelo: el pie es la frase fija", async () => {
    getCatalog.mockResolvedValue({ ok: true, data: CATALOG });
    const turn = await sendCatalogTurn({});
    expect(turn.ok && turn.document.caption).toBe(FOOTER);
    expect(turn.ok && turn.fallbackText).toBe(`${FOOTER}\n${CATALOG.url}`);
  });

  it("cualquier fallo de MS-Stock ⇒ ok:false (una sola consulta) y el motivo en el log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const motivos = ["not_found", "unauthorized", "unavailable", "timeout", "invalid", "network"] as const;
    for (const error of motivos) {
      getCatalog.mockReset();
      getCatalog.mockResolvedValue({ ok: false, error });
      expect(await sendCatalogTurn({ intro: "¡Claro!" }), error).toEqual({ ok: false });
      expect(getCatalog).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenLastCalledWith(expect.stringContaining(`[agente] catálogo: ${error}`));
    }
    errorSpy.mockRestore();
  });
});
