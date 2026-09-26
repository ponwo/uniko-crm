import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * 015 (FR-025) — El ai-mock ofrece y agenda SOLO si el system prompt nombra
 * la acción, y reserva ÚNICAMENTE copiando el startUtc del bloque HORARIOS
 * OFRECIDOS. Sin ese bloque no puede reservar —igual que un modelo real, que no
 * copia un ISO que no le enseñaron— y por eso el arnés detecta si el contexto
 * deja de viajar: se comporta como el LLM real en LanCo (re-ofrece en bucle).
 */

const ACCIONES =
  'Eres "Uni". - {"action":"offer_slots","reply":"..."} - {"action":"book_slot","startUtc":"..."}';
const CON_OFRECIDOS = [
  ACCIONES,
  "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN (los puso el sistema):",
  '1. jue 17 sep, 16:00 → startUtc "2026-09-17T22:00:00.000Z"',
  '2. jue 17 sep, 16:30 → startUtc "2026-09-17T22:30:00.000Z"',
].join("\n");
const SIN_AGENDA = 'Eres "Uni". - {"action":"reply","text":"..."}';

function run(system: string, user: string) {
  return JSON.parse(
    aiMockCompletion([
      { role: "system", content: system },
      { role: "user", content: user },
    ])
  );
}

describe("015 — ai-mock y la agenda", () => {
  it("«quiero agendar una cita» → offer_slots (el sistema pega los horarios)", () => {
    expect(run(ACCIONES, "Hola, quiero agendar una cita")).toEqual({
      action: "offer_slots",
      reply: "Claro, tengo estos horarios:",
    });
    expect(run(ACCIONES, "¿qué horarios tienen?").action).toBe("offer_slots");
  });

  it("«el primer horario» con el bloque en el prompt → book_slot con ESE startUtc, tal cual", () => {
    const r = run(CON_OFRECIDOS, "El primer horario, agéndamelo por favor");
    expect(r.action).toBe("book_slot");
    expect(r.startUtc).toBe("2026-09-17T22:00:00.000Z");
  });

  it("«el primero» SIN el bloque en el prompt → no puede reservar: vuelve a ofrecer", () => {
    // Es el fallo real de LanCo, modelado: sin el ISO a la vista no hay cita.
    expect(run(ACCIONES, "El primer horario, agéndamelo por favor").action).toBe("offer_slots");
  });

  it("sin la acción en el prompt (bandera apagada): el eco de siempre", () => {
    const r = run(SIN_AGENDA, "Hola, quiero agendar una cita");
    expect(r.action).toBe("reply");
    expect(r.text).toContain("Respuesta de prueba");
  });
});

/**
 * Ajuste 2026-09-23 — El cliente real no elige del menú: pide SU hora. El mock
 * lo modela buscando esa hora en el bloque de ofrecidos; si el catálogo vuelve
 * a ser ralo, no la encuentra y el arnés se pone rojo.
 */
describe("015 — ai-mock y la hora concreta", () => {
  it("«a las 16:30» con esa hora en el catálogo → la reserva", () => {
    const system = [
      ACCIONES,
      "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN:",
      '1. jue 24 sep, 09:00 → startUtc "2026-09-24T15:00:00.000Z"',
      '2. jue 24 sep, 16:30 → startUtc "2026-09-24T22:30:00.000Z"',
    ].join("\n");
    const r = run(system, "Mejor a las 16:30");
    expect(r.action).toBe("book_slot");
    expect(r.startUtc).toBe("2026-09-24T22:30:00.000Z");
  });

  it("«a las 11am» entiende el am/pm y elige esa línea", () => {
    const system = [
      ACCIONES,
      '1. jue 24 sep, 09:00 → startUtc "2026-09-24T15:00:00.000Z"',
      '2. jue 24 sep, 11:00 → startUtc "2026-09-24T17:00:00.000Z"',
    ].join("\n");
    expect(run(system, "Para mañana a las 11am").startUtc).toBe("2026-09-24T17:00:00.000Z");
  });

  it("una hora que NO está en el catálogo se re-ofrece, sin declarar nada ocupado", () => {
    const r = run(CON_OFRECIDOS, "Para mañana a las 11am");
    expect(r.action).toBe("offer_slots");
    expect(r.reply).not.toMatch(/no hay disponibilidad|ocupad|lleno/i);
  });
});

/**
 * Ajuste 2026-09-25 — Mover no es reservar. El mock distingue por el verbo,
 * como haría un modelo real; si no hay cita que mover, eso lo dice el motor.
 */
describe("015 — ai-mock y mover la cita", () => {
  const CON_MOVE = [
    ACCIONES,
    '- {"action":"move_slot","startUtc":"..."}',
    "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN:",
    '1. lun 28 sep, 11:00 → startUtc "2026-09-28T17:00:00.000Z"',
    '2. lun 28 sep, 14:00 → startUtc "2026-09-28T20:00:00.000Z"',
  ].join("\n");

  it("«cámbiamela a las 14:00» → move_slot con ese instante", () => {
    const r = run(CON_MOVE, "Uy, ya no puedo. ¿Me la cambias a las 14:00?");
    expect(r.action).toBe("move_slot");
    expect(r.startUtc).toBe("2026-09-28T20:00:00.000Z");
  });

  it("«resérvame a las 14:00» sigue siendo book_slot", () => {
    const r = run(CON_MOVE, "Agéndamela a las 14:00");
    expect(r.action).toBe("book_slot");
    expect(r.startUtc).toBe("2026-09-28T20:00:00.000Z");
  });

  it("sin la acción en el prompt no se propone mover (bandera apagada)", () => {
    const sinMove = [
      ACCIONES,
      '1. lun 28 sep, 14:00 → startUtc "2026-09-28T20:00:00.000Z"',
    ].join("\n");
    expect(run(sinMove, "¿Me la cambias a las 14:00?").action).toBe("book_slot");
  });
});

/**
 * Ajuste 2026-09-25 — Con cita ya hecha, pedir otra hora es MOVER aunque el
 * cliente no use el verbo («sí, a las 14:00»). Es el caso que producía dos
 * citas para el mismo cliente.
 */
describe("015 — ai-mock: con cita actual, elegir hora mueve", () => {
  const CON_CITA = [
    ACCIONES,
    '- {"action":"move_slot","startUtc":"..."}',
    "CITA ACTUAL DE ESTE CLIENTE: lun 28 sep, 11:00.",
    "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN:",
    '1. lun 28 sep, 14:00 → startUtc "2026-09-28T20:00:00.000Z"',
  ].join("\n");

  it("«sí, a las 14:00» con cita actual → move_slot", () => {
    const r = run(CON_CITA, "Sí, a las 14:00");
    expect(r.action).toBe("move_slot");
    expect(r.startUtc).toBe("2026-09-28T20:00:00.000Z");
  });

  it("sin cita actual, «sí, a las 14:00» sigue siendo reservar", () => {
    const sinCita = [
      ACCIONES,
      '- {"action":"move_slot","startUtc":"..."}',
      '1. lun 28 sep, 14:00 → startUtc "2026-09-28T20:00:00.000Z"',
    ].join("\n");
    expect(run(sinCita, "Sí, a las 14:00").action).toBe("book_slot");
  });
});

/**
 * Ajuste 2026-09-25 — La hora se busca en la ETIQUETA, no en la línea entera.
 *
 * Salió en el arnés: México es UTC-6, así que la línea de las 10:00 lleva
 * «T16:00:00.000Z» en su ISO. Buscando en toda la línea, pedir las 16:00
 * movía la cita a las 10:00 — y el arnés habría dado por bueno el mock.
 */
describe("015 — ai-mock: la hora del ISO no se confunde con la pedida", () => {
  const CATALOGO = [
    ACCIONES,
    "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN:",
    '1. sáb 26 sep, 10:00 → startUtc "2026-09-26T16:00:00.000Z"',
    '2. sáb 26 sep, 16:00 → startUtc "2026-09-26T22:00:00.000Z"',
  ].join("\n");

  it("«a las 16:00» toma la de las 16:00, no la que la lleva en el ISO", () => {
    expect(run(CATALOGO, "Agéndame a las 16:00").startUtc).toBe(
      "2026-09-26T22:00:00.000Z"
    );
  });

  it("«a las 10:00» sigue tomando la suya", () => {
    expect(run(CATALOGO, "Agéndame a las 10:00").startUtc).toBe(
      "2026-09-26T16:00:00.000Z"
    );
  });
});

/**
 * Ajuste 2026-09-26 — La franja viaja SOLO si el cliente habló de la parte del
 * día. «mañana» a secas queda fuera a propósito: en español es también el día
 * siguiente, y mandarla como franja filtraría el menú por error.
 */
describe("015 — ai-mock y la franja del día", () => {
  it("«¿algo por la tarde?» pide la tarde", () => {
    const r = run(ACCIONES, "¿Tienen algo por la tarde?");
    expect(r.action).toBe("offer_slots");
    expect(r.franja).toBe("tarde");
  });

  it("«temprano» y «por la mañana» piden la mañana", () => {
    expect(run(ACCIONES, "¿Algo temprano?").franja).toBe("mañana");
    expect(run(ACCIONES, "Mejor por la mañana, ¿hay cita?").franja).toBe("mañana");
  });

  it("«¿hay algo mañana?» NO manda franja: ahí mañana es el día", () => {
    const r = run(ACCIONES, "¿Hay algo mañana para una cita?");
    expect(r.action).toBe("offer_slots");
    expect(r.franja).toBeUndefined();
  });

  it("sin franja pedida, se ofrece sin filtrar", () => {
    expect(run(ACCIONES, "Quiero agendar una cita").franja).toBeUndefined();
  });
});
