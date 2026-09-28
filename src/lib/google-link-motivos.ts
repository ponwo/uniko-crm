/**
 * 029 — Cómo terminó el recorrido del link de Google, en palabras del titular.
 *
 * Catálogo CERRADO: la página de resultado solo muestra estos textos, elegidos
 * por su clave. Un `estado` desconocido en la dirección cae en el genérico y
 * nunca se refleja (FR-1420). Sin código de servidor: lo importan la ruta y la
 * página.
 *
 * Quien lee esto es el titular del calendario —alguien sin contexto técnico,
 * que acaba de estar en pantallas de Google— así que cada texto dice qué pasó
 * y qué hacer, y cuándo sirve el MISMO link (todo lo que no lo consumió).
 */

export const MOTIVOS = [
  "ok",
  "link_invalido",
  "link_vencido",
  "link_usado",
  "cancelado",
  "permiso_incompleto",
  "otro_navegador",
  "google_no_respondio",
  "politica_empresa",
  "google_rechazo",
  "prueba_fallida",
] as const;

export type Motivo = (typeof MOTIVOS)[number];

export function parseMotivo(raw: unknown): Motivo | null {
  return typeof raw === "string" && (MOTIVOS as readonly string[]).includes(raw)
    ? (raw as Motivo)
    : null;
}

export type Mensaje = { titulo: string; texto: string; tono: "ok" | "error" };

export const MENSAJES: Record<Motivo, Mensaje> = {
  ok: {
    titulo: "Listo: tu calendario quedó conectado",
    texto:
      "Cada cita que se agende creará un evento con su enlace de Google Meet en tu calendario. Ya puedes cerrar esta ventana.",
    tono: "ok",
  },
  link_invalido: {
    titulo: "Este link no es válido",
    texto:
      "Puede que lo hayan reemplazado por uno nuevo o que no se haya copiado completo. Pide un link nuevo a quien te lo envió.",
    tono: "error",
  },
  link_vencido: {
    titulo: "Este link venció",
    texto: "Los links duran 72 horas. Pide uno nuevo a quien te lo envió.",
    tono: "error",
  },
  link_usado: {
    titulo: "Este link ya se usó",
    texto:
      "Cada link sirve una sola vez. Si necesitas volver a conectar tu calendario, pide uno nuevo a quien te lo envió.",
    tono: "error",
  },
  cancelado: {
    titulo: "Cancelaste la autorización",
    texto:
      "No se conectó nada. Si fue sin querer, vuelve a abrir el mismo link y acepta el permiso en la pantalla de Google.",
    tono: "error",
  },
  permiso_incompleto: {
    titulo: "Falta el permiso del calendario",
    texto:
      "No se conectó nada. Vuelve a abrir el mismo link y, en la pantalla de Google, marca la casilla del permiso para los eventos de tus calendarios.",
    tono: "error",
  },
  otro_navegador: {
    titulo: "Hay que terminar en el mismo navegador",
    texto:
      "Por seguridad, la autorización tiene que terminar en el navegador donde abriste el link y en menos de 15 minutos. Vuelve a abrir el mismo link.",
    tono: "error",
  },
  google_no_respondio: {
    titulo: "Google no respondió",
    texto:
      "No se conectó nada. Espera unos minutos y vuelve a abrir el mismo link.",
    tono: "error",
  },
  politica_empresa: {
    titulo: "Tu empresa no permite esta conexión",
    texto:
      "El administrador de tu cuenta de Google bloquea las apps externas. Pídele que permita la app que viste en la pantalla de Google, o conecta otra cuenta con el mismo link.",
    tono: "error",
  },
  google_rechazo: {
    titulo: "Google no autorizó la conexión",
    texto:
      "No se conectó nada. Vuelve a abrir el mismo link; si se repite, avisa a quien te lo envió.",
    tono: "error",
  },
  prueba_fallida: {
    titulo: "La conexión no pasó la prueba",
    texto:
      "Google autorizó, pero no pudimos comprobar tu calendario, así que no se guardó nada. Vuelve a abrir el mismo link; si se repite, avisa a quien te lo envió.",
    tono: "error",
  },
};

/** Para un `estado` que no está en el catálogo. */
export const MENSAJE_GENERICO: Mensaje = {
  titulo: "No pudimos completar la conexión",
  texto:
    "Vuelve a abrir el link que te enviaron; si se repite, avisa a quien te lo envió.",
  tono: "error",
};
