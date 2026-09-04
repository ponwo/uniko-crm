/**
 * La marca Uniko.
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el trazo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto). Tener el dibujo en un solo sitio es lo que garantiza que
 * la pestaña y la barra lateral enseñen la MISMA "u".
 *
 * El trazo es una "u" caligráfica fluida con remate cian. El cuerpo se pinta
 * con `currentColor` (así hereda el acento white-label); el remate es una
 * constante de marca y NO se recalcula con el acento: es lo que la hace
 * reconocible.
 *
 * La letra es la inicial del producto: se redibujó de "v" a "u" al renombrar
 * la marca. Si vuelve a cambiar el nombre, este par de paths es lo único que
 * hay que tocar — todo lo demás (favicon, mosaico de la barra) los consume.
 */

/**
 * Cuerpo de la "u": se pinta con el color del contexto.
 *
 * Un solo trazo continuo en un lienzo de 24×24: asta izquierda hacia abajo,
 * panza redonda y asta derecha subiendo casi a la misma altura. Las dos astas
 * parejas son lo que hace que se lea "u" y no "v" a 16 px, que es el tamaño
 * al que de verdad se ve en una pestaña.
 */
export const BRAND_MARK_BODY =
  "M4.6 5.3c-.5 5.5-.2 9.8.9 12 1.5 2.9 5.3 2.2 7.2-1.2 1.5-2.4 2.3-5.8 2.3-9.9";

/**
 * Remate corto, siempre cian: sale del alto del asta derecha casi en
 * horizontal. Plano y no vertical a propósito — subiendo se empastaba con el
 * asta al reducir, y el remate acababa pareciendo una gota pegada encima.
 */
export const BRAND_MARK_TAIL = "M15 6.2c1.5-1.5 3.3-2 5.4-1.7";

export const BRAND_MARK_STROKE = 3.4;

/** Cian sobre fondos claros (texto azul al lado). */
export const BRAND_CYAN = "#00c6f5";

/** Cian sobre el mosaico azul: un punto más claro para que no se hunda. */
export const BRAND_CYAN_ON_TILE = "#3fdcff";

/**
 * ¿Esta instancia se llama Uniko?
 */
export function isUnikoName(name: string): boolean {
  return name.trim().toLowerCase() === "uniko";
}
