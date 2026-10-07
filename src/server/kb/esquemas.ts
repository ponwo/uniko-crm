import { z } from "zod";
import { fechaDeVigencia } from "@/server/kb/vigencia";

/**
 * Lo que aceptan el alta y la edición de una entrada del conocimiento.
 *
 * Viven aquí y no en los `route.ts` porque un archivo de ruta del App Router
 * solo puede exportar sus métodos y su configuración, y estos esquemas tienen
 * prueba propia (`tests/unit/kb-vigencia-rutas.test.ts`).
 *
 * 033 — `validUntil` en los dos tipos de entrada: ausente o `null` en el alta =
 * permanente. Una fecha pasada SE ACEPTA: es la forma de archivar algo a
 * propósito, y la entrada nace vencida.
 */
const vigencia = fechaDeVigencia.nullable().optional();

export const kbCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("qa"),
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(4000),
    validUntil: vigencia,
  }),
  z.object({
    kind: z.literal("block"),
    content: z.string().trim().min(1).max(8000),
    validUntil: vigencia,
  }),
]);

/**
 * 033 (FR-1831, FR-1832) — En la edición, `validUntil` distingue TRES casos que
 * en JSON se parecen:
 *
 *   - ausente → no tocar la fecha (se está editando el texto);
 *   - una fecha → ponerla o moverla (renovar);
 *   - `null` → quitarla: la entrada vuelve a ser permanente.
 *
 * Sin el `null` explícito no habría forma de volver permanente una entrada que
 * ya tuvo fecha. Y editar el texto nunca toca la fecha, ni al revés: renovar y
 * corregir son dos decisiones distintas.
 */
export const kbPatchSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  validUntil: vigencia,
});
