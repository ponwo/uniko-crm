import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isConnectorId, isMeetingMode } from "@/lib/agenda-connectors";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import {
  CalendarSettingsError,
  getSettings,
  upsertSettings,
} from "@/server/agenda/settings";

export const dynamic = "force-dynamic";

/**
 * 015 — La configuración de la agenda del negocio.
 *
 * Una instancia sin configurar responde 200 con los defaults, no 404: la
 * agenda ya es usable el día que se enciende.
 *
 * Jamás devuelve credenciales de un conector — esas viven en su propio
 * endpoint y solo salen como últimos 4 dígitos.
 */
export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const settings = await getSettings(session.organizationId);
  return Response.json({ settings });
});

const intervalSchema = z.object({
  start: z.string(),
  end: z.string(),
});

const putSchema = z.object({
  weeklyHours: z.record(z.string(), z.array(intervalSchema)).optional(),
  slotMinutes: z.number().optional(),
  bufferMinutes: z.number().optional(),
  minNoticeHours: z.number().optional(),
  maxDaysAhead: z.number().optional(),
  timezone: z.string().optional(),
  // El catálogo manda: un conector que no existe se rechaza aquí, y el
  // servicio lo vuelve a comprobar por si el llamador no es esta ruta.
  // Vale el catálogo ENTERO, no solo lo que la pantalla ofrece: un conector
  // oculto (Zoom) sigue siendo válido para quien ya lo tiene elegido, y
  // guardar su horario no debe rechazárselo.
  connector: z
    .string()
    .refine(isConnectorId, { message: "Conector desconocido" })
    .optional(),
  meetingLink: z.string().nullish(),
  meetingMode: z
    .string()
    .refine(isMeetingMode, { message: "Modalidad desconocida" })
    .optional(),
  // Una dirección, no un documento: cabe en un mensaje de WhatsApp.
  location: z.string().max(300).nullish(),
});

/**
 * Guarda lo que se pueda salvar: los enteros fuera de rango se recortan y los
 * intervalos mal escritos se descartan, en vez de tumbar el horario entero por
 * una celda. Lo que sí se rechaza es lo que rompería el motor después: una
 * zona horaria que el runtime no conoce, o un conector inexistente.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  try {
    const settings = await upsertSettings(session.organizationId, {
      ...body.data,
      // `undefined` = no lo tocaron; `null` = lo vaciaron a propósito.
      meetingLink:
        body.data.meetingLink === undefined ? undefined : body.data.meetingLink,
      location:
        body.data.location === undefined ? undefined : body.data.location,
    });
    return Response.json({ settings });
  } catch (err) {
    if (err instanceof CalendarSettingsError) {
      return apiError(422, "invalid_body", err.message);
    }
    throw err;
  }
});
