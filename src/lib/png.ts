/**
 * Lo justo de PNG para saber si un icono sirve para instalar.
 *
 * Sin librería de imagen a propósito: un PNG lleva su ancho y su alto en el
 * primer chunk (`IHDR`), en los bytes 16-23, big-endian. Leerlos son diez
 * líneas, y meter una dependencia de imagen en el runtime por esto sería
 * exactamente lo que la spec descartó (soberanía, Principio II).
 *
 * Es el mismo criterio que ya sigue `sniffFaviconMime`: mirar los bytes en vez
 * de creerse lo que declara quien sube el archivo.
 */

/** Lo que Chrome pide para considerar instalable, y lo que iOS agradece. */
export const ICONO_INSTALABLE_MIN_PX = 512;

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Ancho y alto de un PNG, o `null` si no lo es o está truncado.
 *
 * Un archivo cortado antes del byte 24 no tiene cabecera completa: devolver
 * medidas inventadas ahí sería peor que decir que no se sabe.
 */
export function medidasPng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (FIRMA_PNG.some((b, i) => bytes[i] !== b)) return null;

  const leerU32 = (offset: number) =>
    ((bytes[offset] ?? 0) << 24 |
      (bytes[offset + 1] ?? 0) << 16 |
      (bytes[offset + 2] ?? 0) << 8 |
      (bytes[offset + 3] ?? 0)) >>> 0;

  const width = leerU32(16);
  const height = leerU32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * ¿Sirve este icono para la app instalada?
 *
 * Tres condiciones, y las tres por una razón concreta:
 *
 * - **PNG**: el soporte de SVG en la lista de iconos del manifiesto no es fiable
 *   entre plataformas, e iOS lo ignora del todo para el icono de la pantalla de
 *   inicio.
 * - **Cuadrado**: un icono rectangular se recorta o se deforma, y el resultado
 *   depende del sistema. Mejor caer al de fábrica que enseñar el logo del
 *   negocio estirado.
 * - **512 px o más**: es la medida grande que pide el algoritmo de
 *   instalabilidad. Por debajo, el navegador puede no ofrecer instalar.
 */
export function iconoSirveParaInstalar(
  mime: string | null | undefined,
  bytes: Uint8Array
): boolean {
  if (mime !== "image/png") return false;
  const medidas = medidasPng(bytes);
  if (!medidas) return false;
  return (
    medidas.width === medidas.height && medidas.width >= ICONO_INSTALABLE_MIN_PX
  );
}
