import type { ChatMessage } from "@/lib/ai";
import { dayIsoInTz, dayLabelInTz } from "@/lib/time/slots";

/**
 * 015 (ajuste 2026-09-26) — El historial lleva escrito de qué día es.
 *
 * Encontrado en producción por el dueño, dos veces seguidas. Una conversación
 * retomada dos días después arrastraba este mensaje del agente:
 *
 *   «Tu cita quedó agendada para mañana jueves a las 10:00 am 🎉»
 *
 * El cliente escribió «hola quisiera agendar una cita» y el agente contestó
 * «ya tienes una cita para mañana jueves 24» — un viernes 25. El «mañana» de
 * hace dos días seguía pareciendo mañana, porque en el hilo que ve el modelo
 * **no hay ninguna marca de tiempo**: veinte mensajes seguidos, sin fecha,
 * como si fueran de la misma tarde.
 *
 * Decirle en el prompt qué día es hoy es la mitad del arreglo. La otra mitad es
 * esta: marcar dónde termina lo viejo y empieza lo de hoy, para que no tenga
 * que deducirlo. Se marca con mensajes `system` y no con prefijos dentro del
 * texto porque un prefijo se imita: el agente acabaría escribiéndole «(23 sep)»
 * al cliente.
 */

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  at: Date;
};

export function withDayMarkers(
  messages: HistoryMessage[],
  opts: { timezone: string; now: Date }
): ChatMessage[] {
  if (messages.length === 0) return [];
  const hoy = dayIsoInTz(opts.now, opts.timezone);

  const viejos = messages.filter(
    (m) => dayIsoInTz(m.at, opts.timezone) !== hoy
  );
  // Todo es de hoy: el hilo se lee solo, no hace falta marcar nada.
  if (viejos.length === 0) {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const out: ChatMessage[] = [];
  let marcadoHoy = false;
  for (const [i, m] of messages.entries()) {
    const esDeHoy = dayIsoInTz(m.at, opts.timezone) === hoy;
    if (i === 0 && !esDeHoy) {
      out.push({
        role: "system",
        content: `(Lo que sigue es de una conversación ANTERIOR, del ${dayLabelInTz(
          m.at.toISOString(),
          opts.timezone,
          opts.now
        )}. Cualquier fecha u hora que se prometiera ahí ya pasó o puede haber cambiado: no la des por vigente.)`,
      });
    }
    if (esDeHoy && !marcadoHoy) {
      marcadoHoy = true;
      out.push({
        role: "system",
        content: "(Lo que sigue es de HOY.)",
      });
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
