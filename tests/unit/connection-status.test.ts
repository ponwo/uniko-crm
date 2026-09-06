import { describe, expect, it } from "vitest";
import type { EventsStatus } from "@/components/use-events";

/**
 * Las reglas del aviso de conexión (018, US2), probadas como decisión y no
 * como pintura.
 *
 * Lo que importa aquí no es el color: es CUÁNDO se dice algo y qué se dice.
 * Dos reglas que la spec fija y que son fáciles de romper sin darse cuenta:
 *
 * - El aviso NO se retira al reconectar, sino cuando el catch-up termina
 *   (FR-311). Reconectar no es estar al día.
 * - "Reconectando" y "sin conexión" son estados distintos (FR-310): uno pide
 *   esperar, el otro pide actuar.
 */

/** Espeja la condición del componente: ¿hay algo que contar? */
function hayProblema(status: EventsStatus): boolean {
  return status.state !== "conectado" || status.catchingUp;
}

/** Espeja `describir` del componente en lo que importa: qué se dice. */
function etiqueta(status: EventsStatus): string {
  if (status.state === "sesion-terminada") return "Sesión terminada";
  if (status.state === "sin-conexion") return "Sin conexión";
  return status.catchingUp ? "Poniendo al día…" : "Reconectando…";
}

const conectado: EventsStatus = { state: "conectado", catchingUp: false };

describe("cuándo se avisa", () => {
  it("conectado y al día: no se dice nada (el estado normal no se adorna)", () => {
    expect(hayProblema(conectado)).toBe(false);
  });

  it("reconectando: se avisa", () => {
    expect(hayProblema({ state: "reconectando", catchingUp: false })).toBe(true);
  });

  it("sin conexión: se avisa", () => {
    expect(hayProblema({ state: "sin-conexion", catchingUp: false })).toBe(true);
  });

  /** FR-311: el momento exacto en que sería fácil mentir. */
  it("conectado PERO todavía poniéndose al día: se sigue avisando", () => {
    expect(hayProblema({ state: "conectado", catchingUp: true })).toBe(true);
  });

  it("solo se calla cuando además el catch-up terminó", () => {
    const durante: EventsStatus = { state: "conectado", catchingUp: true };
    const despues: EventsStatus = { state: "conectado", catchingUp: false };
    expect(hayProblema(durante)).toBe(true);
    expect(hayProblema(despues)).toBe(false);
  });
});

describe("qué se dice (FR-310: son estados distintos)", () => {
  it("reconectando pide esperar", () => {
    expect(etiqueta({ state: "reconectando", catchingUp: false })).toBe(
      "Reconectando…"
    );
  });

  it("sin conexión es otra cosa, no el mismo mensaje", () => {
    expect(etiqueta({ state: "sin-conexion", catchingUp: false })).toBe(
      "Sin conexión"
    );
  });

  it("no se funden en un aviso genérico", () => {
    const a = etiqueta({ state: "reconectando", catchingUp: false });
    const b = etiqueta({ state: "sin-conexion", catchingUp: false });
    expect(a).not.toBe(b);
  });

  it("poniéndose al día se distingue de reconectando", () => {
    const a = etiqueta({ state: "conectado", catchingUp: true });
    const b = etiqueta({ state: "reconectando", catchingUp: false });
    expect(a).not.toBe(b);
  });

  it("la sesión terminada pide actuar, no esperar", () => {
    expect(etiqueta({ state: "sesion-terminada", catchingUp: false })).toBe(
      "Sesión terminada"
    );
  });
});
