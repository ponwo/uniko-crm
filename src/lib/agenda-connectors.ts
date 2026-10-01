/**
 * 015 — El catálogo de conectores de agenda, sin dependencias de servidor.
 *
 * Vive en `lib/` por la misma razón que `lib/channels.ts`: la interfaz también
 * necesita saber qué conectores existen, cómo se llaman y qué prometen, para
 * que Ajustes → Agenda pueda ofrecerlos sin duplicar la lista a mano.
 *
 * Un conector es la forma en que la cita se convierte en una reunión. El motor
 * no sabe de proveedores: PREGUNTA capacidades, igual que el envío pregunta las
 * del canal. Agregar el tuyo en un fork es escribir su adaptador y declararlo
 * aquí — ver docs/agenda-conectores.md.
 */

export type ConnectorId = "enlace-fijo" | "zoom" | "google";

/** Orden en que se le presentan al operador. El soberano primero. */
export const CONNECTOR_ORDER: readonly ConnectorId[] = [
  "enlace-fijo",
  "zoom",
  "google",
];

export type ConnectorMeta = {
  label: string;
  /** Qué hace, en una línea, para la pantalla de Ajustes. */
  description: string;
  /** ¿Genera un link distinto por cita? (`enlace-fijo` no: es la sala de siempre.) */
  perBookingLink: boolean;
  /** ¿Reprogramar mueve la reunión en el proveedor? */
  updatesMeeting: boolean;
  /** ¿La cita aparece además en el calendario del dueño? */
  writesCalendarEvent: boolean;
  /**
   * ¿Habla con un servicio de terceros? Es la puerta constitucional: los
   * conectores externos existen solo apagados por defecto, aislados tras su
   * adaptador y degradando sin bloquear (Principio II, 1.4.0).
   */
  external: boolean;
  /**
   * ¿Se le ofrece al operador en Ajustes → Agenda? Uno apagado sigue en el
   * catálogo: el negocio que ya lo tiene elegido lo sigue viendo y operando, y
   * volver a ofrecerlo es cambiar este valor. Ocultar NO es quitar del
   * catálogo — eso degradaría en silencio al enlace fijo a quien lo usa.
   */
  listed: boolean;
};

export const CONNECTOR_META: Record<ConnectorId, ConnectorMeta> = {
  "enlace-fijo": {
    label: "Enlace fijo",
    description:
      "Tu sala de siempre: pegas la URL una vez y cada cita la reparte. Sin conectar nada.",
    perBookingLink: false,
    updatesMeeting: false,
    writesCalendarEvent: false,
    external: false,
    listed: true,
  },
  zoom: {
    label: "Zoom",
    description:
      "Cada cita crea su reunión de Zoom. Reprogramar la mueve; cancelar la borra.",
    perBookingLink: true,
    updatesMeeting: true,
    // Zoom sincroniza con el calendario del dueño por su cuenta, si él lo
    // configuró allá; el CRM no lo hace ni lo sabe.
    writesCalendarEvent: false,
    external: true,
    // Oculto desde el 2026-09-30: por ahora se trabaja solo con Google
    // (decisión del dueño). El adaptador y su suite de contrato siguen vivos.
    listed: false,
  },
  google: {
    label: "Google Calendar + Meet",
    description:
      "Cada cita crea un evento en tu calendario; si atiendes en línea, con su enlace de Meet.",
    perBookingLink: true,
    updatesMeeting: true,
    writesCalendarEvent: true,
    external: true,
    listed: true,
  },
};

export function isConnectorId(value: string): value is ConnectorId {
  return (CONNECTOR_ORDER as readonly string[]).includes(value);
}

/**
 * Los que se le ofrecen al operador, más el que ya tiene elegido aunque esté
 * oculto: quien lo usa no debe perderlo de vista ni quedarse sin poder verlo
 * marcado.
 */
export function listedConnectors(current: ConnectorId): ConnectorId[] {
  return CONNECTOR_ORDER.filter(
    (id) => CONNECTOR_META[id].listed || id === current
  );
}

/** El conector por defecto: el único que no depende de nadie. */
export const DEFAULT_CONNECTOR: ConnectorId = "enlace-fijo";

/**
 * 015 (modalidad, 2026-09-30) — Cómo atiende el negocio: en línea o en su
 * local. Es UNA decisión del negocio, no de cada cita.
 *
 *  - `virtual`: lo de siempre — el conector entrega el enlace de la reunión.
 *  - `presencial`: nadie recibe enlace. Si el conector escribe en el
 *    calendario (Google), el evento se crea igual pero SIN Meet: el dueño la
 *    sigue viendo donde mira su día. Al cliente se le da la dirección.
 */
export type MeetingMode = "virtual" | "presencial";

export const MEETING_MODES: readonly MeetingMode[] = ["virtual", "presencial"];

export const DEFAULT_MEETING_MODE: MeetingMode = "virtual";

export function isMeetingMode(value: string): value is MeetingMode {
  return (MEETING_MODES as readonly string[]).includes(value);
}
