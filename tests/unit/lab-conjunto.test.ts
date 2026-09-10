import { describe, expect, it } from "vitest";
import { selloDeConjunto, sonComparables } from "@/server/lab/conjunto";
import { avisoDeComparacion, hayAlgoQueAvisar } from "@/lib/lab-comparacion";

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

describe("qué se enseña junto a una corrida del histórico", () => {
  const comparable = {
    delta: 12,
    comparable: true,
    motivoNoComparable: null,
  } as const;

  it("comparables y con diferencia → solo el número", () => {
    const a = avisoDeComparacion(comparable);
    expect(a).toEqual({ numero: 12, motivo: null });
    expect(hayAlgoQueAvisar(a)).toBe(true);
  });

  it("no comparables y con diferencia → número Y motivo", () => {
    const a = avisoDeComparacion({
      delta: -42,
      comparable: false,
      motivoNoComparable: "examen",
    });
    expect(a).toEqual({ numero: -42, motivo: "examen" });
  });

  /**
   * EL FALLO QUE ESTE ARCHIVO EXISTE PARA FIJAR.
   *
   * Se vio en una captura de la instancia real, no en la suite: dos corridas
   * con el MISMO score y exámenes distintos no enseñaban nada, porque la
   * decisión estaba escrita como `delta !== 0 && …` en el render.
   *
   * Y es peor que el caso que sí estaba cubierto: un −42 tachado ya invita a
   * desconfiar, pero dos 75 seguidos sin nada al lado se leen como "no cambió
   * nada" — cuando la verdad es que no se sabe si son comparables.
   */
  it("MISMO score y examen distinto → el aviso sale igual, sin número", () => {
    const a = avisoDeComparacion({
      delta: 0,
      comparable: false,
      motivoNoComparable: "sin_registro",
    });
    expect(a).toEqual({ numero: null, motivo: "sin_registro" });
    expect(
      hayAlgoQueAvisar(a),
      "Dos scores iguales de exámenes distintos se leerían como 'no cambió nada'."
    ).toBe(true);
  });

  it("comparables y sin diferencia → no hay nada que decir", () => {
    const a = avisoDeComparacion({
      delta: 0,
      comparable: true,
      motivoNoComparable: null,
    });
    expect(hayAlgoQueAvisar(a)).toBe(false);
  });

  it("sin corrida anterior con la que comparar → tampoco", () => {
    const a = avisoDeComparacion({
      delta: null,
      comparable: null,
      motivoNoComparable: null,
    });
    expect(hayAlgoQueAvisar(a)).toBe(false);
  });
});
