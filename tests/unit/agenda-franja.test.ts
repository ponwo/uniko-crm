import { describe, expect, it } from "vitest";
import { enFranja, parseFranja } from "@/server/agenda/spread";

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
