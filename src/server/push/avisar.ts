import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { clavesDeLaOrganizacion } from "@/server/push/claves";
import { enviarAviso } from "@/server/push/enviar";
import { pushEnabled } from "@/server/push/flag";

/**
 * La capacidad de dominio: "avisa de esta escalación".
 *
 * Es lo ÚNICO que `applyHandoff()` conoce. Detrás está Web Push, pero el
 * dominio no lo sabe ni tiene por qué (condición 2 del ADR-003).
 *
 * El orden de las guardas no es estético — está en el contrato y es el orden en
 * que tienen que estar:
 *
 *   1. `is_test` PRIMERO. El Laboratorio escala por este mismo camino, así que
 *      sin este corte, evaluar el agente un martes por la tarde llenaría de
 *      notificaciones reales los teléfonos del equipo. Es el mismo guardarraíl
 *      que ya protege el envío de WhatsApp y la agenda (FR-503).
 *   2. La bandera. Sin `PUSH`, esto no existe.
 *   3. Los destinatarios.
 *
 * Y dos reglas sobre el fallo:
 *
 * - **Nunca lanza.** La escalación ya está guardada cuando esto corre y no
 *   puede costarla (FR-504). Todo va envuelto.
 * - **No reintenta.** Está en "fuera de alcance" de la spec, con su razón.
 */

/** Quién debe recibir el aviso de una escalación. Pura: se prueba sin base. */
export function destinatarios(input: {
  esConversacionDePrueba: boolean;
  banderaEncendida: boolean;
  suscripciones: ReadonlyArray<{ id: string; endpoint: string }>;
}): ReadonlyArray<{ id: string; endpoint: string }> {
  // El Laboratorio no despierta a nadie. Primero, siempre.
  if (input.esConversacionDePrueba) return [];
  if (!input.banderaEncendida) return [];
  return input.suscripciones;
}

/**
 * Avisa de una escalación. Se llama después de que el handoff esté guardado.
 *
 * No se espera (`void`): el handoff no depende de esto.
 */
export async function avisarDeEscalacion(input: {
  conversationId: string;
  organizationId: string;
  esConversacionDePrueba: boolean;
}): Promise<void> {
  try {
    // Las dos primeras guardas, antes de tocar la base siquiera.
    if (input.esConversacionDePrueba) return;
    if (!pushEnabled()) return;

    const db = getDb();
    const suscripciones = await db
      .select({
        id: schema.pushSubscription.id,
        endpoint: schema.pushSubscription.endpoint,
      })
      .from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.organizationId, input.organizationId));

    const aQuien = destinatarios({
      esConversacionDePrueba: input.esConversacionDePrueba,
      banderaEncendida: true,
      suscripciones,
    });
    if (aQuien.length === 0) return;

    const claves = await clavesDeLaOrganizacion(input.organizationId);
    const sujeto = process.env.APP_BASE_URL ?? "https://uniko.app";

    await Promise.all(
      aQuien.map(async (s) => {
        const resultado = await enviarAviso({
          endpoint: s.endpoint,
          claves,
          sujeto,
        });

        if (resultado === "caducada") {
          // Ese teléfono ya no está: se olvida. Borrar dos veces da igual.
          await db
            .delete(schema.pushSubscription)
            .where(
              and(
                eq(schema.pushSubscription.id, s.id),
                eq(
                  schema.pushSubscription.organizationId,
                  input.organizationId
                )
              )
            );
          return;
        }

        if (resultado === "entregada") {
          await db
            .update(schema.pushSubscription)
            .set({ lastOkAt: new Date() })
            .where(eq(schema.pushSubscription.id, s.id));
        }
        // `fallo`: no se reintenta y no se rompe nada. La escalación ya está.
      })
    );
  } catch {
    // Aquí se traga TODO a propósito. Si esta función lanzara, un fallo del
    // servicio de push podría costar una escalación — que es exactamente lo
    // que FR-504 prohíbe.
  }
}
