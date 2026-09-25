import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { createHash } from "node:crypto";

/**
 * 021 Entrega 3 (FR-625, FR-626) — El SELLO del conjunto de escenarios.
 *
 * Existe para que un salto de score no se lea como mejora del agente cuando
 * fue un cambio de examen. Comparar 42 con 75 solo significa algo si el examen
 * fue el mismo — y en la Entrega 2 se vio en vivo que no siempre lo es: LanCo
 * pasó de 42 a 75 sin que su agente cambiara, y la pantalla lo presentó como
 * mejora del agente.
 */

type ParaSellar = { key: string; script: string[] };

/**
 * Sello del conjunto contra el que se evaluó una corrida.
 *
 * Hashea el CONTENIDO, no solo las claves. Un hash de claves diría que dos
 * corridas midieron lo mismo cuando el dueño reescribió el texto de un guion
 * entre ellas — que es justo el caso que esto existe para detectar. Editar
 * cambia el examen igual que añadir.
 *
 * Ordenado por clave: el orden de lectura no debe alterar el sello, solo su
 * contenido.
 */
export function selloDeConjunto(escenarios: ParaSellar[]): string {
  /*
   * Se serializa con JSON en vez de concatenar con separadores propios.
   * Concatenar deja el hash AMBIGUO: sin una frontera inequívoca entre clave y
   * guion, una clave "ab" con guion ["c"] y una clave "a" con guion ["bc"]
   * producen el mismo material y por tanto el mismo sello — dos exámenes
   * distintos que el histórico daría por iguales, que es justo lo que este
   * sello existe para evitar. JSON delimita y escapa cada campo, así que la
   * frontera no depende de que ningún carácter falte en el guion.
   */
  const material = JSON.stringify(
    [...escenarios]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((e) => [e.key, e.script])
  );
  return `sha256:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

/**
 * Versión de la RÚBRICA con la que juzga el juez (FR-616).
 *
 * El sello no cubre esto: cambiar la rúbrica no toca el conjunto de escenarios
 * y sin embargo hace incomparables dos scores. Está medido — la Entrega 2 subió
 * a LanCo de 42 a 75 sin que su agente cambiara.
 *
 * SE SUBE A MANO cuando cambia `buildJudgePrompt`. Derivarla hasheando el
 * prompt sería más automático y peor: cualquier retoque de redacción movería
 * la versión y el histórico se llenaría de avisos de "examen distinto" que no
 * significan nada. Quien cambia la rúbrica sabe si cambió el criterio.
 *
 * - `r1` — la original de la 001.
 * - `r2` — 021 Entrega 2: el juez recibe el escalado como hecho y el resultado
 *   esperado del escenario; declinar bien y escalar dejan de ser hallazgos.
 */
export const VERSION_RUBRICA = "r2";

/**
 * 021 (ajuste 2026-09-23) — La rúbrica incluye QUIÉN la aplica.
 *
 * El criterio escrito es la mitad; la otra es el modelo que lo interpreta. Dos
 * corridas con la misma rúbrica y jueces distintos NO son comparables, y hasta
 * hoy el histórico las comparaba igual: el sello solo cubría los escenarios y
 * la versión del criterio. Cambiar `OPENROUTER_JUDGE_MODEL` producía un delta
 * que no significaba nada, sin un solo aviso — exactamente el fallo que la
 * Entrega 2 documentó (de 42 a 75 sin que el agente cambiara).
 *
 * Se guarda dentro de `rubric_version` en vez de una columna nueva a
 * propósito: una migración obliga al ensayo con respaldo real del Principio X,
 * y aquí no hace falta — el dato es del mismo tipo y la columna ya existe. Las
 * corridas viejas conservan su `r2` y siguen siendo legibles.
 */
export function selloDeRubrica(judgeModel: string | null | undefined): string {
  const juez = (judgeModel ?? "").trim();
  return juez.length > 0 ? `${VERSION_RUBRICA}|juez=${juez}` : VERSION_RUBRICA;
}

/** Lo contrario: separa criterio y juez. Un valor viejo (`r2`) no tiene juez. */
export function parseRubrica(sello: string): {
  version: string;
  juez: string | null;
} {
  const i = sello.indexOf("|juez=");
  if (i < 0) return { version: sello, juez: null };
  const juez = sello.slice(i + "|juez=".length).trim();
  return { version: sello.slice(0, i), juez: juez.length > 0 ? juez : null };
}

/**
 * ¿Se pueden comparar estas dos corridas?
 *
 * `null` en cualquiera de los dos campos significa "de esa corrida no se sabe"
 * —es anterior a que esto se registrara— y eso NO es lo mismo que "son
 * iguales". Se responde que no son comparables, que es la verdad.
 */
export function sonComparables(
  a: { scenarioSet: string | null; rubricVersion: string | null },
  b: { scenarioSet: string | null; rubricVersion: string | null }
): {
  comparables: boolean;
  motivo: "examen" | "rubrica" | "juez" | "sin_registro" | null;
} {
  if (
    a.scenarioSet === null ||
    b.scenarioSet === null ||
    a.rubricVersion === null ||
    b.rubricVersion === null
  ) {
    return { comparables: false, motivo: "sin_registro" };
  }
  if (a.scenarioSet !== b.scenarioSet) {
    return { comparables: false, motivo: "examen" };
  }
  const ra = parseRubrica(a.rubricVersion);
  const rb = parseRubrica(b.rubricVersion);
  if (ra.version !== rb.version) {
    return { comparables: false, motivo: "rubrica" };
  }
  /*
   * El juez. Tres casos, y el del medio es el que importa:
   *
   * - Las DOS lo tienen: se comparan. Distinto juez ⇒ no comparables, y se
   *   dice cuál fue el motivo.
   * - Solo UNA lo tiene: es la frontera entre "antes no se registraba" y
   *   "ahora sí", y lo más habitual es que ese registro aparezca justo cuando
   *   alguien tocó la configuración. Ahí no consta, y no consta NO es "el
   *   mismo juez".
   * - NINGUNA lo tiene: las dos son anteriores a que esto se registrara. No se
   *   inventa información nueva sobre lo viejo: se mantiene lo que el dueño ha
   *   estado viendo hasta hoy, en vez de invalidarle el histórico entero de
   *   golpe.
   */
  if (ra.juez !== null && rb.juez !== null) {
    return ra.juez === rb.juez
      ? { comparables: true, motivo: null }
      : { comparables: false, motivo: "juez" };
  }
  if (ra.juez === null && rb.juez === null) {
    return { comparables: true, motivo: null };
  }
  return { comparables: false, motivo: "sin_registro" };
}

/**
 * 021 Entrega 3 (FR-631) — cuánto va a costar la próxima corrida.
 *
 * Existe porque una corrida pasa de seis escenarios a catorce sin que nadie
 * avise, y descubrirlo esperando es una mala experiencia — con un proveedor de
 * pago detrás, también un coste no anunciado.
 *
 * Ser aproximada es aceptable; ser silenciosa no.
 */
export type Estimacion = {
  escenarios: number;
  segundos: number;
  /** true si no hay histórico propio del que sacar la media. */
  aproximada: boolean;
};

/**
 * Duración media de un TURNO del agente, en milisegundos, cuando todavía no
 * hay corridas terminadas de las que aprender.
 *
 * Observada y no constante en cuanto hay histórico, porque el turno depende del
 * proveedor LLM configurado y su latencia varía en un orden de magnitud entre
 * proveedores: una constante estaría mal para casi todos.
 */
const MS_POR_TURNO_SIN_HISTORICO = 6000;

export async function estimarCorrida(
  organizationId: string,
  escenarios: { script: string[] }[]
): Promise<Estimacion> {
  const turnos = escenarios.reduce((n, e) => n + e.script.length, 0);
  const db = getDb();

  const previas = await db
    .select({
      id: schema.agentTestRun.id,
      startedAt: schema.agentTestRun.startedAt,
      finishedAt: schema.agentTestRun.finishedAt,
    })
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        organizationId,
        eq(schema.agentTestRun.status, "done")
      )
    )
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(5);

  /*
   * La media se saca POR CASO, no por corrida. Por corrida, la estimación no
   * cambiaría aunque el conjunto pase de seis escenarios a catorce — que es
   * justo lo que hay que anunciar. Cuántos casos tuvo cada corrida sí está
   * guardado, así que la escala se puede calcular de verdad.
   */
  const porCaso: number[] = [];
  for (const p of previas) {
    if (!p.finishedAt) continue;
    const ms = p.finishedAt.getTime() - p.startedAt.getTime();
    if (ms <= 0) continue;
    const casos = await db
      .select({ id: schema.agentTestCase.id })
      .from(schema.agentTestCase)
      .where(eq(schema.agentTestCase.runId, p.id));
    if (casos.length === 0) continue;
    porCaso.push(ms / casos.length);
  }

  if (porCaso.length === 0) {
    // Sin histórico utilizable: constante conservadora, y se DICE que lo es.
    return {
      escenarios: escenarios.length,
      segundos: Math.round((turnos * MS_POR_TURNO_SIN_HISTORICO) / 1000),
      aproximada: true,
    };
  }

  const mediaPorCaso = porCaso.reduce((a, b) => a + b, 0) / porCaso.length;
  return {
    escenarios: escenarios.length,
    segundos: Math.round((mediaPorCaso * escenarios.length) / 1000),
    aproximada: false,
  };
}
