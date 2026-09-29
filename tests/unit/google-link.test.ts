import { describe, expect, it, vi } from "vitest";

/**
 * 029 — El registro de links: las decisiones que NO dependen de la base.
 *
 * Los cortes de tiempo viven en código a propósito (memoria
 * `fallos-que-solo-aparecen-con-el-tiempo`): aquí se lee un link "de hace
 * tres días" sin esperar tres días. Lo que toca Postgres —la transacción de
 * consumir y la carrera de dos pestañas— lo ejerce el arnés contra la base real.
 */

// Cualquier consulta a la base en estos casos sería un fallo: se hace estallar.
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("no debía tocar la base");
  },
  schema: { googleLink: {}, googleCredentials: {} },
}));

const {
  GOOGLE_LINK_TTL_MS,
  findGoogleLink,
  hashLinkToken,
  linkCheckFor,
  linkState,
  linkStatusFor,
} = await import("@/server/agenda/connectors/google-link");

const T0 = new Date("2026-09-27T12:00:00.000Z");
const base = {
  id: "glink_1",
  organizationId: "org_1",
  expiresAt: new Date(T0.getTime() + GOOGLE_LINK_TTL_MS),
  usedAt: null,
  revokedAt: null,
};
const horas = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("029 — el estado de un link en el tiempo", () => {
  it("dura 72 horas", () => {
    expect(GOOGLE_LINK_TTL_MS).toBe(72 * 3_600_000);
    expect(linkState(base, horas(71.9))).toBe("pendiente");
    expect(linkState(base, horas(72))).toBe("vencido");
    expect(linkState(base, horas(24 * 3 + 1))).toBe("vencido");
  });

  it("usado y revocado mandan sobre vencido: quien reabre un link de ayer oye la verdad", () => {
    expect(linkState({ ...base, usedAt: horas(1) }, horas(100))).toBe("usado");
    expect(linkState({ ...base, revokedAt: horas(1) }, horas(100))).toBe("revocado");
  });

  it("para quien lo abre: usado → link_usado, vencido → link_vencido, revocado o inexistente → link_invalido", () => {
    expect(linkCheckFor(base, horas(1))).toEqual({ ok: true, link: base });
    expect(linkCheckFor({ ...base, usedAt: horas(1) }, horas(2))).toEqual({
      ok: false,
      motivo: "link_usado",
    });
    expect(linkCheckFor(base, horas(73))).toEqual({ ok: false, motivo: "link_vencido" });
    expect(linkCheckFor({ ...base, revokedAt: horas(1) }, horas(2))).toEqual({
      ok: false,
      motivo: "link_invalido",
    });
    expect(linkCheckFor(null, horas(1))).toEqual({ ok: false, motivo: "link_invalido" });
  });
});

describe("029 — lo que la pantalla sabe del link más reciente (FR-1408, FR-1429)", () => {
  const conFecha = { ...base, createdAt: T0 };

  it("sin links: nada pendiente ni usado", () => {
    expect(linkStatusFor(null, horas(1))).toEqual({ pending: null, usedAt: null });
  });

  it("pendiente: cuándo se creó y cuándo vence, sin usar", () => {
    expect(linkStatusFor(conFecha, horas(1))).toEqual({
      pending: { createdAt: T0, expiresAt: base.expiresAt },
      usedAt: null,
    });
  });

  it("usado: cuándo, aunque ya haya pasado su vencimiento", () => {
    expect(linkStatusFor({ ...conFecha, usedAt: horas(2) }, horas(100))).toEqual({
      pending: null,
      usedAt: horas(2),
    });
  });

  it("revocado o vencido sin usar: ni pendiente ni usado", () => {
    expect(linkStatusFor({ ...conFecha, revokedAt: horas(1) }, horas(2))).toEqual({
      pending: null,
      usedAt: null,
    });
    expect(linkStatusFor(conFecha, horas(73))).toEqual({ pending: null, usedAt: null });
  });
});

describe("029 — la llave", () => {
  it("se guarda solo su huella: SHA-256, determinista y distinta de la llave", () => {
    const llave = "a".repeat(43);
    const huella = hashLinkToken(llave);
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    expect(huella).toBe(hashLinkToken(llave));
    expect(huella).not.toContain(llave);
  });

  it("una llave con forma imposible no llega ni a consultar la base", async () => {
    await expect(findGoogleLink("")).resolves.toBeNull();
    await expect(findGoogleLink("corta")).resolves.toBeNull();
    await expect(findGoogleLink("con espacios y signos!".repeat(3))).resolves.toBeNull();
    await expect(findGoogleLink("x".repeat(200))).resolves.toBeNull();
  });
});
