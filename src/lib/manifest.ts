import type { Branding } from "@/lib/branding";

/**
 * El manifiesto de la aplicación instalable, construido a partir de la marca.
 *
 * Función pura: recibe la marca y si el icono del negocio sirve, y devuelve el
 * objeto. Así se puede probar sin servidor y sin base de datos.
 *
 * Contrato:
 * [contracts/manifest.md](../../specs/019-pwa-instalable/contracts/manifest.md)
 */

/**
 * Identificador de la app instalada. **Fijo, y no derivado de la marca.**
 *
 * Si cambiara al renombrar el negocio, el navegador trataría la app renombrada
 * como una aplicación distinta: el operador acabaría con dos iconos en su
 * pantalla de inicio y ninguno de los dos sería el bueno.
 */
export const MANIFEST_ID = "/?uniko-app";

/** Lo que cabe bajo un icono sin convertirse en puntos suspensivos. */
const MAX_SHORT_NAME = 12;

export type IconoManifiesto = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

export type Manifiesto = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  lang: string;
  dir: string;
  icons: IconoManifiesto[];
};

export function shortName(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio.length <= MAX_SHORT_NAME) return limpio;
  // Se corta por palabra si se puede: "Clínica Dental Norte" → "Clínica".
  const primera = limpio.split(/\s+/)[0] ?? limpio;
  return (primera.length <= MAX_SHORT_NAME ? primera : limpio.slice(0, MAX_SHORT_NAME)).trim();
}

/**
 * Los iconos que se declaran.
 *
 * - **Con icono del negocio que sirve**: una sola entrada, la suya, declarada
 *   para las dos medidas. Una sola a propósito: con dos, el navegador podría
 *   escoger el logo de Uniko para el hueco pequeño y el del negocio para el
 *   grande, y la app instalada tendría dos marcas.
 * - **Sin él**: los dos PNG de fábrica, que viajan en la imagen y no dependen ni
 *   de la base de datos ni del volumen de medios. Son los que hacen instalable a
 *   una instancia recién desplegada — y hoy, a las tres de la flota.
 */
export function iconosManifiesto(input: {
  iconoDelNegocioSirve: boolean;
  version: string;
}): IconoManifiesto[] {
  if (input.iconoDelNegocioSirve) {
    return [
      {
        src: `/api/branding/icon?v=${input.version}`,
        sizes: "192x192 512x512",
        type: "image/png",
      },
    ];
  }
  return [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ];
}

export function construirManifiesto(input: {
  branding: Branding;
  iconoDelNegocioSirve: boolean;
  version: string;
  /** Fondo de la app: el mismo `--surface` del tema claro. */
  backgroundColor?: string;
}): Manifiesto {
  const nombre = input.branding.name.trim() || "Uniko";
  return {
    id: MANIFEST_ID,
    name: `${nombre} — CRM de WhatsApp`,
    short_name: shortName(nombre),
    description:
      "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
    // La pantalla de trabajo. Sin sesión redirige al login, como cualquier otra.
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    theme_color: input.branding.accent,
    background_color: input.backgroundColor ?? "#ffffff",
    lang: "es",
    dir: "ltr",
    icons: iconosManifiesto({
      iconoDelNegocioSirve: input.iconoDelNegocioSirve,
      version: input.version,
    }),
  };
}
