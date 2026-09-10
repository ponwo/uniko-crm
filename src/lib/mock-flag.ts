/**
 * La bandera del entorno de pruebas interno (FR-080), en un módulo HOJA.
 *
 * Vivía en `env.ts`, pero ese módulo carga zod y usa `Buffer` al importarse,
 * y el middleware (024) corre en el runtime Edge, donde no hay `Buffer`. La
 * función es una lectura de dos variables: no necesita nada de eso. `env.ts`
 * la re-exporta, así que quien ya la importaba de ahí no cambia.
 *
 * Se lee `process.env` en cada llamada, no al cargar: en un `next build` el
 * bundler fija `NODE_ENV` a `production`, y `WA_MOCK_ENABLED` tiene que
 * reflejar el entorno real en el que arrancó el proceso, no el de la máquina
 * donde se construyó la imagen.
 */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}
