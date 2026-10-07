import { describe, expect, it } from "vitest";
import { kbCreateSchema, kbPatchSchema } from "@/server/kb/esquemas";

/**
 * 033 — Lo que aceptan el alta y la edición de una entrada (FR-1831, FR-1836).
 *
 * La edición distingue tres casos que en JSON se parecen —ausente, fecha y
 * `null`— y de eso depende poder renovar sin reescribir el texto y volver
 * permanente una entrada que ya tuvo fecha.
 */

describe("033 — alta de una entrada", () => {
  it("sin fecha, o con null: permanente", () => {
    const sin = kbCreateSchema.parse({ kind: "qa", question: "¿Envíos?", answer: "Sí" });
    expect(sin.validUntil).toBeUndefined();
    const nula = kbCreateSchema.parse({ kind: "block", content: "Horario", validUntil: null });
    expect(nula.validUntil).toBeNull();
  });

  it("con fecha, en los dos tipos; una fecha pasada también entra (archivar a propósito)", () => {
    expect(
      kbCreateSchema.parse({ kind: "qa", question: "¿Promo?", answer: "2x1", validUntil: "2026-10-15" })
        .validUntil
    ).toBe("2026-10-15");
    expect(
      kbCreateSchema.parse({ kind: "block", content: "Curso", validUntil: "2020-01-31" }).validUntil
    ).toBe("2020-01-31");
  });

  it("«el martes» y «2026-02-31» se rechazan con el mensaje de qué se esperaba", () => {
    const a = kbCreateSchema.safeParse({ kind: "qa", question: "¿P?", answer: "R", validUntil: "el martes" });
    expect(a.success).toBe(false);
    expect(a.error?.issues[0]?.path).toEqual(["validUntil"]);
    expect(a.error?.issues[0]?.message).toMatch(/AAAA-MM-DD/);

    const b = kbCreateSchema.safeParse({ kind: "block", content: "X", validUntil: "2026-02-31" });
    expect(b.success).toBe(false);
    expect(b.error?.issues[0]?.message).toMatch(/no existe/);
  });
});

describe("033 — edición de una entrada", () => {
  it("campo ausente = no tocar la fecha (se edita solo el texto)", () => {
    const r = kbPatchSchema.parse({ answer: "Nuevo texto" });
    expect("validUntil" in r).toBe(false);
    expect(r).toEqual({ answer: "Nuevo texto" });
  });

  it("una fecha = ponerla o moverla, sin tocar el texto", () => {
    expect(kbPatchSchema.parse({ validUntil: "2026-11-15" })).toEqual({ validUntil: "2026-11-15" });
  });

  it("null = quitarla: la entrada vuelve a ser permanente", () => {
    expect(kbPatchSchema.parse({ validUntil: null })).toEqual({ validUntil: null });
  });

  it("una fecha imposible no pasa", () => {
    expect(kbPatchSchema.safeParse({ validUntil: "2026-13-01" }).success).toBe(false);
  });
});
