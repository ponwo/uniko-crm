/**
 * La unidad de la existencia en plural cuando la cantidad no es 1: «14 piezas»,
 * «3 cajas», «2 pares», «5 galones». MS-Stock guarda la unidad como texto libre del
 * negocio (hasta 32 caracteres; el portal sugiere «pieza, kg, litro, caja…»), así que
 * esto no adivina: pluraliza solo lo que reconoce como palabra española y deja igual
 * todo lo demás. Equivocarse dejando una unidad en singular cuesta poco; inventar un
 * plural («kgs», «pzases») se ve peor.
 *
 * Se queda IGUAL:
 * - con cantidad 1 (y la unidad tal como la escribió el negocio);
 * - una abreviatura o símbolo: sin vocales (kg, ml, cm, lt, pz), con punto (pza.),
 *   en MAYÚSCULAS (PZA, KG, L) o de la lista de abajo (pza, ud, oz, gal…);
 * - lo que ya termina en -s o -x (piezas, pzas, uds, lunes, tórax): no se
 *   singulariza ni se le agrega otra;
 * - lo que no es una palabra de letras (m², 1/2, caja12).
 *
 * Se pluraliza (reglas de la RAE para los casos comunes):
 * - vocal, con o sin acento → +s (pieza → piezas, café → cafés);
 * - -z → -ces (lápiz → lápices);
 * - l, n, r, d, j, y → +es, y una aguda pierde el acento (par → pares,
 *   unidad → unidades, galón → galones);
 * - otra consonante, préstamos → +s (kit → kits, pack → packs).
 *
 * Varias palabras: se pluralizan hasta la primera preposición, número o abreviatura,
 * y el resto queda igual (caja de 12 → cajas de 12, metro cuadrado → metros
 * cuadrados, rollo 50 m → rollos 50 m).
 *
 * Fuera de alcance (quedan mal, raros como unidad de inventario): las palabras que
 * GANAN acento en plural (examen → exámenes) y los plurales irregulares.
 */
export function unidadPara(unit: string, cantidad: number): string {
  if (cantidad === 1) return unit;
  const palabras = unit.trim().split(/\s+/);
  const resultado: string[] = [];
  let sigue = true;
  for (const palabra of palabras) {
    if (sigue && !PREPOSICIONES.has(palabra.toLowerCase()) && esPalabra(palabra)) {
      resultado.push(pluralDe(palabra));
    } else {
      sigue = false;
      resultado.push(palabra);
    }
  }
  return resultado.join(" ");
}

/** Abreviaturas con vocal que no se pluralizan (las que no tienen vocal ya se detectan solas). */
const ABREVIATURAS = new Set(["pza", "ud", "und", "uni", "gal", "oz", "ton", "pulg", "paq", "doc"]);

/** Las palabras que cortan la frase: lo que sigue describe la unidad, no es la unidad. */
const PREPOSICIONES = new Set(["de", "del", "con", "por", "para", "en"]);

const VOCAL = /[aeiouáéíóú]/i;
const AGUDA: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };

/** Una palabra española pluralizable: solo letras, con vocal, no en mayúsculas, no abreviatura. */
function esPalabra(palabra: string): boolean {
  if (palabra.length < 2 || !/^\p{L}+$/u.test(palabra)) return false;
  if (!VOCAL.test(palabra) || palabra === palabra.toUpperCase()) return false;
  return !ABREVIATURAS.has(palabra.toLowerCase());
}

function pluralDe(palabra: string): string {
  const ultima = palabra.at(-1)!.toLowerCase();
  if ("sx".includes(ultima)) return palabra;
  if ("aeiouáéíóú".includes(ultima)) return `${palabra}s`;
  if (ultima === "z") return `${palabra.slice(0, -1)}ces`;
  if ("lnrdjy".includes(ultima)) return `${sinAcentoAgudo(palabra)}es`;
  return `${palabra}s`;
}

/**
 * Una aguda terminada en -n/-l/-r… pierde el acento al volverse llana con -es
 * (galón → galones, almacén → almacenes). Solo se mira la penúltima letra: es donde
 * cae el acento de esas agudas.
 */
function sinAcentoAgudo(palabra: string): string {
  const penultima = palabra.at(-2) ?? "";
  const sin = AGUDA[penultima];
  if (!sin) return palabra;
  return `${palabra.slice(0, -2)}${sin}${palabra.slice(-1)}`;
}
