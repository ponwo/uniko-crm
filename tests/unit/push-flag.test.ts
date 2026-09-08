import { afterEach, describe, expect, it } from "vitest";
import { parsePushFlag, pushDisabledResponse, pushEnabled } from "@/server/push/flag";

describe("la bandera PUSH", () => {
  const original = process.env.PUSH;
  afterEach(() => {
    if (original === undefined) delete process.env.PUSH;
    else process.env.PUSH = original;
  });

  it("cuenta como encendida con los valores del patrón", () => {
    for (const v of ["on", "1", "true", "si", "sí", "yes", "ON", " True "]) {
      expect(parsePushFlag(v), v).toBe(true);
    }
  });

  it("cualquier otra cosa es apagada", () => {
    for (const v of ["off", "0", "false", "no", "", "  ", "quizá"]) {
      expect(parsePushFlag(v), v).toBe(false);
    }
  });

  it("sin la variable, apagada — y sin lanzar", () => {
    delete process.env.PUSH;
    expect(() => pushEnabled()).not.toThrow();
    expect(pushEnabled()).toBe(false);
  });

  it("lee process.env directo: preguntar por la bandera no depende del entorno completo", () => {
    // Si esto pasara por getEnv(), una escalación reventaría en vez de degradar
    // cuando faltara cualquier otra variable — y la escalación no puede
    // depender del aviso (FR-504).
    process.env.PUSH = "on";
    expect(pushEnabled()).toBe(true);
  });

  it("la superficie apagada responde 404, no 403", () => {
    // 404 a propósito: si los avisos no existen en esta instancia, no hay nada
    // que revelar sobre ese endpoint.
    expect(pushDisabledResponse().status).toBe(404);
  });
});
