import { describe, expect, it } from "vitest";
import { conducirOferta, entradaDelModelo, type Pedido } from "@/server/agenda/conduccion";
import { agentActionSchema } from "@/server/ai/actions";
import { parseDia, parseHora } from "@/server/agenda/pedido";
import type { AvailableSlot } from "@/server/agenda/availability";
import type { WeeklyHours } from "@/server/agenda/settings";

/**
 * 035 — Agendar por chat: primero el DÍA, después la FRANJA, y entonces cuatro
 * horarios de ese día en esa franja (pedido del dueño, 2026-10-12).
 *
 * Por qué existe este archivo: antes, «quiero una cita» recibía de golpe
 * cuatro horarios de los primeros días libres —casi nunca el día del cliente—.
 * Cada `describe` es una rama del conductor; si una deja de preguntar, o
 * enseña algo distinto de lo pedido, se pone rojo.
 */

const TZ = "America/Mexico_City"; // UTC-6 todo el año desde 2022.
// Martes 13 de octubre de 2026, 09:00 en México.
const NOW = new Date("2026-10-13T15:00:00.000Z");
const HOY = "2026-10-13";

const LABORAL = [{ start: "09:00", end: "18:00" }];
const WEEKLY: WeeklyHours = {
  mon: LABORAL,
  tue: LABORAL,
  wed: LABORAL,
  thu: LABORAL,
  fri: LABORAL,
  sat: LABORAL,
  sun: [],
};

const ctx = {
  settings: { timezone: TZ, weeklyHours: WEEKLY, maxDaysAhead: 7 },
  now: NOW,
  catalogo: { denseDays: 2, perDayAfter: 3, limit: 40 },
};

/** Cada media hora entre dos horas de pared, sin incluir la final. */
function horas(desde: string, hasta: string): string[] {
  const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const out: string[] = [];
  for (let m = aMin(desde); m < aMin(hasta); m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Huecos libres a partir de `{ "2026-10-15": ["09:00", …] }` en hora de México. */
function libres(porDia: Record<string, string[]>): AvailableSlot[] {
  return Object.entries(porDia)
    .flatMap(([dia, hs]) =>
      hs.map((h) => {
        const [y, mo, d] = dia.split("-").map(Number) as [number, number, number];
        const start = new Date(
          Date.UTC(y, mo - 1, d, Number(h.slice(0, 2)) + 6, Number(h.slice(3, 5)))
        );
        return {
          startUtc: start.toISOString(),
          endUtc: new Date(start.getTime() + 30 * 60_000).toISOString(),
          label: `${dia} ${h}`,
        };
      })
    )
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}

const DIA_COMPLETO = horas("09:00", "18:00"); // 6 de mañana + 12 de tarde
const SEMANA = libres({
  "2026-10-13": horas("11:00", "18:00"),
  "2026-10-14": DIA_COMPLETO,
  "2026-10-15": DIA_COMPLETO,
  "2026-10-16": DIA_COMPLETO,
  "2026-10-17": DIA_COMPLETO,
});

function pedir(input: { dia?: string; franja?: "am" | "pm"; hora?: string }): Pedido {
  return {
    dia: parseDia(input.dia, HOY),
    franja: input.franja,
    hora: parseHora(input.hora),
  };
}

const vinetas = (text: string) =>
  text
    .split("\n")
    .map((l) => l.match(/^• (\d{2}:\d{2})$/)?.[1])
    .filter(Boolean);

const diasDe = (slots: { dayIso: string }[]) => [...new Set(slots.map((s) => s.dayIso))];

describe("035 — sin día: se pregunta el día", () => {
  it("«quiero una cita» → «¿Para qué día…?», sin un solo horario", () => {
    const r = conducirOferta(SEMANA, pedir({}), ctx);
    expect(r.paso).toBe("pide_dia");
    expect(r.text).toBe("¿Para qué día te gustaría la cita?");
    expect(vinetas(r.text)).toHaveLength(0);
  });

  it("si ya dijo la franja, la pregunta la repite", () => {
    const r = conducirOferta(SEMANA, pedir({ franja: "pm" }), ctx);
    expect(r.text).toBe("¿Para qué día te gustaría la cita por la tarde?");
  });

  it("…y la oferta queda ANCHA: «mañana a las 11» se puede agendar a la primera", () => {
    const r = conducirOferta(SEMANA, pedir({}), ctx);
    const manana11 = r.registrar.find((s) => s.dayIso === "2026-10-14" && s.time === "11:00");
    expect(manana11).toBeDefined();
    expect(diasDe(r.registrar).length).toBeGreaterThan(2);
  });

  it("un día que no se entiende cuenta como no dicho", () => {
    expect(conducirOferta(SEMANA, pedir({ dia: "la próxima semana" }), ctx).paso).toBe("pide_dia");
  });
});

describe("035 — con día: se pregunta mañana o tarde", () => {
  it("un día con las dos franjas → la pregunta, con el día dicho completo", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves" }), ctx);
    expect(r.paso).toBe("pide_franja");
    expect(r.text).toBe("Para el jueves 15 de octubre, ¿prefieres por la mañana o por la tarde?");
    expect(vinetas(r.text)).toHaveLength(0);
  });

  it("…y la oferta es ESE día completo y nada más: «a las 4» ya es de ese día", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves" }), ctx);
    expect(diasDe(r.registrar)).toEqual(["2026-10-15"]);
    expect(r.registrar).toHaveLength(DIA_COMPLETO.length);
  });

  it("hoy y mañana se dicen así", () => {
    expect(conducirOferta(SEMANA, pedir({ dia: "mañana" }), ctx).text).toBe(
      "Para mañana miércoles 14 de octubre, ¿prefieres por la mañana o por la tarde?"
    );
  });

  it("un día con cuatro horarios o menos los enseña todos, sin preguntar", () => {
    const pocos = libres({ "2026-10-15": ["10:00", "16:00", "17:00"] });
    const r = conducirOferta(pocos, pedir({ dia: "jueves" }), ctx);
    expect(r.paso).toBe("menu");
    expect(r.text.startsWith("Para el jueves 15 de octubre tengo:")).toBe(true);
    expect(vinetas(r.text)).toEqual(["10:00", "16:00", "17:00"]);
  });

  it("un día con una sola franja la enseña directo y lo dice", () => {
    const soloTarde = libres({ "2026-10-15": horas("12:00", "18:00") });
    const r = conducirOferta(soloTarde, pedir({ dia: "jueves" }), ctx);
    expect(r.paso).toBe("menu");
    expect(r.text.startsWith("Para el jueves 15 de octubre solo me queda espacio por la tarde:")).toBe(
      true
    );
    expect(vinetas(r.text)).toEqual(["12:00", "14:00", "15:30", "17:30"]);
  });
});

describe("035 — con día y franja: cuatro horarios REPARTIDOS (decisión del dueño)", () => {
  it("la tarde: cuatro que la cubren entera, no los cuatro primeros", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves", franja: "pm" }), ctx);
    expect(r.paso).toBe("menu");
    expect(r.text).toBe(
      [
        "Para el jueves 15 de octubre por la tarde tengo:",
        "• 12:00",
        "• 14:00",
        "• 15:30",
        "• 17:30",
        "¿Cuál te queda mejor? Si prefieres otra hora, dímela y la reviso.",
      ].join("\n")
    );
  });

  it("la mañana, igual", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves", franja: "am" }), ctx);
    expect(vinetas(r.text)).toEqual(["09:00", "10:00", "10:30", "11:30"]);
  });

  it("todo lo enseñado es del día y la franja pedidos, y está en la oferta", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves", franja: "pm" }), ctx);
    const ofrecidas = new Set(r.registrar.filter((s) => s.dayIso === "2026-10-15").map((s) => s.time));
    for (const h of vinetas(r.text)) {
      expect(Number(h!.slice(0, 2))).toBeGreaterThanOrEqual(12);
      expect(ofrecidas.has(h!)).toBe(true);
    }
    expect(diasDe(r.registrar)).toEqual(["2026-10-15"]);
  });

  it("con cuatro o menos en la franja no se promete «otra hora»", () => {
    const pocos = libres({ "2026-10-15": ["09:00", "09:30", "10:00", "10:30", "13:00", "16:00"] });
    const r = conducirOferta(pocos, pedir({ dia: "jueves", franja: "pm" }), ctx);
    expect(vinetas(r.text)).toEqual(["13:00", "16:00"]);
    expect(r.text).not.toContain("otra hora");
  });
});

describe("035 — la franja pedida ya no tiene nada ese día (decisión del dueño)", () => {
  const sinTardeElJueves = libres({
    "2026-10-15": horas("09:00", "12:00"),
    "2026-10-16": DIA_COMPLETO,
  });

  it("enseña la otra franja de ESE día y, en una línea, el día más cercano con la suya", () => {
    const r = conducirOferta(sinTardeElJueves, pedir({ dia: "jueves", franja: "pm" }), ctx);
    expect(r.paso).toBe("otra_franja");
    expect(r.text).toBe(
      [
        "El jueves 15 de octubre por la tarde ya no me queda espacio. Ese día por la mañana tengo:",
        "• 09:00",
        "• 10:00",
        "• 10:30",
        "• 11:30",
        "Si necesitas que sea por la tarde, el viernes 16 sí tengo.",
      ].join("\n")
    );
  });

  it("sin ningún otro día con esa franja, no inventa la línea", () => {
    const r = conducirOferta(
      libres({ "2026-10-15": horas("09:00", "12:00") }),
      pedir({ dia: "jueves", franja: "pm" }),
      ctx
    );
    expect(r.text).not.toContain("Si necesitas");
  });
});

describe("035 — el día pedido no tiene nada: se proponen días", () => {
  const juevesLleno = libres({
    "2026-10-14": DIA_COMPLETO,
    "2026-10-16": DIA_COMPLETO,
    "2026-10-19": horas("09:00", "12:00"),
    "2026-10-20": DIA_COMPLETO,
  });

  it("lleno: lo dice y propone los días con lugar más cercanos", () => {
    const r = conducirOferta(juevesLleno, pedir({ dia: "jueves" }), ctx);
    expect(r.paso).toBe("dia_sin_espacio");
    expect(r.text).toBe(
      "El jueves 15 de octubre ya no me queda espacio. Tengo lugar mañana, el viernes 16 o el lunes 19. ¿Cuál te acomoda?"
    );
    expect(vinetas(r.text)).toHaveLength(0);
  });

  it("con franja, solo propone días que la tienen", () => {
    const r = conducirOferta(juevesLleno, pedir({ dia: "jueves", franja: "pm" }), ctx);
    expect(r.text).toBe(
      "El jueves 15 de octubre ya no me queda espacio. Por la tarde tengo lugar mañana, el viernes 16 o el martes 20. ¿Cuál te acomoda?"
    );
  });

  it("un día cerrado se dice como cerrado, no como lleno", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "domingo" }), ctx);
    expect(r.text.startsWith("El domingo 18 de octubre no damos citas.")).toBe(true);
  });

  it("más allá de la ventana de la agenda, se dice que aún no está abierta", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "15 de noviembre" }), ctx);
    expect(r.text.startsWith("Todavía no tengo abierta la agenda para el domingo 15 de noviembre.")).toBe(
      true
    );
  });

  it("hoy sin lugar se dice «hoy»", () => {
    const r = conducirOferta(libres({ "2026-10-14": DIA_COMPLETO }), pedir({ dia: "hoy" }), ctx);
    expect(r.text.startsWith("Hoy martes 13 de octubre ya no me queda espacio. Tengo lugar mañana.")).toBe(
      true
    );
  });
});

describe("035 — pidió una hora concreta", () => {
  it("libre: los cuatro más cercanos, con ella dentro", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "jueves", hora: "a las 4" }), ctx);
    expect(r.paso).toBe("menu");
    expect(r.text.startsWith("Para el jueves 15 de octubre, cerca de las 16:00 tengo:")).toBe(true);
    expect(vinetas(r.text)).toEqual(["15:00", "15:30", "16:00", "16:30"]);
  });

  it("ocupada: lo dice, y enseña lo más cercano", () => {
    const sin16 = libres({ "2026-10-15": DIA_COMPLETO.filter((h) => h !== "16:00") });
    const r = conducirOferta(sin16, pedir({ dia: "jueves", hora: "16:00" }), ctx);
    expect(r.text.startsWith("Para el jueves 15 de octubre a las 16:00 ya no tengo; lo más cercano es:")).toBe(
      true
    );
    expect(vinetas(r.text)).not.toContain("16:00");
  });

  it("sin día: el primer día que tenga esa hora libre", () => {
    // Hoy empieza a las 11:00, así que las 10:00 libres más próximas son mañana.
    const r = conducirOferta(SEMANA, pedir({ hora: "10:00" }), ctx);
    expect(r.text.startsWith("Para mañana miércoles 14 de octubre, cerca de las 10:00 tengo:")).toBe(true);
    expect(diasDe(r.registrar)).toEqual(["2026-10-14"]);
  });
});

describe("035 — lo antes posible", () => {
  it("el primer día con lugar, y ahí sí los primeros, seguidos", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "lo antes posible" }), ctx);
    expect(r.text.startsWith("Lo más pronto que tengo es hoy martes 13 de octubre:")).toBe(true);
    expect(vinetas(r.text)).toEqual(["11:00", "11:30", "12:00", "12:30"]);
  });

  it("con franja, el primer día que la tenga", () => {
    const r = conducirOferta(SEMANA, pedir({ dia: "cuanto antes", franja: "am" }), ctx);
    // Hoy solo queda mañana de 11:00 a 11:30: también es mañana.
    expect(vinetas(r.text)).toEqual(["11:00", "11:30"]);
  });
});

describe("035 — agenda llena", () => {
  it("lo dice sin inventar nada y no deja oferta", () => {
    const r = conducirOferta([], pedir({ dia: "jueves", franja: "pm" }), ctx);
    expect(r.paso).toBe("agenda_llena");
    expect(r.registrar).toEqual([]);
    expect(r.text).toMatch(/no me quedan horarios libres/);
  });
});

/**
 * 035 — La frase de entrada del modelo. Antes el motor siempre pegaba horarios
 * debajo; ahora puede contestar con una pregunta, y una entrada como «Claro,
 * estos son mis horarios:» quedaría como mentira encima de «¿Para qué día…?».
 */
describe("035 — la frase de entrada del modelo", () => {
  it("se queda lo que no habla de la agenda", () => {
    expect(entradaDelModelo("¡Claro!")).toBe("¡Claro!");
    expect(entradaDelModelo("La cita dura 30 minutos.")).toBe("La cita dura 30 minutos.");
  });

  it("se tira lo que describe horarios, pregunta o abre una lista", () => {
    for (const v of [
      "Claro, tengo estos horarios:",
      "Estos son los horarios disponibles.",
      "¿Para qué día te gustaría?",
      "Te comparto lo que tengo:",
      "Ese día está lleno.",
      "",
      undefined,
    ]) {
      expect(entradaDelModelo(v)).toBeUndefined();
    }
  });
});

/**
 * 035 — La acción tolera la forma en que los modelos dicen «no lo dijo»
 * (`null`) y una hora como número: rechazarlas haría reintentar el turno por
 * algo que el motor entiende de todos modos.
 */
describe("035 — offer_slots acepta null y números", () => {
  const schema = agentActionSchema({ agenda: true, inventario: false });

  it("null cuenta como no dicho y el número se vuelve texto", () => {
    const r = schema.parse({ action: "offer_slots", dia: null, franja: null, hora: 16 });
    expect(r).toEqual({ action: "offer_slots", dia: undefined, franja: undefined, hora: "16" });
  });

  it("y el texto pasa tal cual", () => {
    const r = schema.parse({ action: "offer_slots", dia: "jueves", franja: "tarde" });
    expect(r).toMatchObject({ dia: "jueves", franja: "tarde" });
  });
});
