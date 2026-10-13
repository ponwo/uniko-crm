import { describe, expect, it } from "vitest";
import { horaTexto, parseDia, parseHora } from "@/server/agenda/pedido";

/**
 * 035 — El día y la hora que pidió el cliente, en sus palabras.
 *
 * Los traduce el código y no el modelo: pasar de «el jueves» a una fecha es
 * aritmética de calendario, y un modelo barato la falla de vez en cuando. Si
 * alguien mueve esto al prompt «porque el modelo ya sabe qué día es», estos
 * tests dejan de tener sentido — y la cita cae en otra fecha.
 */

// Martes 13 de octubre de 2026.
const HOY = "2026-10-13";
const fecha = (raw: string) => {
  const d = parseDia(raw, HOY);
  return d?.tipo === "fecha" ? d.dayIso : d?.tipo;
};

describe("035 — parseDia: relativos", () => {
  it("hoy, mañana y pasado mañana", () => {
    expect(fecha("hoy")).toBe("2026-10-13");
    expect(fecha("Mañana")).toBe("2026-10-14");
    expect(fecha("manana")).toBe("2026-10-14");
    expect(fecha("pasado mañana")).toBe("2026-10-15");
  });

  it("«por la mañana» NO es el día siguiente: es una franja y no un día", () => {
    expect(parseDia("por la mañana", HOY)).toBeUndefined();
    expect(parseDia("en la mañana", HOY)).toBeUndefined();
    // Con el día al lado, el día manda.
    expect(fecha("jueves por la mañana")).toBe("2026-10-15");
    expect(fecha("mañana por la tarde")).toBe("2026-10-14");
  });
});

describe("035 — parseDia: días de la semana", () => {
  it("el próximo de ese nombre, con o sin artículo ni acento", () => {
    expect(fecha("jueves")).toBe("2026-10-15");
    expect(fecha("el viernes")).toBe("2026-10-16");
    expect(fecha("Miércoles")).toBe("2026-10-14");
    expect(fecha("sabado")).toBe("2026-10-17");
    expect(fecha("el lunes")).toBe("2026-10-19");
  });

  it("el mismo día de hoy, a secas, es el de la semana que entra; «este», hoy", () => {
    expect(fecha("el martes")).toBe("2026-10-20");
    expect(fecha("este martes")).toBe("2026-10-13");
  });

  it("«de la próxima semana» salta a la semana que entra", () => {
    // El jueves de ESTA semana es el 15; el de la próxima, el 22.
    expect(fecha("el jueves de la próxima semana")).toBe("2026-10-22");
    // El lunes ya es de la semana que entra: no salta otra vez.
    expect(fecha("el lunes de la otra semana")).toBe("2026-10-19");
  });

  it("con número, manda el número: «jueves 22»", () => {
    expect(fecha("jueves 22")).toBe("2026-10-22");
  });
});

describe("035 — parseDia: fechas", () => {
  it("«15 de octubre», «15 octubre», con y sin año", () => {
    expect(fecha("15 de octubre")).toBe("2026-10-15");
    expect(fecha("el 15 octubre")).toBe("2026-10-15");
    expect(fecha("3 de noviembre de 2026")).toBe("2026-11-03");
  });

  it("una fecha sin año que ya pasó es la del año que entra", () => {
    expect(fecha("5 de octubre")).toBe("2027-10-05");
  });

  it("ISO y día/mes (en México la barra es día/mes)", () => {
    expect(fecha("2026-10-21")).toBe("2026-10-21");
    expect(fecha("21/10")).toBe("2026-10-21");
    expect(fecha("21/10/2026")).toBe("2026-10-21");
  });

  it("«el 20» es este mes; «el 2», que ya pasó, el mes que entra", () => {
    expect(fecha("el 20")).toBe("2026-10-20");
    expect(fecha("el 2")).toBe("2026-11-02");
    expect(fecha("día 31")).toBe("2026-10-31");
  });

  it("encuentra la fecha aunque haya otro número antes", () => {
    expect(fecha("a las 4 del 15 de octubre")).toBe("2026-10-15");
  });

  it("una fecha que no existe no se inventa", () => {
    expect(parseDia("31 de noviembre", HOY)).toBeUndefined();
    expect(parseDia("2026-02-30", HOY)).toBeUndefined();
  });
});

describe("035 — parseDia: prisa y lo que no se entiende", () => {
  it("«lo antes posible» y parecidos piden el primer día con lugar", () => {
    for (const v of ["lo antes posible", "lo más pronto", "cuanto antes", "cuando sea"]) {
      expect(parseDia(v, HOY)).toEqual({ tipo: "pronto" });
    }
  });

  it("lo que no es un día queda como no dicho (el motor vuelve a preguntar)", () => {
    for (const v of [undefined, null, "", "   ", "la próxima semana", "no sé", "tarde"]) {
      expect(parseDia(v, HOY)).toBeUndefined();
    }
  });
});

describe("035 — parseHora", () => {
  const h = (raw: string) => {
    const m = parseHora(raw);
    return m === undefined ? undefined : horaTexto(m);
  };

  it("24 horas, con o sin minutos", () => {
    expect(h("16:00")).toBe("16:00");
    expect(h("9:30")).toBe("09:30");
    expect(h("a las 16:30")).toBe("16:30");
  });

  it("am/pm pegado o separado, y «de la tarde»", () => {
    expect(h("11am")).toBe("11:00");
    expect(h("9pm")).toBe("21:00");
    expect(h("4 pm")).toBe("16:00");
    expect(h("4 de la tarde")).toBe("16:00");
    expect(h("10 de la mañana")).toBe("10:00");
    expect(h("12am")).toBe("00:00");
  });

  it("«a las 4» sin más es la tarde; «a las 9», la mañana", () => {
    expect(h("a las 4")).toBe("16:00");
    expect(h("a las 9")).toBe("09:00");
  });

  it("«y media», «y cuarto» y «mediodía»", () => {
    expect(h("a las 4 y media")).toBe("16:30");
    expect(h("a las 10 y cuarto")).toBe("10:15");
    expect(h("mediodía")).toBe("12:00");
  });

  it("lo que no es una hora queda como no dicho", () => {
    for (const v of [undefined, null, "", "temprano", "por la tarde", "a las 25", "13:75"]) {
      expect(parseHora(v)).toBeUndefined();
    }
  });
});

describe("035 — parseDia: la etiqueta de la CITA ACTUAL", () => {
  it("al mover, el modelo puede copiar la etiqueta tal cual y vale como día", () => {
    // Es la forma de `labelInTz`, que es lo que el prompt le enseña.
    expect(fecha("sáb 17 oct, 10:30")).toBe("2026-10-17");
    expect(fecha("mié 14 oct, 16:00")).toBe("2026-10-14");
  });
});
