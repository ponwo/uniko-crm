import { readdirSync, readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schemaReal from "@/lib/db/schema";

/**
 * 022 — La guardia del seed demo.
 *
 * Todo corre con **BD simulada**: este repositorio no tiene carril de tests con
 * base de datos, así que el observable de "no se borró nada" es **que no se
 * emitió ningún borrado**. Afirmar lo que no se puede observar sería peor que
 * afirmar menos.
 *
 * El fake registra, de cada sentencia, **por qué manejador salió** (`db` o el
 * `tx` de la transacción) y **de qué tipo es**. Eso es lo que permite AC-7 y
 * AC-13, en la Fase 2.
 */

/* ══════════════════ BD simulada ══════════════════ */

type Manejador = "db" | "tx";
type Tipo = "select" | "insert" | "update" | "delete" | "execute";

type Sentencia = {
  manejador: Manejador;
  tipo: Tipo;
  tabla: string | null;
  where?: unknown;
  valores?: unknown;
  sql?: unknown;
};

type Fake = {
  db: unknown;
  sentencias: Sentencia[];
  /** ¿Llegó a ejecutarse el callback de `transaction()`? Ancla de vitalidad. */
  transaccionCorrio: () => boolean;
  insertsDe: (tabla: unknown) => unknown[];
};

/**
 * `filasPorSelect` se consume en orden: cada `select()` toma la siguiente.
 * Faltando entradas devuelve `[]`, que es lo que hace una tabla vacía.
 */
function crearFake(filasPorSelect: unknown[][] = []): Fake {
  const sentencias: Sentencia[] = [];
  let iSelect = 0;
  let corrio = false;

  const thenable = (valor: unknown) => ({
    then: (resolver: (v: unknown) => void) => Promise.resolve(valor).then(resolver),
  });

  function conector(manejador: Manejador): Record<string, unknown> {
    const registrar = (s: Sentencia) => sentencias.push(s);

    return {
      select: () => {
        const filas = filasPorSelect[iSelect++] ?? [];
        let tabla: string | null = null;
        const cadena: Record<string, unknown> = {};
        for (const metodo of ["from", "innerJoin", "leftJoin", "orderBy", "limit"]) {
          cadena[metodo] = (arg: unknown) => {
            if (metodo === "from" && arg) tabla = nombreDeTabla(arg);
            return cadena;
          };
        }
        cadena.where = (where: unknown) => {
          registrar({ manejador, tipo: "select", tabla, where });
          return cadena;
        };
        (cadena as { then: unknown }).then = (resolver: (v: unknown) => void) =>
          Promise.resolve(filas).then(resolver);
        return cadena;
      },
      insert: (tabla: unknown) => ({
        values: (valores: unknown) => {
          registrar({ manejador, tipo: "insert", tabla: nombreDeTabla(tabla), valores });
          return thenable(undefined);
        },
      }),
      update: (tabla: unknown) => ({
        set: (valores: unknown) => ({
          where: (where: unknown) => {
            registrar({ manejador, tipo: "update", tabla: nombreDeTabla(tabla), valores, where });
            return thenable(undefined);
          },
        }),
      }),
      delete: (tabla: unknown) => ({
        where: (where: unknown) => {
          registrar({ manejador, tipo: "delete", tabla: nombreDeTabla(tabla), where });
          return thenable(undefined);
        },
      }),
      execute: (sql: unknown) => {
        registrar({ manejador, tipo: "execute", tabla: null, sql });
        return thenable(undefined);
      },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        corrio = true;
        return cb(conector("tx"));
      },
    };
  }

  return {
    db: conector("db"),
    sentencias,
    transaccionCorrio: () => corrio,
    insertsDe: (tabla: unknown) =>
      sentencias
        .filter((s) => s.tipo === "insert" && s.tabla === nombreDeTabla(tabla))
        .map((s) => s.valores),
  };
}

function nombreDeTabla(tabla: unknown): string | null {
  try {
    return getTableName(tabla as Parameters<typeof getTableName>[0]);
  } catch {
    return null;
  }
}

/* ══════════════════ El módulo bajo prueba ══════════════════ */

// `onUserCreated()` resuelve su conexión con `getDb()`, así que para correr el
// alta de verdad (AC-1) hay que sustituir ese módulo. `schema` se conserva
// original: es lo que las consultas usan para nombrar tablas y columnas.
const conexionSimulada = { actual: null as Fake | null };

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => conexionSimulada.actual?.db };
});

const { revisarDemo, NOMBRE_DE_AGENTE_POR_DEFECTO, CAMPOS_DE_PERFIL_VIGILADOS } =
  await import("@/server/seed/guardia");
const { onUserCreated } = await import("@/server/auth/on-signup");
const {
  cuerpoDeRechazo,
  textoDeConteos,
  fraseDeEstadoVacio,
  CAMPOS_QUE_EL_SEED_NO_ESCRIBE,
} = await import("@/server/seed/guardia");
const { seedDemo, DemoNoVirgenError } = await import("@/server/seed/demo");

/* ══════════════════ Ayudas ══════════════════ */

const ORG = "org_de_prueba";

/**
 * La fila tal como QUEDA en la base tras un `INSERT` que no la llena entera:
 * lo que trae el insert, y para lo demás el default de la columna (o NULL).
 *
 * Se construye desde el esquema a propósito. Si alguien cambia el default de
 * `agent_profile.name`, esta ayuda lo recoge y AC-1 lo nota.
 */
function filaComoQuedaria(tabla: unknown, valores: Record<string, unknown>) {
  const columnas = getTableColumns(tabla as Parameters<typeof getTableColumns>[0]);
  const fila: Record<string, unknown> = {};
  for (const [clave, columna] of Object.entries(columnas)) {
    const c = columna as { hasDefault?: boolean; default?: unknown };
    fila[clave] = clave in valores ? valores[clave] : c.hasDefault ? c.default : null;
  }
  return fila;
}

/** Los cuatro selects de la guardia, en su orden: contactos, KB, corridas, perfil. */
function filasDeGuardia(opciones: {
  contactos?: number;
  conocimiento?: number;
  corridas?: number;
  perfil?: Record<string, unknown> | null;
}): unknown[][] {
  return [
    [{ n: opciones.contactos ?? 0 }],
    [{ n: opciones.conocimiento ?? 0 }],
    [{ n: opciones.corridas ?? 0 }],
    opciones.perfil === null ? [] : [opciones.perfil ?? perfilVirgen()],
  ];
}

function perfilVirgen() {
  return filaComoQuedaria(schemaReal.agentProfile, {
    id: "ap_1",
    organizationId: ORG,
  });
}

beforeEach(() => {
  conexionSimulada.actual = null;
});

/* ══════════════════ AC-1 ══════════════════ */

describe("AC-1 — una organización creada por el alta real es virgen", () => {
  it("el perfil que escribe onUserCreated() la guardia lo considera sin tocar", async () => {
    // 1) Correr el ALTA DE VERDAD contra la BD simulada y capturar su INSERT.
    //    Sin organizaciones previas, para que el alta no se corte.
    const alta = crearFake([[{ n: 0 }]]);
    conexionSimulada.actual = alta;
    await onUserCreated("usr_1", "Ana");

    const insertsDePerfil = alta.insertsDe(schemaReal.agentProfile);
    expect(insertsDePerfil).toHaveLength(1);

    // 2) La fila que quedaría en la base con ese insert…
    const perfil = filaComoQuedaria(
      schemaReal.agentProfile,
      insertsDePerfil[0] as Record<string, unknown>
    );

    // 3) …se la damos a la guardia. El test NO escribe el perfil a mano: si lo
    //    hiciera, comprobaría que la guardia coincide con el test, que es lo
    //    único que no importa.
    const guardia = crearFake(filasDeGuardia({ perfil }));
    conexionSimulada.actual = guardia;
    const revision = await revisarDemo(guardia.db as never, ORG);

    expect(revision.virgen).toBe(true);
    expect(revision.encontrado).toEqual([]);
  });
});

/* ══════════════════ AC-4 ══════════════════ */

describe("AC-4 — perfil tocado ⇒ rechazo, un caso por campo", () => {
  // Seis casos independientes. Uno solo con los seis campos a la vez pasaría
  // aunque la guardia mirase nada más que uno.
  const casos: { campo: string; parche: Record<string, unknown> }[] = [
    { campo: "enabled", parche: { enabled: true } },
    { campo: "name", parche: { name: "Martillito" } },
    { campo: "tone", parche: { tone: "Cercano" } },
    { campo: "instructions", parche: { instructions: "Vende más" } },
    { campo: "escalationRules", parche: { escalationRules: "Escala si dudas" } },
    { campo: "greeting", parche: { greeting: "¡Hola!" } },
  ];

  for (const caso of casos) {
    it(`con SOLO ${caso.campo} tocado, no es virgen y lo nombra`, async () => {
      const perfil = { ...perfilVirgen(), ...caso.parche };
      const fake = crearFake(filasDeGuardia({ perfil }));
      const revision = await revisarDemo(fake.db as never, ORG);

      expect(revision.virgen).toBe(false);
      expect(revision.encontrado).toEqual([
        { que: "perfil", campos: [caso.campo] },
      ]);
    });
  }

  it("los seis campos vigilados son los que la guardia sabe nombrar", () => {
    expect([...CAMPOS_DE_PERFIL_VIGILADOS]).toEqual(casos.map((c) => c.campo));
  });

  it("el nombre por defecto es el de la columna, no uno inventado", () => {
    const columnas = getTableColumns(schemaReal.agentProfile);
    expect(columnas.name.default).toBe(NOMBRE_DE_AGENTE_POR_DEFECTO);
  });
});

/* ══════════════════ AC-2 y AC-3, mitad de decisión ══════════════════ */

describe("AC-2 y AC-3 — la guardia rechaza y dice cuánto hay", () => {
  it("con conocimiento y cero contactos: no es virgen", async () => {
    const fake = crearFake(filasDeGuardia({ conocimiento: 12 }));
    const revision = await revisarDemo(fake.db as never, ORG);

    expect(revision.virgen).toBe(false);
    expect(revision.encontrado).toEqual([{ que: "conocimiento", cuantos: 12 }]);
  });

  it("con corridas del Laboratorio y cero contactos: no es virgen", async () => {
    const fake = crearFake(filasDeGuardia({ corridas: 3 }));
    const revision = await revisarDemo(fake.db as never, ORG);

    expect(revision.virgen).toBe(false);
    expect(revision.encontrado).toEqual([{ que: "corridas", cuantos: 3 }]);
  });

  it("con contactos: no es virgen, aunque el seed sólo borre los de la demo", async () => {
    // No es superficie destruida: es la señal de que el negocio está vivo.
    const fake = crearFake(filasDeGuardia({ contactos: 40 }));
    const revision = await revisarDemo(fake.db as never, ORG);

    expect(revision.virgen).toBe(false);
    expect(revision.encontrado).toEqual([{ que: "contactos", cuantos: 40 }]);
  });

  it("con todo a la vez, los nombra todos y en orden", async () => {
    const fake = crearFake(
      filasDeGuardia({
        contactos: 2,
        conocimiento: 5,
        corridas: 1,
        perfil: { ...perfilVirgen(), enabled: true, name: "Martillito" },
      })
    );
    const revision = await revisarDemo(fake.db as never, ORG);

    expect(revision.encontrado).toEqual([
      { que: "contactos", cuantos: 2 },
      { que: "conocimiento", cuantos: 5 },
      { que: "corridas", cuantos: 1 },
      { que: "perfil", campos: ["enabled", "name"] },
    ]);
  });

  it("con todo limpio, es virgen: la guardia deja pasar el caso para el que existe", async () => {
    const fake = crearFake(filasDeGuardia({}));
    const revision = await revisarDemo(fake.db as never, ORG);

    expect(revision.virgen).toBe(true);
    expect(revision.encontrado).toEqual([]);
  });

  it("y toda consulta de la guardia sale acotada por organización", async () => {
    const fake = crearFake(filasDeGuardia({}));
    await revisarDemo(fake.db as never, ORG);

    expect(fake.sentencias).toHaveLength(4);
    for (const sentencia of fake.sentencias) {
      expect(sentencia.tipo).toBe("select");
      expect(String(sentencia.where)).toBeTruthy();
    }
  });
});

/* ══════════════════ AC-6 y AC-8 ══════════════════ */

describe("AC-6 y AC-8 — los invariantes del esquema en los que se apoya la guardia", () => {
  /*
   * La guardia NO cuenta conversaciones, mensajes, leads ni casos del
   * Laboratorio. No hace falta: el esquema garantiza que ninguno de ellos puede
   * existir sin la fila que sí se cuenta. El día que eso deje de ser cierto,
   * tiene que romperse aquí y no en producción.
   */
  // Por patrón y no por nombre: la migración inicial se llama como drizzle
  // decidió bautizarla, y renombrarla no debe romper este test.
  const inicial = readdirSync("drizzle").find((f) => /^0000_.*.sql$/.test(f));
  const sqlAplicado = readFileSync(`drizzle/${inicial}`, "utf8");

  it("AC-6 — no hay conversación, mensaje ni lead sin contacto", () => {
    expect(schemaReal.conversation.contactId.notNull).toBe(true);
    expect(schemaReal.message.conversationId.notNull).toBe(true);
    expect(schemaReal.lead.contactId.notNull).toBe(true);
  });

  it("AC-6 — y el SQL aplicado dice lo mismo, con cascada", () => {
    expect(sqlAplicado).toMatch(
      /"conversation" ADD CONSTRAINT[^;]*REFERENCES "public"\."contact"[^;]*ON DELETE cascade/
    );
    expect(sqlAplicado).toMatch(
      /"message" ADD CONSTRAINT[^;]*REFERENCES "public"\."conversation"[^;]*ON DELETE cascade/
    );
    expect(sqlAplicado).toMatch(
      /"lead" ADD CONSTRAINT[^;]*REFERENCES "public"\."contact"[^;]*ON DELETE cascade/
    );
  });

  it("AC-8 — un caso del Laboratorio no puede quedar huérfano de su corrida", () => {
    expect(schemaReal.agentTestCase.runId.notNull).toBe(true);
    expect(sqlAplicado).toMatch(
      /"agent_test_case" ADD CONSTRAINT[^;]*REFERENCES "public"\."agent_test_run"[^;]*ON DELETE cascade/
    );
  });

  it("y el contraste: conversationId del caso SÍ es opcional, a propósito", () => {
    // El esquema distingue lo que sostiene la fila de lo que sólo la enlaza.
    expect(schemaReal.agentTestCase.conversationId.notNull).toBe(false);
  });
});

/* ══════════════════ La Fase 2: seedDemo con guardia ══════════════════ */

const UNA_ETAPA = [{ id: "st_1", name: "Interesado", position: 0 }];

/**
 * Las filas que `seedDemo()` va pidiendo, en orden:
 * los cuatro selects de la guardia, el de contactos demo previos, y las etapas.
 */
function filasDeSeed(guardia: Parameters<typeof filasDeGuardia>[0]): unknown[][] {
  return [...filasDeGuardia(guardia), [], UNA_ETAPA];
}

const esDestructiva = (s: { tipo: string }) => s.tipo === "delete" || s.tipo === "update";

describe("AC-7 — lo destructivo, dentro de la transacción", () => {
  it("por el db exterior NO sale ninguna sentencia destructiva", async () => {
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    const fuera = fake.sentencias.filter((s) => s.manejador === "db" && esDestructiva(s));
    expect(fuera).toEqual([]);
  });

  it("ANCLA DE VITALIDAD (a): el callback de la transacción corrió", async () => {
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    expect(fake.transaccionCorrio()).toBe(true);
  });

  it("ANCLA DE VITALIDAD (b): por el tx SÍ salieron destructivas", async () => {
    // Sin esta mitad, un fake que no invoque el callback deja el criterio en
    // verde con la transacción sin ejercer: no hubo destructivas fuera porque
    // no hubo destructivas en ningún sitio.
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    const dentro = fake.sentencias.filter((s) => s.manejador === "tx" && esDestructiva(s));
    expect(dentro.length).toBeGreaterThan(0);

    // Y en concreto: los tres borrados de organización y el UPDATE del perfil.
    const tablas = dentro.map((s) => s.tabla);
    expect(tablas).toContain("kb_entry");
    expect(tablas).toContain("agent_test_run");
    expect(tablas).toContain("agent_test_case");
    expect(tablas).toContain("agent_profile");
  });

  it("el UPDATE del perfil es destructivo y va DENTRO, no al final del seed", async () => {
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    const perfil = fake.sentencias.find(
      (s) => s.tipo === "update" && s.tabla === "agent_profile"
    );
    expect(perfil?.manejador).toBe("tx");
  });
});

describe("AC-13 — el cerrojo es la PRIMERA sentencia de la transacción", () => {
  it("antes de la comprobación y de cualquier borrado", async () => {
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    const enTx = fake.sentencias.filter((s) => s.manejador === "tx");
    expect(enTx[0]?.tipo).toBe("execute");
    expect(String(enTx[0]?.sql)).toContain("");

    // Un cerrojo tomado después de comprobar no sirve para nada, y ese error no
    // se ve leyendo el código por encima.
    const primeraSelect = enTx.findIndex((s) => s.tipo === "select");
    const primeraDestructiva = enTx.findIndex(esDestructiva);
    expect(primeraSelect).toBeGreaterThan(0);
    expect(primeraDestructiva).toBeGreaterThan(primeraSelect);
  });
});

describe("AC-9 — lo que el seed sobrescribe del perfil está TODO vigilado", () => {
  it("vigilado ⊇ escrito, con enabled declarado como excepción", async () => {
    const fake = crearFake(filasDeSeed({}));
    await seedDemo(fake.db as never, ORG);

    const update = fake.sentencias.find(
      (s) => s.tipo === "update" && s.tabla === "agent_profile"
    );
    const escritos = Object.keys(update?.valores as Record<string, unknown>).filter(
      (c) => c !== "updatedAt" // metadato, no configuración del negocio
    );

    // Toda columna que el seed escriba tiene que estar vigilada.
    for (const campo of escritos) {
      expect(CAMPOS_DE_PERFIL_VIGILADOS).toContain(campo);
    }

    // Y lo vigilado que el seed NO escribe está declarado, no es un descuido.
    const vigiladosSinEscribir = CAMPOS_DE_PERFIL_VIGILADOS.filter(
      (c) => !escritos.includes(c)
    );
    expect(vigiladosSinEscribir).toEqual([...CAMPOS_QUE_EL_SEED_NO_ESCRIBE]);
  });
});

describe("AC-2, AC-3 y AC-5 — sobre seedDemo, no sólo sobre la guardia", () => {
  it("con conocimiento y cero contactos: se niega y NO emite ningún borrado", async () => {
    const fake = crearFake(filasDeSeed({ conocimiento: 12 }));

    await expect(seedDemo(fake.db as never, ORG)).rejects.toBeInstanceOf(
      DemoNoVirgenError
    );
    expect(fake.sentencias.filter(esDestructiva)).toEqual([]);
    expect(fake.sentencias.filter((s) => s.tipo === "insert")).toEqual([]);
  });

  it("con corridas del Laboratorio y cero contactos: ídem, y las corridas no se tocan", async () => {
    const fake = crearFake(filasDeSeed({ corridas: 3 }));

    await expect(seedDemo(fake.db as never, ORG)).rejects.toBeInstanceOf(
      DemoNoVirgenError
    );
    expect(fake.sentencias.filter(esDestructiva)).toEqual([]);
  });

  it("el error lleva el hallazgo dentro, para que quien lo atrape pueda explicarlo", async () => {
    const fake = crearFake(filasDeSeed({ conocimiento: 12, corridas: 3 }));

    await expect(seedDemo(fake.db as never, ORG)).rejects.toMatchObject({
      revision: {
        virgen: false,
        encontrado: [
          { que: "conocimiento", cuantos: 12 },
          { que: "corridas", cuantos: 3 },
        ],
      },
    });
  });

  it("AC-5 — virgen ⇒ carga: se emiten los INSERT y no hay rechazo", async () => {
    const fake = crearFake(filasDeSeed({}));
    const resultado = await seedDemo(fake.db as never, ORG);

    expect(resultado.contacts).toBeGreaterThan(0);
    expect(fake.insertsDe(schemaReal.contact).length).toBeGreaterThan(0);
    expect(fake.insertsDe(schemaReal.kbEntry).length).toBeGreaterThan(0);
  });

  it("y --force sí destruye, aunque no sea virgen", async () => {
    const fake = crearFake(filasDeSeed({ conocimiento: 12 }));
    await seedDemo(fake.db as never, ORG, { forzar: true });

    expect(fake.sentencias.filter(esDestructiva).length).toBeGreaterThan(0);
  });

  it("y el hallazgo se calcula igual con --force: de ahí salen los conteos del CLI", async () => {
    const fake = crearFake(filasDeSeed({ conocimiento: 12 }));
    const visto: unknown[] = [];
    await seedDemo(fake.db as never, ORG, {
      forzar: true,
      alDecidir: (revision) => visto.push(revision),
    });

    expect(visto).toEqual([
      { virgen: false, encontrado: [{ que: "conocimiento", cuantos: 12 }] },
    ]);
  });
});

describe("AC-10 y AC-11 — el rechazo se explica", () => {
  const revision = {
    virgen: false,
    encontrado: [
      { que: "conocimiento", cuantos: 12 },
      { que: "corridas", cuantos: 3 },
      { que: "perfil", campos: ["name", "tone"] },
    ],
  } as const;

  it("AC-10 — el cuerpo del rechazo trae el detalle, no sólo el mensaje", () => {
    const cuerpo = cuerpoDeRechazo(revision as never);

    expect(cuerpo.error.code).toBe("no_virgen");
    expect(cuerpo.error.message).toBeTruthy();
    expect(cuerpo.detalle).toEqual(revision.encontrado);
  });

  it("AC-11 — el texto del CLI nombra las tres cosas", () => {
    const texto = textoDeConteos(revision as never);

    expect(texto).toContain("12 entradas de conocimiento");
    expect(texto).toContain("3 corridas del Laboratorio");
    expect(texto).toContain("el perfil del agente");
    expect(texto).toContain("nombre");
    expect(texto).toContain("tono");
  });

  it("y el singular no dice '1 entradas'", () => {
    const texto = textoDeConteos({
      virgen: false,
      encontrado: [{ que: "conocimiento", cuantos: 1 }],
    } as never);

    expect(texto).toContain("1 entrada de conocimiento");
    expect(texto).not.toContain("1 entradas");
  });
});

/* ══════════════════ T020 — la frase del estado vacío ══════════════════ */

describe("FR-706 — la frase se lee como una frase, y el caso de UNO manda", () => {
  it("con UN solo elemento: el más probable en un despliegue nuevo", () => {
    // Un negocio que configuró su agente y aún no tiene ni conocimiento ni
    // evaluaciones. Es el caso que hay que diseñar primero, no el degenerado.
    const frase = fraseDeEstadoVacio({
      virgen: false,
      encontrado: [{ que: "perfil", campos: ["name"] }],
    } as never);

    expect(frase).toBe(
      "Ya tienes el agente configurado. Cargar la demo lo reemplazaría todo por el negocio de ejemplo."
    );
    // Nada de enumeración degenerada.
    expect(frase).not.toContain(":");
    expect(frase).not.toContain(",");
  });

  it("con DOS elementos: unidos con 'y', sin coma", () => {
    const frase = fraseDeEstadoVacio({
      virgen: false,
      encontrado: [
        { que: "conocimiento", cuantos: 12 },
        { que: "perfil", campos: ["name"] },
      ],
    } as never);

    expect(frase).toContain("12 entradas de conocimiento y el agente configurado");
    expect(frase).not.toContain(",");
  });

  it("con CUATRO elementos: comas y una 'y' al final", () => {
    const frase = fraseDeEstadoVacio({
      virgen: false,
      encontrado: [
        { que: "contactos", cuantos: 40 },
        { que: "conocimiento", cuantos: 12 },
        { que: "corridas", cuantos: 3 },
        { que: "perfil", campos: ["name", "tone"] },
      ],
    } as never);

    expect(frase).toContain(
      "40 contactos, 12 entradas de conocimiento, 3 evaluaciones del Laboratorio y el agente configurado"
    );
  });

  it("el singular no dice '1 evaluaciones'", () => {
    const frase = fraseDeEstadoVacio({
      virgen: false,
      encontrado: [{ que: "corridas", cuantos: 1 }],
    } as never);

    expect(frase).toContain("1 evaluación del Laboratorio");
  });

  it("y con la organización virgen no hay frase que enseñar", () => {
    expect(fraseDeEstadoVacio({ virgen: true, encontrado: [] })).toBe("");
  });
});
