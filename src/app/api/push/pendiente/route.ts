import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { pushDisabledResponse, pushEnabled } from "@/server/push/flag";

export const dynamic = "force-dynamic";

/**
 * Qué mostrar en la notificación.
 *
 * Existe porque **el aviso viaja vacío** (FR-505): ningún dato del negocio ni de
 * sus clientes atraviesa a Google o Apple. El service worker recibe "hay algo" y
 * pregunta aquí, a **su propia instancia**, qué escribir en la notificación.
 *
 * Devuelve la escalación más reciente que sigue esperando a un humano. No hace
 * falta correlacionar con el aviso concreto: el pipeline calla en cuanto hay
 * handoff, así que no se acumulan escalaciones sin atender de la misma
 * conversación (research R4).
 *
 * Autenticada como todo lo demás: el service worker manda las cookies del
 * origen. Si la sesión caducó, el worker enseña el texto degradado (FR-507).
 */
/**
 * Por qué está esperando, en una línea.
 *
 * **Escrito para la vigésima vez, no para la primera** (mismo filtro que FR-423
 * en la 019). Quien lee esto a las nueve de la noche ya sabe qué es esta app y
 * qué hace el agente: no necesita que se lo expliquen otra vez, necesita saber
 * a qué entra. Por eso dice el motivo y no el mecanismo — nada de "el agente ha
 * derivado la conversación", que es contarle a alguien cómo funciona su propio
 * producto por vigésima vez.
 */
function motivoLegible(motivo: string | null): string {
  switch (motivo) {
    case "cliente":
      return "Pidió hablar con una persona.";
    case "ventana":
      return "Pasaron 24 horas sin respuesta.";
    case "modelo":
      return "El agente no supo cómo seguir.";
    case "error":
      return "El agente falló y no pudo continuar.";
    default:
      return "Está esperando respuesta.";
  }
}

export const GET = withAuth(async (session) => {
  if (!pushEnabled()) return pushDisabledResponse();

  const db = getDb();
  const filas = await db
    .select({
      id: schema.conversation.id,
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
      contactName: schema.contact.name,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.contact.id, schema.conversation.contactId)
    )
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        isNotNull(schema.conversation.handoffAt),
        // El Laboratorio no se asoma nunca por aquí, ni siquiera para leer.
        eq(schema.conversation.isTest, false)
      )
    )
    .orderBy(desc(schema.conversation.handoffAt))
    .limit(1);

  const fila = filas[0];
  if (!fila) return Response.json({ pendiente: null });

  return Response.json({
    pendiente: {
      conversationId: fila.id,
      // El nombre del contacto sale de la instancia, no del aviso: por eso se
      // puede enseñar sin que nadie de fuera lo haya visto.
      titulo: fila.contactName
        ? `${fila.contactName} necesita atención`
        : "Alguien necesita atención",
      cuerpo: motivoLegible(fila.handoffReason),
    },
  });
});
