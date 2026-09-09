import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  NOMBRE_DE_AGENTE_POR_DEFECTO,
  type CampoDePerfil,
  type Hallazgo,
  type RevisionDemo,
} from "@/lib/demo-hallazgo";

/*
 * Los tipos, las constantes y los textos viven en `@/lib/demo-hallazgo`, no
 * aquí: la pantalla del estado vacío es un componente de cliente y necesita la
 * frase, y con todo junto el build arrastraba el driver de Postgres al
 * navegador. Se re-exportan para que quien ya llama a la guardia no tenga que
 * saber que hubo una mudanza.
 */
export * from "@/lib/demo-hallazgo";

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
 * `db` o el `tx` de una transacción.
 *
 * **La firma admite las dos y no dice cuál toca, así que la regla va aquí:**
 *
 * - **Camino destructivo → SIEMPRE el `tx`.** La comprobación que autoriza un
 *   borrado tiene que ver la misma foto que el borrado. Comprobar por el `db`
 *   exterior y borrar dentro de la transacción son dos viajes: una entrada de
 *   conocimiento creada entre medias la destruiría una comprobación que nunca
 *   la vio (FR-704). AC-14 afirma justo esto mirando el primer argumento.
 * - **Camino de lectura → el `db` exterior vale.** El render sólo decide qué
 *   enseñar en pantalla; si su foto envejece unos milisegundos, lo peor que
 *   pasa es que alguien vea un botón que al pulsarlo devuelve un 409 — que es
 *   exactamente lo que debe pasar, y sin haber destruido nada.
 *
 * En una frase: **si de lo que lees va a depender un borrado, léelo por el
 * `tx`.**
 */
export type Conexion = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Qué se perdería si la demo se cargara ahora sobre esta organización.
 *
 * **Es la única función que decide** (FR-703): la usan el render —para saber si
 * enseñar el botón o la explicación— y la ejecución, dentro de su transacción.
 * Dos criterios que se parecen acaban divergiendo, y el que diverge en silencio
 * es el de la ejecución.
 *
 * Qué conexión pasarle no es indiferente: ver la regla en `Conexion`.
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
