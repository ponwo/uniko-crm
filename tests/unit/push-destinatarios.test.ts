import { describe, expect, it } from "vitest";
import { destinatarios } from "@/server/push/avisar";

const suscripciones = [
  { id: "ps_1", endpoint: "https://fcm.googleapis.com/fcm/send/uno" },
  { id: "ps_2", endpoint: "https://updates.push.services.mozilla.com/dos" },
];

describe("a quién se avisa de una escalación", () => {
  it("con todo encendido, a todos los del equipo con suscripción viva", () => {
    expect(
      destinatarios({
        esConversacionDePrueba: false,
        banderaEncendida: true,
        suscripciones,
      })
    ).toHaveLength(2);
  });

  it("una conversación DEL LABORATORIO no avisa a nadie", () => {
    // El Laboratorio escala por el mismo pipeline. Sin este corte, evaluar el
    // agente llenaría de notificaciones reales los teléfonos del equipo. Es el
    // mismo guardarraíl del sandbox que ya protege el envío de WhatsApp.
    expect(
      destinatarios({
        esConversacionDePrueba: true,
        banderaEncendida: true,
        suscripciones,
      })
    ).toEqual([]);
  });

  it("y el corte del Laboratorio manda aunque la bandera esté encendida", () => {
    // Es el primer filtro por diseño: no depende de la configuración.
    expect(
      destinatarios({
        esConversacionDePrueba: true,
        banderaEncendida: true,
        suscripciones,
      })
    ).toEqual([]);
  });

  it("con la bandera apagada, nadie", () => {
    expect(
      destinatarios({
        esConversacionDePrueba: false,
        banderaEncendida: false,
        suscripciones,
      })
    ).toEqual([]);
  });

  it("sin suscripciones, nadie — y sin romperse", () => {
    expect(
      destinatarios({
        esConversacionDePrueba: false,
        banderaEncendida: true,
        suscripciones: [],
      })
    ).toEqual([]);
  });
});
