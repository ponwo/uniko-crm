import { normalizeMx } from "@/lib/meta/client";

/**
 * 021 Entrega 3 — Las reglas de un escenario propio, SIN tocar la base.
 *
 * Vive aparte de `escenarios.ts` a propósito: todo lo de aquí es función pura,
 * así que se prueba sin base de datos y sin mocks. Lo que necesita consultar
 * —si un teléfono ya es de un contacto real— vive allá.
 */

/** Cuántos escenarios propios puede tener una organización (FR-624). */
export const MAX_ESCENARIOS_PROPIOS = 8;

/**
 * Bloque de los SEIS genéricos del producto: `5210000000001`..`5210000000006`.
 * Se declaran las DOS formas explícitamente en vez de calcular una de la otra:
 * el cálculo era correcto pero ilegible, y de esta constante depende que las
 * dos familias no se pisen.
 */
const PREFIJO_GENERICOS = "521000000000";
/** Los mismos, tal como quedan tras `normalizeMx` (521 → 52). */
const PREFIJO_GENERICOS_NORMALIZADO = "52000000000";

/**
 * Rango RESERVADO de los escenarios propios. Distinto del de los seis a
 * propósito: si compartieran bloque, un escenario propio podría pisar el
 * contacto de prueba de uno del producto y las dos familias se mezclarían en
 * la misma conversación simulada.
 *
 * `5219` deja diez millones de combinaciones —de sobra para ocho escenarios
 * por organización— y no colisiona con el `5210…` de arriba por construcción.
 */
const PREFIJO_PROPIOS = "5219";

/**
 * Teléfono sintético derivado de la clave del escenario.
 *
 * DETERMINISTA a propósito: con números aleatorios la colisión no desaparece,
 * solo se vuelve rara e irreproducible — el peor tipo de fallo, porque ocurre
 * una vez de cada mil y nadie consigue reproducirlo. Derivado de la clave, el
 * mismo escenario produce siempre el mismo número y una colisión es un hecho
 * estable que se puede ver y arreglar.
 */
export function telefonoDeEscenario(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // 9 dígitos tras el prefijo `5219` → 13 en total, como los de Meta (521 + 10).
  const cuerpo = String(h % 1_000_000_000).padStart(9, "0");
  return `${PREFIJO_PROPIOS}${cuerpo}`;
}

export type RechazoDeTelefono =
  | "rango_de_genericos"
  | "fuera_del_rango_reservado";

/**
 * Las DOS formas en que un mismo teléfono puede estar escrito en la base.
 *
 * `normalizeMx` convierte `521XXXXXXXXXX` en `52XXXXXXXXXX`. El contacto de
 * prueba se guarda SIN normalizar y los contactos reales entran YA
 * normalizados desde el webhook. Comparar una sola forma dejaría pasar justo
 * la colisión que importa: un número que escrito de una manera parece libre y
 * escrito de la otra ya es de alguien.
 */
export function formasDe(telefono: string): string[] {
  const normalizado = normalizeMx(telefono);
  return normalizado === telefono ? [telefono] : [telefono, normalizado];
}

/**
 * La parte del chequeo de teléfono que NO necesita base de datos.
 *
 * La que sí —si ya es de un contacto real de esta organización— vive en
 * `escenarios.ts`, porque es la que de verdad protege y necesita consultar.
 */
export function validarRangoDeTelefono(
  telefono: string
): RechazoDeTelefono | null {
  const formas = formasDe(telefono);

  // 1. El bloque de los seis del producto, en cualquiera de sus dos formas.
  if (
    formas.some(
      (f) =>
        f.startsWith(PREFIJO_GENERICOS) ||
        f.startsWith(PREFIJO_GENERICOS_NORMALIZADO)
    )
  ) {
    return "rango_de_genericos";
  }

  // 2. Fuera del rango reservado: se exige EN POSITIVO. Una lista de rangos
  //    prohibidos se queda corta sola; exigir el propio, no.
  if (!telefono.startsWith(PREFIJO_PROPIOS)) {
    return "fuera_del_rango_reservado";
  }

  return null;
}

/** Una propuesta de escenario, antes de existir como dato. */
export type Propuesta = {
  label: string;
  description: string;
  script: string[];
};

export type RechazoDeGuion =
  | "sin_etiqueta"
  | "etiqueta_larga"
  | "pocas_lineas"
  | "muchas_lineas"
  | "linea_vacia"
  | "linea_larga"
  | "depende_del_contexto";

/** Un guion tiene entre 2 y 5 líneas: menos no es conversación, más deriva. */
const MIN_LINEAS = 2;
const MAX_LINEAS = 5;
const MAX_ETIQUETA = 80;
const MAX_LINEA = 500;

/**
 * Comienzos que delatan que una línea depende de lo que contestó el agente.
 *
 * DELIBERADAMENTE TONTA. Detectar de verdad si una línea depende del contexto
 * exigiría entender la línea —es decir, otro modelo, con su propia falibilidad
 * y su propio coste—. Esta lista atrapa lo evidente y no promete más. Lo que
 * de verdad sostiene FR-627 es que el dueño LEE los guiones antes de
 * guardarlos, y por eso ese paso de revisión no es opcional.
 */
const COMIENZOS_DEPENDIENTES = [
  "eso", "esa", "ese", "esos", "esas",
  "entonces", "y eso", "y ese", "y esa",
  "el segundo", "la segunda", "el primero", "la primera",
  "lo que dijiste", "lo que me dijiste", "como dijiste",
  "el ultimo", "la ultima", "y el otro", "y la otra",
];

/** Sin acentos y en minúsculas, para que "último" case con "ultimo". */
function normalizarParaComparar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Valida un guion. Devuelve el motivo del rechazo, o null si está bien.
 *
 * El cliente simulado NO reacciona: dispara su tercera línea diga lo que diga
 * el agente. Un guion que asuma una respuesta concreta produce diálogos
 * absurdos —"¿y cuánto cuesta el segundo?" cuando el agente nunca mencionó un
 * primero— y evalúa al agente por no adivinar (FR-627).
 */
export function validarGuion(p: Propuesta): RechazoDeGuion | null {
  if (!p.label.trim()) return "sin_etiqueta";
  if (p.label.length > MAX_ETIQUETA) return "etiqueta_larga";
  if (p.script.length < MIN_LINEAS) return "pocas_lineas";
  if (p.script.length > MAX_LINEAS) return "muchas_lineas";
  for (const linea of p.script) {
    const l = linea.trim();
    if (!l) return "linea_vacia";
    if (l.length > MAX_LINEA) return "linea_larga";
  }
  // La primera línea abre la conversación: no puede depender de nada anterior,
  // y las demás tampoco, porque el cliente no escucha.
  for (const linea of p.script) {
    const l = normalizarParaComparar(linea);
    if (COMIENZOS_DEPENDIENTES.some((c) => empiezaPor(l, c))) {
      return "depende_del_contexto";
    }
  }
  return null;
}

/**
 * ¿La línea empieza por este comienzo, como PALABRA?
 *
 * Exigir un espacio detrás dejaba escapar la puntuación pegada —"El segundo,
 * ¿cuánto sale?" no matcheaba "el segundo"—, que es de los casos más comunes.
 * Se pide que lo siguiente no sea letra ni dígito: así "el segundo," entra y
 * "esotérico" no. Lo encontró el test, no la lectura del código.
 *
 * `l` llega ya en minúsculas y sin acentos, así que `[a-z0-9]` basta.
 */
function empiezaPor(l: string, comienzo: string): boolean {
  if (l === comienzo) return true;
  if (!l.startsWith(comienzo)) return false;
  return !/[a-z0-9]/.test(l.charAt(comienzo.length));
}

/** Mensaje para el dueño: dice qué regla falló, no "datos inválidos". */
export function explicarRechazoDeGuion(motivo: RechazoDeGuion): string {
  switch (motivo) {
    case "sin_etiqueta":
      return "El escenario necesita un nombre.";
    case "etiqueta_larga":
      return `El nombre no puede pasar de ${MAX_ETIQUETA} caracteres.`;
    case "pocas_lineas":
      return `Un guion necesita al menos ${MIN_LINEAS} mensajes del cliente.`;
    case "muchas_lineas":
      return `Un guion admite como mucho ${MAX_LINEAS} mensajes: más allá, la conversación simulada deriva.`;
    case "linea_vacia":
      return "Hay un mensaje vacío en el guion.";
    case "linea_larga":
      return "Hay un mensaje demasiado largo: un cliente de WhatsApp no escribe ensayos.";
    case "depende_del_contexto":
      return "Hay un mensaje que da por hecho lo que contestó el agente (empieza por «eso», «entonces», «el segundo»…). El cliente simulado no reacciona: cada mensaje tiene que sostenerse solo.";
  }
}

/** Mensaje para el dueño sobre el teléfono. */
export function explicarRechazoDeTelefono(motivo: RechazoDeTelefono): string {
  switch (motivo) {
    case "rango_de_genericos":
      return "Ese número está reservado para los escenarios que trae el producto.";
    case "fuera_del_rango_reservado":
      return "El número de un escenario tiene que salir del rango reservado para pruebas.";
  }
}

/**
 * Clave estable a partir de la etiqueta. Lleva sufijo aleatorio porque la clave
 * NO se puede reutilizar: `agent_test_case.persona` la guarda, y dos escenarios
 * distintos con la misma clave harían ilegible el histórico.
 */
export function claveDeEscenario(label: string, indice: number): string {
  const base = normalizarParaComparar(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  const sufijo = Math.random().toString(36).slice(2, 7);
  return `gen_${base || "escenario"}_${indice}_${sufijo}`;
}
