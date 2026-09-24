import { afterEach, describe, expect, it } from "vitest";
import { agendaModel, modelForTurn } from "@/server/agenda/flag";

/**
 * 015 (ajuste 2026-09-23) — `AGENDA_MODEL`: modelo bueno SOLO donde se decide
 * una cita.
 *
 * La promesa es de costo, y por eso se testea la ventana, no el modelo: poner
 * el modelo caro en todos los turnos multiplica el gasto de cada conversación
 * del negocio. La ventana es "hay horarios ofrecidos en esta conversación",
 * que el motor abre al ofrecer y cierra al reservar.
 */

const ANTES = process.env.AGENDA_MODEL;
afterEach(() => {
  if (ANTES === undefined) delete process.env.AGENDA_MODEL;
  else process.env.AGENDA_MODEL = ANTES;
});

describe("015 — AGENDA_MODEL", () => {
  it("sin la variable no cambia nada: el turno usa el modelo de siempre", () => {
    delete process.env.AGENDA_MODEL;
    expect(agendaModel()).toBeUndefined();
    expect(modelForTurn({ agenda: true, ofrecidos: 12 })).toBeUndefined();
  });

  it("una variable vacía o en blanco cuenta como no definida", () => {
    for (const v of ["", "   "]) {
      process.env.AGENDA_MODEL = v;
      expect(agendaModel()).toBeUndefined();
      expect(modelForTurn({ agenda: true, ofrecidos: 12 })).toBeUndefined();
    }
  });

  it("con horarios ofrecidos, el turno lo conduce el modelo de agenda", () => {
    process.env.AGENDA_MODEL = "anthropic/claude-sonnet-5";
    expect(modelForTurn({ agenda: true, ofrecidos: 1 })).toBe("anthropic/claude-sonnet-5");
    expect(modelForTurn({ agenda: true, ofrecidos: 40 })).toBe("anthropic/claude-sonnet-5");
  });

  it("sin horarios ofrecidos NO se paga el modelo caro (incluido el turno de entrada)", () => {
    process.env.AGENDA_MODEL = "anthropic/claude-sonnet-5";
    expect(modelForTurn({ agenda: true, ofrecidos: 0 })).toBeUndefined();
  });

  it("con la agenda apagada tampoco, aunque la variable esté puesta", () => {
    process.env.AGENDA_MODEL = "anthropic/claude-sonnet-5";
    expect(modelForTurn({ agenda: false, ofrecidos: 12 })).toBeUndefined();
  });

  it("el valor viaja recortado, no con los espacios del panel de hosting", () => {
    process.env.AGENDA_MODEL = "  anthropic/claude-sonnet-5  ";
    expect(agendaModel()).toBe("anthropic/claude-sonnet-5");
  });
});
