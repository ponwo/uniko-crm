import { describe, expect, it } from "vitest";
import { presupuestoDeCorrida } from "@/server/lab/runner";

/**
 * 021 (ajuste 2026-09-25) — El presupuesto de una corrida escala con el examen.
 *
 * Por qué existe este archivo, con la evidencia de LanCo: el tope era fijo (10
 * min) mientras el examen crece hasta catorce escenarios. Catorce tardaron
 * ~10,5 min y la corrida murió con `score: null`, tirando once casos ya
 * juzgados y pagados. Ninguna prueba podía verlo: el número era una constante.
 */

const MIN = 60 * 1000;

describe("021 — presupuesto de la corrida", () => {
  it("un examen pequeño conserva el suelo de 10 minutos", () => {
    expect(presupuestoDeCorrida(1)).toBe(10 * MIN);
    expect(presupuestoDeCorrida(6)).toBe(10 * MIN);
  });

  it("el examen que mató la corrida de LanCo ahora cabe", () => {
    // 14 escenarios tardaron ~10,5 min; el presupuesto son 21.
    expect(presupuestoDeCorrida(14)).toBe(21 * MIN);
    expect(presupuestoDeCorrida(14)).toBeGreaterThan(10.5 * MIN);
  });

  it("crece con cada escenario en cuanto se pasa del suelo", () => {
    expect(presupuestoDeCorrida(8)).toBeLessThan(presupuestoDeCorrida(9));
    expect(presupuestoDeCorrida(20) - presupuestoDeCorrida(19)).toBe(90 * 1000);
  });

  it("un examen vacío no da un presupuesto negativo ni cero", () => {
    expect(presupuestoDeCorrida(0)).toBe(10 * MIN);
  });
});
