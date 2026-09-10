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
 * ¿Se pueden comparar estas dos corridas?
 *
 * `null` en cualquiera de los dos campos significa "de esa corrida no se sabe"
 * —es anterior a que esto se registrara— y eso NO es lo mismo que "son
 * iguales". Se responde que no son comparables, que es la verdad.
 */
export function sonComparables(
  a: { scenarioSet: string | null; rubricVersion: string | null },
  b: { scenarioSet: string | null; rubricVersion: string | null }
): { comparables: boolean; motivo: "examen" | "rubrica" | "sin_registro" | null } {
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
  if (a.rubricVersion !== b.rubricVersion) {
    return { comparables: false, motivo: "rubrica" };
  }
  return { comparables: true, motivo: null };
}
