import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 033 — La vigencia del conocimiento.
 *
 * Lo que se juega aquí es lo que ningún arnés puede fabricar: que pase el
 * tiempo. Una entrada «vigente hasta el 7» tiene que valer TODO el 7 en México
 * —también a las 18:30, cuando en UTC (la hora del servidor) ya es día 8— y
 * dejar de valer el 8.
 *
 * El corte vive en código (`soloVigentes`) y no en el `where` para que estas
 * pruebas puedan existir: el doble de base de aquí abajo IGNORA el `where`, como
 * todos los del repo. Con el filtro en SQL, la puerta devolvería la entrada
 * vencida en esta prueba y en ninguna otra parte se notaría.
 */

let filas: Record<string, unknown>[] = [];

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.orderBy = () => Promise.resolve(filas);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain() }),
  schema: { kbEntry: {} },
}));

const { getSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ timezone: "America/Tijuana" })),
}));
vi.mock("@/server/agenda/settings", () => ({ getSettings }));

const {
  DIAS_AVISO_VENCIMIENTO,
  conocimientoCompleto,
  conocimientoVigente,
  estadoDeVigencia,
  fechaDeVigencia,
  hoyDelNegocio,
  soloVigentes,
} = await import("@/server/kb/vigencia");
const { zonaDelNegocio } = await import("@/server/negocio/zona");

/** Miércoles 7 de octubre de 2026, 18:30 en México = jueves 8, 00:30 UTC. */
const MX_1830_DEL_7 = new Date("2026-10-08T00:30:00.000Z");

const entrada = (id: string, validUntil: string | null) => ({
  id,
  organizationId: "org_1",
  kind: "qa" as const,
  question: `¿${id}?`,
  answer: id,
  content: null,
  validUntil,
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-01T12:00:00.000Z"),
});

const agendaAntes = process.env.AGENDA;
beforeEach(() => {
  delete process.env.AGENDA;
  getSettings.mockClear();
  filas = [];
});
afterEach(() => {
  if (agendaAntes === undefined) delete process.env.AGENDA;
  else process.env.AGENDA = agendaAntes;
});

describe("033 — estado de una entrada (función pura)", () => {
  const HOY = "2026-10-07";

  it("sin fecha es permanente: vigente siempre", () => {
    expect(estadoDeVigencia(null, HOY)).toBe("vigente");
  });

  it("con fecha = hoy vale TODO hoy (corte inclusivo): por vencer, no vencida", () => {
    expect(estadoDeVigencia("2026-10-07", HOY)).toBe("por_vencer");
  });

  it("ayer ya no vale", () => {
    expect(estadoDeVigencia("2026-10-06", HOY)).toBe("vencida");
    expect(estadoDeVigencia("2025-01-31", HOY)).toBe("vencida");
  });

  it(`por vencer = dentro de ${DIAS_AVISO_VENCIMIENTO} días, inclusive; uno más ya es vigente`, () => {
    expect(estadoDeVigencia("2026-10-21", HOY)).toBe("por_vencer");
    expect(estadoDeVigencia("2026-10-22", HOY)).toBe("vigente");
    expect(estadoDeVigencia("2027-01-31", HOY)).toBe("vigente");
  });

  it("el corte cruza meses y años sin tropezar", () => {
    expect(estadoDeVigencia("2026-12-31", "2027-01-01")).toBe("vencida");
    expect(estadoDeVigencia("2027-01-01", "2026-12-31")).toBe("por_vencer");
  });

  it("soloVigentes deja fuera lo vencido y conserva el orden", () => {
    const lista = [
      entrada("permanente", null),
      entrada("vencida", "2026-10-06"),
      entrada("hoy", "2026-10-07"),
      entrada("futura", "2027-01-31"),
    ];
    expect(soloVigentes(lista, HOY).map((e) => e.id)).toEqual([
      "permanente",
      "hoy",
      "futura",
    ]);
  });
});

describe("033 — «hoy» es el de México, nunca el de UTC", () => {
  it("a las 18:30 del 7 en México, hoy es el 7 (en UTC ya sería el 8)", async () => {
    await expect(hoyDelNegocio("org_1", { ahora: MX_1830_DEL_7 })).resolves.toBe("2026-10-07");
    // Lo que daría el atajo en UTC — que es justo lo que no puede pasar.
    expect(MX_1830_DEL_7.toISOString().slice(0, 10)).toBe("2026-10-08");
  });

  it("la entrada «hasta el 7» sigue llegando al agente a las 18:30 del 7", async () => {
    filas = [entrada("hasta-el-7", "2026-10-07"), entrada("hasta-el-6", "2026-10-06")];
    const vigente = await conocimientoVigente("org_1", { ahora: MX_1830_DEL_7 });
    expect(vigente.map((e) => e.id)).toEqual(["hasta-el-7"]);
  });

  it("y deja de llegar el 8 a medianoche de México", async () => {
    filas = [entrada("hasta-el-7", "2026-10-07")];
    const medianoche = new Date("2026-10-08T06:00:00.000Z"); // 00:00 del 8 en México
    await expect(conocimientoVigente("org_1", { ahora: medianoche })).resolves.toEqual([]);
  });
});

describe("033 — la puerta, con un doble de base que ignora el `where`", () => {
  it("conocimientoVigente: lo vencido no sale, aunque la base lo devuelva", async () => {
    filas = [
      entrada("permanente", null),
      entrada("vencida", "2026-09-30"),
      entrada("por-vencer", "2026-10-10"),
    ];
    const r = await conocimientoVigente("org_1", { ahora: MX_1830_DEL_7 });
    expect(r.map((e) => e.id)).toEqual(["permanente", "por-vencer"]);
  });

  it("conocimientoCompleto: TODO, cada una con su estado, y el hoy con que se calculó", async () => {
    filas = [entrada("permanente", null), entrada("vencida", "2026-09-30")];
    const r = await conocimientoCompleto("org_1", { ahora: MX_1830_DEL_7 });
    expect(r.hoy).toBe("2026-10-07");
    expect(r.entradas.map((e) => [e.id, e.estado])).toEqual([
      ["permanente", "vigente"],
      ["vencida", "vencida"],
    ]);
  });

  it("todo vencido = conocimiento vacío, no un error", async () => {
    filas = [entrada("a", "2026-01-01"), entrada("b", "2026-02-01")];
    await expect(conocimientoVigente("org_1", { ahora: MX_1830_DEL_7 })).resolves.toEqual([]);
  });
});

describe("033 — la zona del negocio", () => {
  /** 06:30 UTC del 8: ya es el 8 en Ciudad de México, todavía el 7 en Tijuana. */
  const ENTRE_ZONAS = new Date("2026-10-08T06:30:00.000Z");

  it("sin agenda: México, sin consultar nada (aunque la agenda tenga otra zona guardada)", async () => {
    await expect(zonaDelNegocio("org_1")).resolves.toBe("America/Mexico_City");
    await expect(hoyDelNegocio("org_1", { ahora: ENTRE_ZONAS })).resolves.toBe("2026-10-08");
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("con agenda: la zona de la agenda, para que el «hoy» del turno sea uno solo", async () => {
    process.env.AGENDA = "on";
    await expect(zonaDelNegocio("org_1")).resolves.toBe("America/Tijuana");
    await expect(hoyDelNegocio("org_1", { ahora: ENTRE_ZONAS })).resolves.toBe("2026-10-07");
  });

  it("si quien llama ya resolvió la zona, la puerta usa ESA", async () => {
    process.env.AGENDA = "on";
    await expect(
      hoyDelNegocio("org_1", { ahora: ENTRE_ZONAS, zona: "America/Mexico_City" })
    ).resolves.toBe("2026-10-08");
    expect(getSettings).not.toHaveBeenCalled();
  });
});

describe("033 — qué cuenta como fecha de vigencia", () => {
  it("acepta una fecha real, también un 29 de febrero bisiesto", () => {
    expect(fechaDeVigencia.safeParse("2026-10-31").success).toBe(true);
    expect(fechaDeVigencia.safeParse("2028-02-29").success).toBe(true);
  });

  it("«el martes» → dice qué formato se esperaba", () => {
    const r = fechaDeVigencia.safeParse("el martes");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/AAAA-MM-DD/);
  });

  it("«2026-02-31» → se rechaza sin lanzar (un throw aquí sería un 500)", () => {
    expect(() => fechaDeVigencia.safeParse("2026-02-31")).not.toThrow();
    const r = fechaDeVigencia.safeParse("2026-02-31");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/no existe/);
  });

  it("mes 13 y día 00 tampoco pasan", () => {
    expect(fechaDeVigencia.safeParse("2026-13-01").success).toBe(false);
    expect(fechaDeVigencia.safeParse("2026-10-00").success).toBe(false);
  });
});
