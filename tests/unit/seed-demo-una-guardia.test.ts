import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * AC-14 — Una sola implementación de la guardia (FR-703).
 *
 * **Vive en su propio archivo a propósito.** Aquí se sustituye el módulo de la
 * guardia por un doble, y `seed-demo-guardia.test.ts` necesita la de verdad
 * para todo lo demás: mockearla allí habría roto los otros treinta y nueve
 * tests. Un archivo aparte cuesta menos que un mock parcial que nadie entiende
 * dentro de un año.
 *
 * Dos afirmaciones, **ninguna a través de los handlers HTTP**: el `GET` va
 * envuelto en `withAuth`, que responde 401 antes de llegar al cuerpo, y probarlo
 * exigiría construir simulación de sesión — maquinaria que este repositorio no
 * tiene y que no debe salir de un criterio de aceptación.
 *
 * Lo que sí atrapa, que es el riesgo real: que alguien **reimplemente** la
 * comprobación en el render en vez de llamar a la única que hay.
 */

// Los parámetros se declaran para poder MIRARLOS: el manejador que recibe es
// justo lo que este criterio afirma.
const revisarDemo = vi.fn(async (_conexion: unknown, _organizationId: string) => ({
  virgen: true,
  encontrado: [],
}));

vi.mock("@/server/seed/guardia", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/seed/guardia")>();
  // El doble devuelve un hallazgo BIEN FORMADO: `seedDemo()` lee el resultado
  // para decidir, y un `vi.fn()` pelado reventaría el test por una razón que no
  // es la que se está probando.
  return { ...original, revisarDemo };
});

const { seedDemo } = await import("@/server/seed/demo");

function fakeConTransaccion() {
  const thenable = (valor: unknown) => ({
    then: (r: (v: unknown) => void) => Promise.resolve(valor).then(r),
  });
  const conector = (marca: string): Record<string, unknown> => ({
    marca,
    select: () => {
      const cadena: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "orderBy"]) cadena[m] = () => cadena;
      (cadena as { then: unknown }).then = (r: (v: unknown) => void) =>
        Promise.resolve([{ id: "st_1", name: "Interesado" }]).then(r);
      return cadena;
    },
    insert: () => ({ values: () => thenable(undefined) }),
    update: () => ({ set: () => ({ where: () => thenable(undefined) }) }),
    delete: () => ({ where: () => thenable(undefined) }),
    execute: () => thenable(undefined),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(conector("tx")),
  });
  return conector("db");
}

describe("AC-14 (i) — la ejecución llama a la guardia, y con el tx", () => {
  it("seedDemo() no trae su propia comprobación: llama al módulo", async () => {
    revisarDemo.mockClear();
    await seedDemo(fakeConTransaccion() as never, "org_1");

    expect(revisarDemo).toHaveBeenCalledTimes(1);
  });

  it("y el primer argumento es el tx, no el db exterior", async () => {
    revisarDemo.mockClear();
    await seedDemo(fakeConTransaccion() as never, "org_1");

    // El manejador viaja como argumento, así que se observa sin clasificar SQL.
    // Es lo que cierra FR-704 por el lado de la comprobación, donde AC-7 no
    // llega: con la guardia real sus consultas son SELECT de conteo,
    // indistinguibles de las que el propio seed hace.
    const conexion = revisarDemo.mock.calls[0]?.[0] as { marca?: string } | undefined;
    expect(conexion?.marca).toBe("tx");
  });
});

describe("AC-14 (ii) — no hay una segunda implementación", () => {
  const fuenteDeLaRuta = readFileSync("src/app/api/seed/demo/route.ts", "utf8");

  it("la ruta importa la guardia del módulo de la guardia", () => {
    expect(fuenteDeLaRuta).toMatch(
      /import \{[^}]*revisarDemo[^}]*\} from "@\/server\/seed\/guardia"/
    );
  });

  it("y la ruta NO inspecciona por su cuenta las tablas que la guardia vigila", () => {
    // Si alguien decide "aquí es más cómodo consultarlo directamente", esto se
    // pone rojo. Es el fallo original de esta feature repetido en otra capa: la
    // guardia vieja miraba una tabla y la operación destruía otras cuatro.
    for (const tabla of ["kbEntry", "agentTestRun", "agentProfile", "contact"]) {
      expect(fuenteDeLaRuta).not.toContain(`schema.${tabla}`);
    }
  });
});
