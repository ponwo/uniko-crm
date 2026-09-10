import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * 021 Entrega 3 — Principio III en los escenarios propios, y el guardarraíl
 * que protege a los contactos reales del inquilino (FR-628).
 *
 * El test de tenant no comprueba "la línea que escribimos bien": comprueba que
 * **ninguna** consulta del módulo sale sin `organization_id`, renderizando cada
 * WHERE con el dialecto de Postgres. Es la única forma de que un descuido
 * futuro no pase inadvertido — y hay precedente en este mismo repositorio, el
 * seed demo, donde una consulta sin tenant vivió meses sin que nadie la viera.
 */

const dialect = new PgDialect();
const aSql = (cond: unknown) => dialect.sqlToQuery(cond as SQL).sql;

type Captura = { tipo: string; where: unknown };
const capturas: Captura[] = [];
let filasPorSelect: unknown[][] = [];
let iSelect = 0;
const inserts: unknown[] = [];

const thenable = (valor: unknown) => ({
  then: (resolve: (v: unknown) => void) => Promise.resolve(valor).then(resolve),
});

const fakeDb = {
  select: () => ({
    from: () => ({
      where: (cond: unknown) => {
        capturas.push({ tipo: "select", where: cond });
        const filas = filasPorSelect[iSelect++] ?? [];
        return Object.assign(thenable(filas), {
          limit: () => thenable(filas),
          orderBy: () => thenable(filas),
        });
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: (cond: unknown) => {
        capturas.push({ tipo: "update", where: cond });
        return Object.assign(thenable(undefined), {
          returning: () => thenable([{ id: "esc_1" }]),
        });
      },
    }),
  }),
  insert: () => ({
    values: (v: unknown) => {
      inserts.push(v);
      return thenable(undefined);
    },
  }),
};

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => fakeDb };
});

const {
  borrarEscenario,
  contarEscenariosPropios,
  crearEscenarios,
  editarEscenario,
  escenariosPropios,
  etiquetasPropias,
  validarTelefonoDeEscenario,
} = await import("@/server/lab/escenarios");

const ORG = "org_lanco";

beforeEach(() => {
  capturas.length = 0;
  inserts.length = 0;
  filasPorSelect = [];
  iSelect = 0;
});

describe("Principio III — ninguna consulta sale sin tenant", () => {
  it("las lecturas llevan organization_id", async () => {
    filasPorSelect = [[], [], []];
    await escenariosPropios(ORG);
    await etiquetasPropias(ORG);
    await contarEscenariosPropios(ORG);

    expect(capturas.length).toBe(3);
    for (const c of capturas) {
      expect(aSql(c.where), `consulta sin tenant: ${aSql(c.where)}`).toContain(
        "organization_id"
      );
    }
  });

  it("las escrituras también", async () => {
    filasPorSelect = [[{ id: "esc_1", label: "x", description: null, script: ["a", "b"], enabled: true }]];
    await editarEscenario(ORG, "esc_1", { label: "otro" });
    await borrarEscenario(ORG, "esc_1");

    const escrituras = capturas.filter((c) => c.tipo === "update");
    expect(escrituras.length).toBeGreaterThan(0);
    for (const c of escrituras) {
      expect(aSql(c.where)).toContain("organization_id");
    }
  });

  /** `scoped()` revienta con un organizationId vacío. Es su razón de existir. */
  it("una organización vacía no produce una consulta sin filtro", async () => {
    filasPorSelect = [[]];
    await expect(escenariosPropios("")).rejects.toThrow(/sin tenant/i);
  });
});

describe("el teléfono no puede pisar a un contacto real (FR-628)", () => {
  it("rechaza el número que ya es de un contacto de esa organización", async () => {
    // La primera consulta encuentra un contacto: colisión.
    filasPorSelect = [[{ id: "ct_real" }]];
    const r = await validarTelefonoDeEscenario(ORG, "5219123456789");
    expect(r).toBe("colisiona_con_contacto_real");
  });

  it("acepta el número libre del rango reservado", async () => {
    filasPorSelect = [[], []];
    expect(await validarTelefonoDeEscenario(ORG, "5219123456789")).toBeNull();
  });

  /**
   * Ni siquiera llega a consultar si el número está fuera del rango: eso es
   * decisión pura y se resuelve antes de tocar la base.
   */
  it("un número fuera del rango se rechaza sin consultar", async () => {
    const r = await validarTelefonoDeEscenario(ORG, "5215512345678");
    expect(r).toBe("fuera_del_rango_reservado");
    expect(capturas.length).toBe(0);
  });

  it("y uno del bloque de los seis genéricos, tampoco", async () => {
    expect(await validarTelefonoDeEscenario(ORG, "5210000000003")).toBe(
      "rango_de_genericos"
    );
    expect(capturas.length).toBe(0);
  });
});

describe("crear escenarios valida TODO antes de escribir NADA", () => {
  it("un guion malo en el segundo aborta el lote entero", async () => {
    filasPorSelect = [[], []]; // contar → 0, teléfono libre
    const r = await crearEscenarios(ORG, [
      { label: "Bueno", description: "", script: ["Hola", "¿Cuánto cuesta?"] },
      { label: "Malo", description: "", script: ["Solo una"] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fallo.tipo).toBe("guion");
    expect(
      inserts.length,
      "Se escribió algo pese a que una propuesta era inválida: el dueño se " +
        "quedaría con un conjunto que él no revisó."
    ).toBe(0);
  });

  it("el tope se comprueba en el servidor, no solo en la pantalla", async () => {
    filasPorSelect = [new Array(8).fill({ id: "x" })]; // ya hay 8
    const r = await crearEscenarios(ORG, [
      { label: "Uno más", description: "", script: ["Hola", "¿Precio?"] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fallo.tipo).toBe("limite");
    expect(inserts.length).toBe(0);
  });
});
