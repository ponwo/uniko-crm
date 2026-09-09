/**
 * 022 — El hallazgo de la guardia del seed demo: tipos y textos.
 *
 * Vive en `lib/` y no en `server/` por capas: aquí están los tipos y los
 * textos, que no consultan nada; lo que va a la base se queda en
 * [`@/server/seed/guardia`](../server/seed/guardia.ts).
 *
 * **La razón original era otra, y conviene no dejarla escrita como si siguiera
 * en pie**: este módulo nació porque la pantalla de la bandeja —componente de
 * cliente— necesitaba la frase del estado vacío, y tenerla junto a
 * `revisarDemo()` arrastraba `@/lib/db` al bundle del navegador; el build se
 * caía pidiendo `perf_hooks` y `fs`. Esa pantalla se retiró en la 022 al
 * eliminar el botón de la demo, así que **hoy nada de cliente importa de aquí**.
 * La separación se conserva porque sigue siendo buena capa, no porque haga
 * falta para compilar.
 */

/** Nombre con el que el alta crea el perfil (`agent_profile.name` por defecto). */
export const NOMBRE_DE_AGENTE_POR_DEFECTO = "Asistente";

/**
 * Los campos del perfil que la guardia vigila.
 *
 * Cinco son los que el `UPDATE` del seed sobrescribe. El sexto, `enabled`, se
 * vigila aunque el seed no lo escriba: un agente encendido es un negocio en
 * marcha. AC-9 compara las dos listas y exige **vigilado ⊇ escrito**.
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
