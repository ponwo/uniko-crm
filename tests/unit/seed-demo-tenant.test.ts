import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { seedDemo } from "@/server/seed/demo";

/**
 * Principio III en el seed demo.
 *
 * El seed buscaba los contactos previos SOLO por teléfono. Los teléfonos de la
 * demo son constantes del repo —los mismos en todas las instancias—, así que en
 * una base con más de una organización esa consulta encontraba los contactos
 * demo de OTRO negocio y los borraba con sus conversaciones, mensajes y leads.
 *
 * Era inerte porque hoy una instancia es un negocio. Esa suposición es
 * exactamente la que el Principio III prohíbe hacer dentro de una query, y es
 * la clase de cosa que deja de ser inerte sin que nadie lo anuncie.
 *
 * El test no comprueba "la línea que arreglamos": comprueba que **ninguna**
 * consulta del seed sale sin tenant. Es la única forma de que esto no vuelva.
 */

const dialect = new PgDialect();
const aSql = (cond: unknown) => dialect.sqlToQuery(cond as SQL).sql;

type Captura = { tipo: "select" | "delete" | "update"; where: unknown };

/**
 * BD simulada: `seedDemo(db, orgId)` recibe la conexión por parámetro, así que
 * basta pasarle esto — no hace falta mockear el módulo.
 */
function fakeDb(filasPorSelect: unknown[][]) {
  const capturas: Captura[] = [];
  const inserts: unknown[] = [];
  let iSelect = 0;

  const thenable = (valor: unknown) => ({
    then: (resolve: (v: unknown) => void) => Promise.resolve(valor).then(resolve),
  });

  /*
   * Desde la 022, parte del seed corre dentro de una transacción y la guardia
   * lee el perfil con `.limit(1)`. El fake tiene que hablar los dos idiomas —y
   * registrar las capturas en la MISMA lista salga por donde salga la
   * sentencia—: lo que este archivo vigila es que ninguna consulta del seed
   * pierda su `organization_id`, y una que se escondiera dentro de la
   * transacción contaría igual.
   */
  function conector(): Record<string, unknown> {
    return {
      select: () => {
        const filas = filasPorSelect[iSelect++] ?? [];
        const cadena: Record<string, unknown> = {};
        cadena.from = () => cadena;
        cadena.limit = () => cadena;
        cadena.where = (cond: unknown) => {
          capturas.push({ tipo: "select", where: cond });
          return cadena;
        };
        (cadena as { then: unknown }).then = (resolve: (v: unknown) => void) =>
          Promise.resolve(filas).then(resolve);
        return cadena;
      },
      delete: () => ({
        where: (cond: unknown) => {
          capturas.push({ tipo: "delete", where: cond });
          return thenable(undefined);
        },
      }),
      insert: () => ({
        values: (v: unknown) => {
          inserts.push(v);
          return thenable(undefined);
        },
      }),
      update: () => ({
        set: () => ({
          where: (cond: unknown) => {
            capturas.push({ tipo: "update", where: cond });
            return thenable(undefined);
          },
        }),
      }),
      // El cerrojo consultivo: no lleva `where`, así que no se captura.
      execute: () => thenable(undefined),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(conector()),
    };
  }

  const db = conector();

  return { db, capturas, inserts };
}

const ORG = "org_de_prueba";
const UNA_ETAPA = [{ id: "st_1", name: "Interesado", position: 0 }];

/**
 * Lo que consumen los cuatro `select` de la guardia (022) antes de que el seed
 * llegue a su limpieza: cero contactos, cero conocimiento, cero corridas y sin
 * fila de perfil. Es decir, una organización virgen — que es la única sobre la
 * que el seed sigue adelante.
 */
const GUARDIA_VIRGEN: unknown[][] = [[{ n: 0 }], [{ n: 0 }], [{ n: 0 }], []];

describe("seedDemo y el Principio III", () => {
  it("la búsqueda de contactos previos filtra por organization_id", async () => {
    // Sin contactos previos: el camino corto, el que corre en una instancia
    // recién estrenada.
    const { db, capturas } = fakeDb([...GUARDIA_VIRGEN, [], UNA_ETAPA]);
    await seedDemo(db as never, ORG);

    // Se busca POR SU CONTENIDO y no por posición: desde la 022 la guardia
    // consulta antes que la limpieza, y un test que dependa del orden se rompe
    // cada vez que alguien añade una consulta delante.
    const porTelefono = capturas
      .filter((c) => c.tipo === "select")
      .map((c) => aSql(c.where))
      .find((sql) => sql.includes('"contact"."phone"'));

    expect(porTelefono).toBeDefined();
    expect(porTelefono).toContain('"contact"."organization_id"');
  });

  it("NINGUNA consulta del seed sale sin tenant, ni siquiera las de limpieza", async () => {
    // Con contactos y conversaciones previas se recorre el bloque entero de
    // borrado, que es el que puede hacer daño.
    const { db, capturas } = fakeDb([
      ...GUARDIA_VIRGEN,
      [{ id: "ct_1" }],
      [{ id: "cv_1" }],
      UNA_ETAPA,
    ]);
    await seedDemo(db as never, ORG);

    // Si el fake no hubiera ejercido el bloque de limpieza, este test pasaría
    // sin comprobar nada.
    expect(capturas.length).toBeGreaterThanOrEqual(8);
    expect(capturas.filter((c) => c.tipo === "delete").length).toBeGreaterThanOrEqual(7);

    for (const captura of capturas) {
      expect(aSql(captura.where)).toContain("organization_id");
    }
  });

  it("el borrado del conocimiento sigue siendo de la organización que se pide", async () => {
    // No cambia lo que este seed destruye —sigue borrando el KB entero— pero
    // el destrozo no puede cruzar de inquilino.
    const { db, capturas } = fakeDb([...GUARDIA_VIRGEN, [], UNA_ETAPA]);
    await seedDemo(db as never, "org_a");

    const borradosDeKb = capturas.filter(
      (c) => c.tipo === "delete" && aSql(c.where).includes('"kb_entry"')
    );
    expect(borradosDeKb).toHaveLength(1);
    expect(aSql(borradosDeKb[0]?.where)).toContain('"kb_entry"."organization_id"');
  });
});
