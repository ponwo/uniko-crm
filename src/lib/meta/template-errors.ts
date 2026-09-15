import type { MetaApiError } from "@/lib/meta/client";

/**
 * 027 — Traduce el error de Meta al CREAR o LISTAR plantillas a algo que el
 * dueño pueda ACCIONAR.
 *
 * Mismo patrón que `send-errors.ts`. Meta valida de forma síncrona al crear y
 * responde SIEMPRE "(#100) Invalid parameter" en `message`; la causa viaja en
 * el subcódigo y en `error_user_msg`, y hasta esta feature el CRM la tiraba.
 * Los subcódigos de esta tabla son los que Meta documenta para plantillas;
 * el resto cae en el texto más específico que Meta mandó, conservando el
 * código para rastrearlo.
 */

const POR_SUBCODIGO: Record<number, string> = {
  2388299:
    "Meta no acepta variables al inicio ni al final del cuerpo, ni dos pegadas: escribe texto antes, después y entre ellas.",
  2388293:
    "Meta considera que hay demasiadas variables para lo corto del texto: agrega más texto fijo o quita variables.",
  2388072:
    "El cuerpo tiene un formato que Meta no acepta: revisa saltos de línea repetidos, tabulaciones o caracteres raros.",
  2388047: "El encabezado tiene un formato que Meta no acepta.",
  2388073: "El pie de página tiene un formato que Meta no acepta.",
  2388040:
    "Un campo supera el máximo de caracteres que Meta permite: acorta el cuerpo.",
  2388019:
    "Tu cuenta llegó al máximo de plantillas que Meta permite (250). Borra en el Administrador de WhatsApp alguna que ya no uses y vuelve a intentarlo.",
  2388039:
    "Meta no permite cambiar esta plantilla mientras está en revisión: espera a que la apruebe o la rechace.",
};

const SIN_PERMISO =
  "El token guardado no tiene permiso para administrar plantillas: necesita whatsapp_business_management además de whatsapp_business_messaging. Genera uno nuevo en Meta Business (Usuarios del sistema → Generar token) con los dos permisos y pégalo en Ajustes → WhatsApp.";

const WABA_DESCONOCIDO =
  "Meta no encuentra el WABA ID guardado con este token. En Ajustes → WhatsApp debe ir el ID de la cuenta de WhatsApp Business (no el ID del negocio ni el del número), y el token debe tener acceso a esa cuenta.";

const LIMITE_DE_LLAMADAS =
  "Meta limitó temporalmente las llamadas de administración de tu cuenta: espera unos minutos y vuelve a intentarlo.";

/** Códigos de permiso de Graph: 3 (capacidad), 10 (permiso), 200 (token sin permiso). */
const CODIGOS_DE_PERMISO = new Set([3, 10, 200]);

/** Límites de tasa de Graph, generales y del WABA. */
const CODIGOS_DE_TASA = new Set([4, 17, 32, 613, 80007]);

/**
 * @param err Error de Meta.
 * @returns Frase accionable + el código entre paréntesis, p. ej.
 *          «… (Meta 100/2388299)».
 */
export function describeTemplateError(err: MetaApiError): string {
  const base = fraseBase(err);
  const label = err.codeLabel;
  return label ? `${base} (Meta ${label})` : base;
}

function fraseBase(err: MetaApiError): string {
  if (err.subcode != null && POR_SUBCODIGO[err.subcode]) {
    return POR_SUBCODIGO[err.subcode]!;
  }
  if (err.code != null && CODIGOS_DE_PERMISO.has(err.code)) return SIN_PERMISO;
  if (err.status === 403) return SIN_PERMISO;
  if (err.code === 100 && err.subcode === 33) return WABA_DESCONOCIDO;
  if (err.code != null && CODIGOS_DE_TASA.has(err.code)) return LIMITE_DE_LLAMADAS;
  // Lo que Meta dijo, tal cual: es más útil que "Invalid parameter" aunque
  // venga en inglés, y es lo que hay que pegar en un reporte.
  return err.explanation;
}

/**
 * Meta no documenta un subcódigo para el nombre repetido; lo dice en el
 * título o el mensaje de usuario. Se busca en TODOS los textos que mandó.
 */
export function esNombreDuplicado(err: MetaApiError): boolean {
  const textos = [err.userTitle, err.userMsg, err.detail, err.message];
  return textos.some((t) => t != null && /already exists/i.test(t));
}

/** Meta no encuentra el WABA (id mal copiado) o el token no lo alcanza. */
export function esWabaDesconocido(err: MetaApiError): boolean {
  return err.code === 100 && err.subcode === 33;
}

/** El token no tiene los permisos de administración de plantillas. */
export function esFaltaDePermiso(err: MetaApiError): boolean {
  return (err.code != null && CODIGOS_DE_PERMISO.has(err.code)) || err.status === 403;
}
