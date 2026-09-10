import { describe, expect, it } from "vitest";
import { selloDeConjunto, sonComparables } from "@/server/lab/conjunto";

/**
 * 021 Entrega 3 — El sello del conjunto y la comparabilidad (FR-625, FR-626,
 * FR-616).
 *
 * Existe por algo que se midió, no por teoría: la Entrega 2 llevó a LanCo de
 * 42 a 75 sin que su agente cambiara —cambió la rúbrica y, entre corridas,
 * también los guiones que se ejecutaron— y la pantalla lo presentó como
 * mejora. Eso es lo que estas dos piezas impiden.
 */

describe("el sello del conjunto (FR-625)", () => {
  it("no cambia por el orden de lectura", () => {
    const a = selloDeConjunto([
      { key: "b", script: ["dos"] },
      { key: "a", script: ["uno"] },
    ]);
    const b = selloDeConjunto([
      { key: "a", script: ["uno"] },
      { key: "b", script: ["dos"] },
    ]);
    expect(a).toBe(b);
  });

  /** Lo que un hash de solo claves NO detectaría, y es el caso que importa. */
  it("cambia si se EDITA una línea, no solo si se añade un escenario", () => {
    const antes = selloDeConjunto([{ key: "a", script: ["¿cuánto cuesta?"] }]);
    const despues = selloDeConjunto([{ key: "a", script: ["¿cuánto vale?"] }]);
    expect(despues).not.toBe(antes);
  });

  it("cambia al añadir un escenario", () => {
    const uno = selloDeConjunto([{ key: "a", script: ["x"] }]);
    const dos = selloDeConjunto([
      { key: "a", script: ["x"] },
      { key: "b", script: ["y"] },
    ]);
    expect(dos).not.toBe(uno);
  });

  /**
   * La razón de serializar con JSON en vez de concatenar. Sin frontera
   * inequívoca, clave "ab" con guion ["c"] y clave "a" con guion ["bc"]
   * producirían el mismo material — dos exámenes distintos que el histórico
   * daría por iguales, que es justo lo que el sello existe para evitar.
   */
  it("no confunde dos conjuntos que concatenados serían iguales", () => {
    const a = selloDeConjunto([{ key: "ab", script: ["c"] }]);
    const b = selloDeConjunto([{ key: "a", script: ["bc"] }]);
    expect(a).not.toBe(b);
  });
});

describe("cuándo dos corridas se pueden comparar (FR-626, FR-616)", () => {
  const base = { scenarioSet: "sha256:aaa", rubricVersion: "r2" };

  it("mismo examen y misma rúbrica → comparables", () => {
    expect(sonComparables(base, { ...base })).toEqual({
      comparables: true,
      motivo: null,
    });
  });

  it("examen distinto → no comparables, y lo dice", () => {
    expect(
      sonComparables(base, { ...base, scenarioSet: "sha256:bbb" })
    ).toEqual({ comparables: false, motivo: "examen" });
  });

  /** El caso que el sello por sí solo NO cubre: cambió el criterio. */
  it("rúbrica distinta → no comparables, aunque el examen sea el mismo", () => {
    expect(sonComparables(base, { ...base, rubricVersion: "r1" })).toEqual({
      comparables: false,
      motivo: "rubrica",
    });
  });

  /**
   * Una corrida anterior a esta entrega no tiene sello ni versión. "No se
   * sabe" NO es lo mismo que "son iguales", y responder que sí serían
   * comparables sería exactamente la mentira que esto viene a quitar.
   */
  it("si a alguna le falta el registro, no son comparables", () => {
    expect(
      sonComparables(base, { scenarioSet: null, rubricVersion: null })
    ).toEqual({ comparables: false, motivo: "sin_registro" });
    expect(
      sonComparables(base, { ...base, rubricVersion: null })
    ).toEqual({ comparables: false, motivo: "sin_registro" });
  });
});
