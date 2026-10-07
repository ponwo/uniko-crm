/**
 * 033 — La zona horaria en la que el producto lee el reloj cuando nada dice otra cosa.
 *
 * Es una SUPOSICIÓN DE PRODUCTO, no una constante técnica (decisión del dueño,
 * 2026-10-07): todos los negocios de la flota operan en México. El día que haya
 * uno fuera, lo que toca es darle al negocio una zona propia; el único sitio que
 * la resuelve es `zonaDelNegocio()` (`src/server/negocio/zona.ts`).
 *
 * No es cosmético. El servidor vive en UTC y México va seis horas atrás: leer el
 * día en UTC daría el DÍA SIGUIENTE desde las 18:00 locales —justo la franja en
 * que más se escribe por WhatsApp— y vencería el conocimiento seis horas antes de
 * tiempo.
 *
 * La agenda usa este mismo valor como zona por defecto (`DEFAULT_TIMEZONE`): un
 * solo valor y no dos que puedan divergir.
 */
export const ZONA_DEL_PRODUCTO = "America/Mexico_City";
