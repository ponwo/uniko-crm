import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import {
  buildScenarioPrompt,
  MAX_ESCENARIOS_GENERADOS,
  renderKb,
} from "@/server/ai/prompts";
import { validarGuion, type Propuesta } from "@/server/lab/guion";

/**
 * 021 Entrega 3 — Generación de escenarios desde el conocimiento del negocio
 * (FR-620..FR-622, FR-629, FR-630).
 *
 * Produce PROPUESTAS. **No guarda nada**: el dueño las revisa, corrige y
 * confirma. Que no exista estado intermedio persistido es lo que hace cierta
 * esa promesa — no hay nada que alguien pueda confundir con escenarios
 * guardados, ni que quede a medias si cierra la pestaña.
 */

/** Tope de caracteres del conocimiento que se manda al modelo. */
const TOPE_CONOCIMIENTO = 12000;

/**
 * Esquema PERMISIVO a propósito.
 *
 * `chatJson` valida la respuesta ENTERA contra el esquema y reintenta si no
 * cuadra. Con un esquema estricto en los elementos, un solo escenario
 * malformado tiraría los seis y el dueño vería "no se pudo generar" con cinco
 * perfectos. Aquí solo se exige que haya una lista de objetos; la validación
 * de verdad se aplica elemento a elemento después.
 */
const RespuestaLaxa = z.object({
  escenarios: z.array(z.record(z.unknown())).min(1),
});

export type ResultadoGeneracion =
  | {
      ok: true;
      propuestas: Propuesta[];
      /** Cuántos elementos vinieron malformados y se descartaron. */
      descartados: number;
      /** true si hubo que recortar el conocimiento para que cupiera. */
      conocimientoRecortado: boolean;
    }
  | {
      ok: false;
      motivo: "sin_proveedor" | "kb_vacia" | "generacion_fallida";
      detalle: string;
    };

export async function generarEscenarios(
  organizationId: string,
  cuantos = MAX_ESCENARIOS_GENERADOS
): Promise<ResultadoGeneracion> {
  if (!isAiConfigured()) {
    /*
     * FR-629 — El Laboratorio sigue usable con los seis genéricos. Se distingue
     * de un fallo del proveedor a propósito: uno se arregla configurando, el
     * otro reintentando, y decirle "vuelve a intentarlo" a quien no tiene token
     * lo manda a un bucle.
     */
    return {
      ok: false,
      motivo: "sin_proveedor",
      detalle:
        "No hay proveedor de IA configurado en esta instancia, así que no se pueden generar escenarios. El Laboratorio sigue funcionando con los seis que trae el producto.",
    };
  }

  const db = getDb();
  const entradas = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId));

  if (entradas.length === 0) {
    // FR-630 — el Laboratorio sigue corriendo; lo que se apaga es generar.
    return {
      ok: false,
      motivo: "kb_vacia",
      detalle:
        "Todavía no hay conocimiento del que generar escenarios. Carga tu base de conocimiento y vuelve a intentarlo.",
    };
  }

  const { texto: kbText, recortado } = recortarConocimiento(entradas);

  const perfiles = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const p = perfiles[0];
  const behaviorText = p
    ? [
        `Nombre: ${p.name}`,
        p.tone ? `Tono: ${p.tone}` : null,
        p.instructions ? `Instrucciones: ${p.instructions}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const { system, user } = buildScenarioPrompt({ kbText, behaviorText, cuantos });

  /*
   * El modelo del AGENTE, no el del juez — y es deliberado.
   *
   * `chatJson` acepta `judge: true` para caer a `OPENROUTER_JUDGE_MODEL`. Aquí
   * NO se pasa: con el modelo del juez, el juez acabaría calificando preguntas
   * que él mismo escribió. Eso no solo comparte puntos ciegos con el evaluador
   * — se los deja ELEGIR, y además es la única correlación que ningún prompt
   * puede atacar, porque el juez nunca lee estas instrucciones.
   *
   * Con el modelo del agente la correlación es generador↔evaluado, que sí se
   * ataca: el prompt le pide explícitamente los huecos de su propio
   * conocimiento. Ninguna de las dos opciones es limpia; se elige la atacable.
   */
  const r = await chatJson(RespuestaLaxa, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  if (!r.ok) {
    return {
      ok: false,
      motivo: "generacion_fallida",
      detalle:
        "El proveedor de IA respondió, pero no se pudo aprovechar nada de lo que devolvió. Vuelve a intentarlo en un momento.",
    };
  }

  // Validación POR ESCENARIO: los buenos se ofrecen aunque otros vengan rotos,
  // y se dice cuántos se cayeron.
  const propuestas: Propuesta[] = [];
  let descartados = 0;
  for (const crudo of r.data.escenarios) {
    const propuesta = normalizar(crudo);
    if (!propuesta || validarGuion(propuesta)) {
      descartados += 1;
      continue;
    }
    propuestas.push(propuesta);
    if (propuestas.length >= cuantos) break;
  }

  if (propuestas.length === 0) {
    return {
      ok: false,
      motivo: "generacion_fallida",
      detalle: `El proveedor devolvió ${descartados} escenario(s), ninguno utilizable. Vuelve a intentarlo.`,
    };
  }

  return {
    ok: true,
    propuestas,
    descartados,
    conocimientoRecortado: recortado,
  };
}

/** Un elemento crudo del modelo → propuesta, o null si no tiene ni la forma. */
function normalizar(crudo: Record<string, unknown>): Propuesta | null {
  const label = typeof crudo.label === "string" ? crudo.label.trim() : "";
  const description =
    typeof crudo.description === "string" ? crudo.description.trim() : "";
  if (!Array.isArray(crudo.script)) return null;
  const script = crudo.script
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim());
  return { label, description, script };
}

/**
 * Recorte DECLARADO del conocimiento (FR-620).
 *
 * Un recorte silencioso produce escenarios que ignoran media base de
 * conocimiento sin que nadie entienda por qué. Se devuelve si hubo recorte
 * para que la pantalla pueda decirlo: es la misma disciplina que el resto del
 * producto aplica a lo que no se puede leer entero — no saber no se presenta
 * como saber.
 */
function recortarConocimiento(
  entradas: (typeof schema.kbEntry.$inferSelect)[]
): { texto: string; recortado: boolean } {
  const completo = renderKb(entradas);
  if (completo.length <= TOPE_CONOCIMIENTO) {
    return { texto: completo, recortado: false };
  }
  const cabidas: typeof entradas = [];
  let largo = 0;
  for (const e of entradas) {
    const trozo = renderKb([e]);
    if (largo + trozo.length > TOPE_CONOCIMIENTO) break;
    cabidas.push(e);
    largo += trozo.length;
  }
  return { texto: renderKb(cabidas), recortado: true };
}
