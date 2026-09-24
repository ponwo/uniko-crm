import { describe, expect, it } from "vitest";
import { catalogByDay, spreadByDay } from "@/server/agenda/spread";
import type { AvailableSlot } from "@/server/agenda/availability";

/**
 * 015 (ajuste 2026-09-23) — El catálogo reservable es DENSO en los días
 * próximos.
 *
 * Por qué existe este archivo, con la evidencia de LanCo: un cliente real pidió
 * «para mañana a las 11am», las 11:00 estaban libres, y el agente le contestó
 * que no había disponibilidad — porque el catálogo registraba 3 huecos por día
 * y ese instante no estaba entre ellos, así que no había ISO que copiar
 * (FR-011 compara por epoch exacto, a propósito).
 *
 * Estos tests afirman que el día próximo va entero. Si alguien vuelve a poner
 * `perDay: 3` para ahorrar tokens, se ponen rojos.
 */

const TZ = "America/Mexico_City";
const NOW = new Date("2026-09-23T15:00:00.000Z");

/** Huecos de 30 min de 09:00 a 16:00 (hora de México) durante `days` días. */
function slotsFor(days: number): AvailableSlot[] {
  const out: AvailableSlot[] = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < 14; i++) {
      // 09:00 CDMX = 15:00 UTC.
      const start = new Date(
        Date.UTC(2026, 8, 24 + d, 15, 0, 0) + i * 30 * 60 * 1000
      );
      out.push({
        startUtc: start.toISOString(),
        endUtc: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
        label: "",
      } as AvailableSlot);
    }
  }
  return out;
}

const opts = { timezone: TZ, denseDays: 2, perDayAfter: 3, limit: 40, now: NOW };

describe("015 — el catálogo reservable (ajuste 2026-09-23)", () => {
  it("los días densos van ENTEROS: las 11:00 de mañana son reservables", () => {
    const cat = catalogByDay(slotsFor(5), opts);
    const manana = cat.filter((s) => s.dayIso === "2026-09-24");
    expect(manana).toHaveLength(14);
    expect(manana.map((s) => s.time)).toContain("11:00");
    // El fallo real: con el reparto viejo, las 11:00 no estaban.
    const viejo = spreadByDay(slotsFor(5), { timezone: TZ, limit: 12, perDay: 3, now: NOW });
    expect(viejo.filter((s) => s.dayIso === "2026-09-24").map((s) => s.time)).not.toContain(
      "11:00"
    );
  });

  it("los días siguientes siguen ralos: «¿y el viernes?» tiene respuesta", () => {
    const cat = catalogByDay(slotsFor(5), opts);
    const dias = [...new Set(cat.map((s) => s.dayIso))];
    expect(dias.length).toBeGreaterThan(2);
    for (const dia of dias.slice(2)) {
      expect(cat.filter((s) => s.dayIso === dia)).toHaveLength(3);
    }
  });

  it("respeta el tope duro (lo registrado viaja al prompt)", () => {
    const cat = catalogByDay(slotsFor(30), { ...opts, limit: 31 });
    expect(cat).toHaveLength(31);
    expect(catalogByDay(slotsFor(5), { ...opts, limit: 0 })).toEqual([]);
  });

  it("sin huecos, catálogo vacío (agenda llena no es un error)", () => {
    expect(catalogByDay([], opts)).toEqual([]);
  });

  it("cada entrada trae día en palabras y hora, para el menú y para el prompt", () => {
    const primero = catalogByDay(slotsFor(1), opts)[0]!;
    expect(primero.time).toBe("09:00");
    expect(primero.dayIso).toBe("2026-09-24");
    expect(primero.dayLabel).toMatch(/jueves/i);
  });
});
