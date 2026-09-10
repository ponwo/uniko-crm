/**
 * 021 — Qué enseñar junto a una corrida del histórico.
 *
 * Vive en `lib/` y sin una sola importación de servidor porque lo consume un
 * componente de CLIENTE. Su hermano `server/lab/conjunto.ts` calcula el sello
 * y la estimación, y para eso toca la base: importarlo desde el navegador
 * arrastraría Drizzle al bundle.
 *
 * Y vive como función PURA por cómo apareció el fallo que arregla: la decisión
 * estaba escrita como una condición de render —`delta !== 0 && …`— y por tanto
 * era invisible para cualquier prueba. Se vio en una captura de la instancia
 * real, no en la suite.
 *
 * El fallo: dos corridas con el MISMO score y exámenes distintos no enseñaban
 * nada. Y ese caso es peor que el que sí estaba cubierto — un `−42` tachado ya
 * invita a desconfiar, pero dos scores iguales sin nada al lado se leen como
 * "no cambió nada", cuando la verdad es que no se sabe si son comparables.
 *
 * Regla: el NÚMERO depende de que haya diferencia; el AVISO depende solo de la
 * comparabilidad. Son dos preguntas distintas y se responden por separado.
 */
export type AvisoDeComparacion = {
  /** El delta, si hay uno distinto de cero que valga la pena enseñar. */
  numero: number | null;
  /** Por qué no son comparables, o null si lo son (o no hay con qué comparar). */
  motivo: "examen" | "rubrica" | "sin_registro" | null;
};

export function avisoDeComparacion(run: {
  delta: number | null;
  comparable: boolean | null;
  motivoNoComparable: "examen" | "rubrica" | "sin_registro" | null;
}): AvisoDeComparacion {
  return {
    numero: run.delta !== null && run.delta !== 0 ? run.delta : null,
    motivo: run.comparable === false ? run.motivoNoComparable : null,
  };
}

/** ¿Hay algo que pintar junto a esta corrida? */
export function hayAlgoQueAvisar(aviso: AvisoDeComparacion): boolean {
  return aviso.numero !== null || aviso.motivo !== null;
}
