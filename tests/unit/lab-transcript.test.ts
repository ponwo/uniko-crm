import { describe, expect, it } from "vitest";
import { transcriptDe } from "@/server/lab/runner";

/**
 * 032 — El Laboratorio enseña transcripts, no hilos (US1-5, research R12.1). Un
 * documento del agente (el catálogo PDF) se ve con su nombre antes del pie: así el
 * reporte de la corrida muestra lo que recibiría el cliente y el juez sabe que el
 * PDF salió, en vez de leer un pie suelto.
 */

const PIE = "¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio";

const msg = (
  direction: "in" | "out",
  type: string,
  text: string | null,
  mediaAssetId: string | null = null
) => ({ direction, type, text, mediaAssetId });

describe("032 — transcriptDe", () => {
  it("texto e imagen, de ida y vuelta: igual que siempre", () => {
    expect(
      transcriptDe(
        [
          msg("in", "text", "¿tienen playera negra?"),
          msg("out", "image", "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN", "ma_1"),
          msg("out", "text", "¿Algo más?"),
        ],
        new Map()
      )
    ).toEqual([
      { role: "cliente", text: "¿tienen playera negra?" },
      { role: "agente", text: "Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN" },
      { role: "agente", text: "¿Algo más?" },
    ]);
  });

  it("un documento del agente lleva su nombre antes del pie", () => {
    expect(
      transcriptDe(
        [msg("in", "text", "¿qué venden?"), msg("out", "document", PIE, "ma_9")],
        new Map([["ma_9", "Catálogo de prueba.pdf"]])
      )
    ).toEqual([
      { role: "cliente", text: "¿qué venden?" },
      { role: "agente", text: `[Documento: Catálogo de prueba.pdf]\n${PIE}` },
    ]);
  });

  it("sin nombre conocido, el documento se marca igual; sin pie, sale solo la marca", () => {
    expect(
      transcriptDe(
        [msg("out", "document", PIE, "ma_x"), msg("out", "document", null, "ma_9")],
        new Map([["ma_9", "Catálogo de prueba.pdf"]])
      )
    ).toEqual([
      { role: "agente", text: `[Documento]\n${PIE}` },
      { role: "agente", text: "[Documento: Catálogo de prueba.pdf]" },
    ]);
  });

  it("los mensajes sin texto que no son documento se omiten, como hasta ahora", () => {
    expect(
      transcriptDe([msg("in", "image", null, "ma_1"), msg("out", "text", "")], new Map())
    ).toEqual([]);
  });
});
