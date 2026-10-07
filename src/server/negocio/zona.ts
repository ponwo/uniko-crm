import { ZONA_DEL_PRODUCTO } from "@/lib/time/zona";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";

/**
 * 033 — En qué zona horaria vive el negocio: de ahí sale qué día es «hoy».
 *
 * Lo necesitan dos cosas que no tienen nada que ver entre sí —la fecha que lee
 * el agente en su prompt y la vigencia del conocimiento— y en un mismo turno
 * tienen que hablar del MISMO día. Por eso hay una sola función, y no cada uno
 * calculando su zona por su lado.
 *
 * - Con la agenda encendida, la zona es la de la agenda: es la que ya usan los
 *   horarios que ofrece el agente, y un «hoy» distinto entre la agenda y el
 *   prompt sería un turno contradiciéndose solo.
 * - Sin agenda, México (suposición de producto, `ZONA_DEL_PRODUCTO`), sin
 *   consultar nada. Aunque exista una fila de la agenda de cuando estuvo
 *   encendida: el ajuste de un módulo apagado no gobierna nada.
 *
 * Antes de la 033 esto no existía y el agente solo sabía qué día era con la
 * agenda encendida. El día que haya un negocio fuera de México, lo que toca es
 * darle una zona propia y leerla AQUÍ: es el único sitio que la resuelve.
 */
export async function zonaDelNegocio(organizationId: string): Promise<string> {
  if (!agendaEnabled()) return ZONA_DEL_PRODUCTO;
  return (await getSettings(organizationId)).timezone;
}
