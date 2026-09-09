import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 022 — La guardia del seed demo.
 *
 * `seedDemo()` destruye cuatro cosas: el conocimiento entero de la
 * organización, su historial del Laboratorio, la personalidad configurada de su
 * agente, y los contactos de los teléfonos demo. La guardia que lo protegía
 * miraba **una sola tabla** —`contact`— y encima la única que está
 * garantizadamente vacía en el negocio al que debía proteger: un contacto sólo
 * existe cuando alguien te escribe.
 *
 * De ahí el criterio de esta feature: **la guardia cubre la misma superficie
 * que la operación destruye**. Ni menos, que fue el fallo, ni más — aquí no se
 * miran plantillas, ni credenciales, ni etapas del pipeline, porque el seed no
 * las toca.
 *
 * Dos comprobaciones **no** son superficie destruida y están a propósito:
 *
 * - **Los contactos**: el seed sólo borra los de los teléfonos demo, no todos.
 *   Exigir cero es la señal de que **el negocio está vivo**. Uno con clientes
 *   reales no quiere la bandeja llena de conversaciones falsas de una
 *   ferretería aunque sus contactos estén a salvo.
 * - **`agent_profile.enabled`**: el seed no lo escribe (ver
 *   `CAMPOS_QUE_EL_SEED_NO_ESCRIBE`). Se vigila por lo mismo: un agente
 *   encendido es un negocio en marcha.
 *
 * Devuelve **el hallazgo, no un booleano** (FR-702): un booleano no permite
 * explicar nada, y explicar es la mitad del arreglo.
 */

type Db = ReturnType<typeof getDb>;

/**
 * `db` o el `tx` de una transacción. La guardia se llama desde los dos sitios:
 * la lectura del render usa la conexión normal, y la ejecución la llama
 * **dentro** de la transacción que borra (FR-704).
 */
export type Conexion = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Nombre con el que el alta crea el perfil (`agent_profile.name` por defecto). */
export const NOMBRE_DE_AGENTE_POR_DEFECTO = "Asistente";

/**
 * Los campos del perfil que la guardia vigila.
 *
 * Cinco de ellos son los que el `UPDATE` del seed sobrescribe. El sexto,
 * `enabled`, se vigila aunque el seed no lo escriba — ver arriba. AC-9 compara
 * las dos listas y exige **vigilado ⊇ escrito**.
 */
export const CAMPOS_DE_PERFIL_VIGILADOS = [
  "enabled",
  "name",
  "tone",
  "instructions",
  "escalationRules",
  "greeting",
] as const;

/** Vigilados a propósito aunque el seed no los toque. Es la excepción de AC-9. */
export const CAMPOS_QUE_EL_SEED_NO_ESCRIBE = ["enabled"] as const;

export type CampoDePerfil = (typeof CAMPOS_DE_PERFIL_VIGILADOS)[number];

/** Qué se encontró configurado, y cuánto. Lo que el 409 y la pantalla explican. */
export type Hallazgo =
  | { que: "contactos"; cuantos: number }
  | { que: "conocimiento"; cuantos: number }
  | { que: "corridas"; cuantos: number }
  | { que: "perfil"; campos: CampoDePerfil[] };

export type RevisionDemo = {
  /** Sin nada de lo que la demo destruye, y con el agente sin tocar. */
  virgen: boolean;
  /** Vacío si es virgen. Nunca se rellena "por si acaso". */
  encontrado: Hallazgo[];
};

/**
 * Qué se perdería si la demo se cargara ahora sobre esta organización.
 *
 * **Es la única función que decide** (FR-703): la usan el render —para saber si
 * enseñar el botón o la explicación— y la ejecución, dentro de su transacción.
 * Dos criterios que se parecen acaban divergiendo, y el que diverge en silencio
 * es el de la ejecución.
 */
export async function revisarDemo(
  db: Conexion,
  organizationId: string
): Promise<RevisionDemo> {
  const encontrado: Hallazgo[] = [];

  const [contactos] = await db
    .select({ n: count() })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId));
  if ((contactos?.n ?? 0) > 0) {
    encontrado.push({ que: "contactos", cuantos: contactos?.n ?? 0 });
  }

  const [conocimiento] = await db
    .select({ n: count() })
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId));
  if ((conocimiento?.n ?? 0) > 0) {
    encontrado.push({ que: "conocimiento", cuantos: conocimiento?.n ?? 0 });
  }

  // Cualquier estado cuenta: una corrida fallida también es historial, y hoy
  // no se puede borrar por ningún otro camino.
  const [corridas] = await db
    .select({ n: count() })
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, organizationId));
  if ((corridas?.n ?? 0) > 0) {
    encontrado.push({ que: "corridas", cuantos: corridas?.n ?? 0 });
  }

  const [perfil] = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const campos = perfil ? camposTocados(perfil) : [];
  if (campos.length > 0) encontrado.push({ que: "perfil", campos });

  return { virgen: encontrado.length === 0, encontrado };
}

/**
 * Qué campos del perfil dejaron de estar como el alta los deja.
 *
 * `onUserCreated()` inserta el perfil con `id` y `organization_id` y nada más,
 * así que "sin tocar" es: apagado, con el nombre por defecto de la columna y
 * los cuatro textos en NULL. Comparar contra eso —y no contra una lista escrita
 * a mano— es lo que ata esta definición al camino real de alta (AC-1).
 */
function camposTocados(
  perfil: typeof schema.agentProfile.$inferSelect
): CampoDePerfil[] {
  const tocados: CampoDePerfil[] = [];
  if (perfil.enabled) tocados.push("enabled");
  if (perfil.name !== NOMBRE_DE_AGENTE_POR_DEFECTO) tocados.push("name");
  if (perfil.tone !== null) tocados.push("tone");
  if (perfil.instructions !== null) tocados.push("instructions");
  if (perfil.escalationRules !== null) tocados.push("escalationRules");
  if (perfil.greeting !== null) tocados.push("greeting");
  return tocados;
}


/* ══════════════ Cómo se cuenta el hallazgo ══════════════ */

/**
 * Une en una lista que se lee como una frase: `A` · `A y B` · `A, B y C`.
 *
 * El caso de UN elemento es el que manda, no el degenerado: en un despliegue
 * nuevo lo más probable es que sólo esté tocado el perfil, y "ya tienes: el
 * agente" no es español.
 */
export function unirEnLista(partes: string[]): string {
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0]!;
  return `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

const NOMBRES_DE_CAMPO: Record<CampoDePerfil, string> = {
  enabled: "encendido",
  name: "nombre",
  tone: "tono",
  instructions: "instrucciones",
  escalationRules: "reglas de escalado",
  greeting: "saludo",
};

/** Un hallazgo, dicho en español y con su plural. */
function enPalabras(hallazgo: Hallazgo): string {
  switch (hallazgo.que) {
    case "contactos":
      return hallazgo.cuantos === 1 ? "1 contacto" : `${hallazgo.cuantos} contactos`;
    case "conocimiento":
      return hallazgo.cuantos === 1
        ? "1 entrada de conocimiento"
        : `${hallazgo.cuantos} entradas de conocimiento`;
    case "corridas":
      return hallazgo.cuantos === 1
        ? "1 corrida del Laboratorio"
        : `${hallazgo.cuantos} corridas del Laboratorio`;
    case "perfil":
      return `el perfil del agente (${unirEnLista(
        hallazgo.campos.map((c) => NOMBRES_DE_CAMPO[c])
      )})`;
  }
}

/**
 * Lo que el CLI imprime ANTES de destruir (FR-708).
 *
 * Sale del hallazgo, no de un recuento propio: dos formas de contar lo mismo
 * acaban discrepando, y la que se lee en un log es la que nadie comprueba.
 */
export function textoDeConteos(revision: RevisionDemo): string {
  if (revision.virgen) return "La organización está vacía: no hay nada que reemplazar.";
  return `Se va a reemplazar: ${unirEnLista(revision.encontrado.map(enPalabras))}.`;
}

/**
 * El cuerpo del 409 (FR-705).
 *
 * Mantiene la forma de `apiError` —`{ error: { code, message } }`— y añade el
 * **detalle estructurado**, que es lo que permite a la pantalla explicar en vez
 * de esconder. Sin ese detalle, el 409 sólo dice "no", y "no" sin porqué es lo
 * que esta feature vino a arreglar.
 */
export function cuerpoDeRechazo(revision: RevisionDemo) {
  return {
    error: {
      code: "no_virgen",
      message: textoDeConteos(revision),
    },
    detalle: revision.encontrado,
  };
}
