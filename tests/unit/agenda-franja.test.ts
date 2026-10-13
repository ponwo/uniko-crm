import { describe, expect, it } from "vitest";
import { cercanosA, enFranja, parseFranja, repartir, type SpreadSlot } from "@/server/agenda/spread";

/**
 * 015 (ajuste 2026-09-26) — La franja del día que pidió el cliente.
 *
 * Por qué existe este archivo, con la evidencia del Laboratorio de LanCo: ante
 * «¿me la cambias a la tarde del lunes?» el agente contestaba «horarios
 * disponibles el lunes POR LA TARDE» y enseñaba 09:00, 09:30 y 10:00. Pasó
 * igual con `gpt-6-luna` y con `glm-5.3-flash`, así que no era del modelo: el
 * menú siempre daba los primeros del catálogo y no había otra cosa que enseñar.
 */

describe("015 — parseFranja", () => {
  it("entiende la tarde como la diga", () => {
    for (const v of ["tarde", "por la tarde", "PM", "  De La Tarde "]) {
      expect(parseFranja(v)).toBe("pm");
    }
  });

  it("entiende la mañana con acento, sin acento y como «temprano»", () => {
    for (const v of ["mañana", "manana", "por la mañana", "temprano", "AM"]) {
      expect(parseFranja(v)).toBe("am");
    }
  });

  it("lo que no es una franja no lo inventa", () => {
    for (const v of [undefined, null, "", "   ", "el lunes", "cuando sea"]) {
      expect(parseFranja(v)).toBeUndefined();
    }
  });
});

describe("015 — enFranja parte el día al mediodía", () => {
  it("antes de las 12 es mañana", () => {
    expect(enFranja({ time: "09:00" }, "am")).toBe(true);
    expect(enFranja({ time: "11:30" }, "am")).toBe(true);
    expect(enFranja({ time: "09:00" }, "pm")).toBe(false);
  });

  it("las 12:00 en punto ya es tarde", () => {
    expect(enFranja({ time: "12:00" }, "pm")).toBe(true);
    expect(enFranja({ time: "12:00" }, "am")).toBe(false);
    expect(enFranja({ time: "15:30" }, "pm")).toBe(true);
  });
});

describe("035 — parseFranja: la noche es tarde", () => {
  it("«en la noche» pide lo último del día", () => {
    expect(parseFranja("en la noche")).toBe("pm");
    expect(parseFranja("vespertino")).toBe("pm");
  });
});

/**
 * 035 — Decisión del dueño (2026-10-12): pedida una franja se enseñan cuatro
 * que la CUBRAN, no los cuatro primeros — con huecos de media hora, los
 * primeros de la tarde caen todos a la hora de comer.
 */
describe("035 — repartir", () => {
  const tarde = ["12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"];

  it("cuatro de doce: el primero, el último y dos en medio", () => {
    expect(repartir(tarde, 4)).toEqual(["12:00", "14:00", "15:30", "17:30"]);
  });

  it("cuatro de seis (una mañana de 9 a 12)", () => {
    expect(repartir(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"], 4)).toEqual([
      "09:00",
      "10:00",
      "10:30",
      "11:30",
    ]);
  });

  it("con cuatro o menos, todos; con n=1, el primero; con n=0, nada", () => {
    expect(repartir(["10:00", "16:00"], 4)).toEqual(["10:00", "16:00"]);
    expect(repartir(tarde, 1)).toEqual(["12:00"]);
    expect(repartir(tarde, 0)).toEqual([]);
  });

  it("nunca repite", () => {
    const r = repartir(["a", "b", "c", "d", "e"], 4);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe("035 — cercanosA", () => {
  const slot = (time: string, i: number) =>
    ({ time, startUtc: new Date(Date.UTC(2026, 9, 15, 15 + i)).toISOString() }) as SpreadSlot;
  const dia = ["09:00", "11:00", "13:00", "15:00", "16:00", "17:00"].map(slot);

  it("los más cercanos a la hora, en orden de reloj", () => {
    expect(cercanosA(dia, 16 * 60, 3).map((s) => s.time)).toEqual(["15:00", "16:00", "17:00"]);
  });

  it("a igual distancia gana el más temprano", () => {
    expect(cercanosA(dia, 12 * 60, 2).map((s) => s.time)).toEqual(["11:00", "13:00"]);
  });
});
