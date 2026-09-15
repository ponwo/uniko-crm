/**
 * Reglas de las plantillas de WhatsApp que comparten servidor y UI.
 * Puro y sin dependencias: la pantalla necesita las MISMAS reglas que el
 * servidor para avisar antes de gastar una llamada a Meta, y el selector
 * decide con la misma función que la última barrera del envío.
 */

const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/** `{{nombre}}`: variables con nombre (el Administrador de WhatsApp las ofrece). */
const NAMED_VARIABLE_REGEX = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;

/** Máximo de parámetros posicionales por cuerpo que acepta Meta. */
export const MAX_TEMPLATE_VARIABLES = 10;

/**
 * Meta solo reconoce `{{1}}` pegado. `{{ 1 }}` le parece texto, y entonces el
 * número de ejemplos que mandamos deja de cuadrar con las variables que ve.
 * Se normaliza ANTES de validar, de mandar y de guardar: el cuerpo que se
 * guarda es exactamente el que Meta aprobó.
 */
export function normalizeBody(body: string): string {
  return body.trim().replace(VARIABLE_REGEX, (_m, n: string) => `{{${n}}}`);
}

/** Índices distintos de {{n}} presentes en el cuerpo, ordenados. */
function variableIndexes(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(VARIABLE_REGEX)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * Cuántos parámetros exige el cuerpo = el índice más alto. Con la numeración
 * validada (1..N sin saltos) equivale al número de variables distintas.
 */
export function countVariables(body: string): number {
  const indexes = variableIndexes(body);
  return indexes.length ? indexes[indexes.length - 1]! : 0;
}

/**
 * Lo que Meta valida de forma SÍNCRONA al crear, comprobado antes aquí con
 * el mismo mensaje en la pantalla y en el servidor. Cada regla tiene su
 * subcódigo documentado por Meta; sin esta función todas llegaban como
 * "(#100) Invalid parameter":
 *
 * - numeración posicional contigua desde {{1}} (un salto es rechazo seguro);
 * - hasta 10 variables;
 * - 2388299: la variable no puede ir al inicio ni al final del cuerpo, ni
 *   dos variables pegadas (solo espacios entre ellas).
 */
export function validateBodyVariables(body: string): string | null {
  const texto = normalizeBody(body);
  const indexes = variableIndexes(texto);
  if (indexes.length === 0) return null;
  if (indexes.length > MAX_TEMPLATE_VARIABLES) {
    return `El cuerpo admite hasta ${MAX_TEMPLATE_VARIABLES} variables`;
  }
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i + 1) {
      return `Las variables deben ir numeradas {{1}}, {{2}}, … sin saltos (falta {{${i + 1}}})`;
    }
  }
  if (/^\{\{\d+\}\}/.test(texto)) {
    return "Meta no acepta que el cuerpo EMPIECE con una variable: escribe algo antes (p. ej. «Hola {{1}}, …»)";
  }
  if (/\{\{\d+\}\}$/.test(texto)) {
    return "Meta no acepta que el cuerpo TERMINE con una variable: escribe algo después (aunque sea un punto o una pregunta)";
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(texto)) {
    return "Meta no acepta dos variables pegadas: pon texto entre ellas (p. ej. «{{1}} el {{2}}»)";
  }
  return null;
}

/** Sustituye {{n}} por `variables[n-1]` (vacío si no hay valor). */
export function renderBody(body: string, variables: string[] = []): string {
  return body.replace(VARIABLE_REGEX, (_match, index: string) => {
    return variables[Number(index) - 1] ?? "";
  });
}

/* ============================================================
 * 027 — Lo que Meta dice DESPUÉS de aprobar
 * ============================================================ */

/**
 * Si se puede enviar. Vive aquí —y no repetido en cada pantalla— porque son
 * CUATRO condiciones y olvidar cualquiera no da error visible: la plantilla
 * aparece en el selector y el fallo llega desde Meta al pulsar Enviar.
 *
 * 1. Completó el ciclo de aprobación de este CRM (`status`).
 * 2. Meta la sigue listando (`missingSince`): una borrada en el Administrador
 *    de WhatsApp conserva su `approved` aquí —no la borramos, el historial la
 *    referencia— pero ya no se puede mandar.
 * 3. Meta dice APPROVED AHORA MISMO (`metaStatus`). Se exige EN POSITIVO, no
 *    excluyendo una lista de estados malos: Meta responde también PAUSED,
 *    DISABLED, LIMIT_EXCEEDED, DELETED, ARCHIVED, y mañana puede inventar
 *    otro. Lo desconocido bloquea por defecto; NULL —sin noticias de Meta—
 *    también, porque no saber no es permiso.
 * 4. El CRM sabe rellenarla (`analizarComponentes`): solo cuerpo con
 *    variables posicionales. Una importada con encabezado multimedia o
 *    botones dinámicos se muestra, pero no se ofrece.
 */
export function esEnviable(t: {
  status: string;
  missingSince: string | Date | null;
  metaStatus: string | null;
  body: string;
  components?: TemplateComponent[] | null;
}): boolean {
  return (
    t.status === "approved" &&
    t.missingSince === null &&
    t.metaStatus === "APPROVED" &&
    analizarComponentes(t.components ?? null, t.body).requisito === null
  );
}

/**
 * Por qué NO se puede enviar y qué hacer al respecto.
 *
 * Bloquear el envío sin decir nada deja al operador con una plantilla que
 * desapareció del selector y ninguna pista: el fallo se convierte en "el CRM
 * está roto". Cada estado de Meta tiene una causa y una salida distintas, y la
 * salida casi nunca está en este CRM —está en el Administrador de WhatsApp—,
 * así que hay que nombrarla.
 *
 * Devuelve null cuando la plantilla no está bloqueada POR META. El ciclo de
 * aprobación (borrador, pendiente, rechazada) y la ausencia (`missingSince`)
 * tienen su propia insignia y su propio texto en la pantalla.
 */
export function bloqueoDeMeta(t: {
  status: string;
  metaStatus: string | null;
}): { etiqueta: string; explicacion: string } | null {
  // Solo se habla del bloqueo de Meta cuando el ciclo de aprobación ya se
  // completó: en un borrador o una rechazada, `metaStatus` no es la noticia.
  if (t.status !== "approved") return null;
  if (t.metaStatus === "APPROVED") return null;

  switch (t.metaStatus) {
    case "PAUSED":
      return {
        etiqueta: "Pausada por Meta",
        explicacion:
          "Meta la pausó por baja calidad: suficientes destinatarios la marcaron como spam o bloquearon tu número. No se puede enviar mientras dure la pausa, que Meta levanta sola tras un periodo sin incidencias. Si vuelve a pasar, reescribe el texto: el problema suele ser el mensaje, no el número.",
      };
    case "DISABLED":
      return {
        etiqueta: "Deshabilitada por Meta",
        explicacion:
          "Meta la deshabilitó tras pausas repetidas. Esto no se revierte: crea una plantilla nueva con otro texto y otro enfoque. Volver a mandar el mismo contenido arriesga la calidad de todo tu número.",
      };
    case "LIMIT_EXCEEDED":
      return {
        etiqueta: "Límite excedido",
        explicacion:
          "Tu cuenta llegó al máximo de plantillas que Meta permite, así que esta no queda utilizable. Borra en el Administrador de WhatsApp alguna que ya no uses y vuelve a sincronizar.",
      };
    case "DELETED":
    case "ARCHIVED":
      return {
        etiqueta: t.metaStatus === "DELETED" ? "Borrada en Meta" : "Archivada en Meta",
        explicacion:
          "Ya no está disponible para enviar en tu cuenta de Meta. La conservamos aquí porque los mensajes que se enviaron con ella la referencian.",
      };
    case null:
      return {
        etiqueta: "Sin confirmar con Meta",
        explicacion:
          "Todavía no hemos podido confirmar con Meta el estado actual de esta plantilla, así que no se envía. Pulsa Sincronizar para consultarlo.",
      };
    default:
      // Un estado que este CRM no conoce. Se dice LITERAL en vez de esconderlo
      // tras un "no disponible": el nombre exacto es lo que permite buscarlo en
      // la documentación de Meta o pegarlo en un reporte.
      return {
        etiqueta: `Bloqueada por Meta (${t.metaStatus})`,
        explicacion:
          "Meta reporta un estado que este CRM todavía no conoce, así que por seguridad no se envía. Revísala en el Administrador de WhatsApp; si el estado es legítimo, repórtalo para que lo modelemos.",
      };
  }
}

/* ============================================================
 * 027 — Componentes de una plantilla creada fuera del CRM
 * ============================================================ */

/** Un componente tal como lo lista Graph. Abierto: Meta añade campos sin avisar. */
export type TemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
  example?: unknown;
  buttons?: TemplateButton[];
  [key: string]: unknown;
};

export type TemplateButton = {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: unknown;
  [key: string]: unknown;
};

export type AnalisisDePlantilla = {
  /**
   * Lo que lleva además del cuerpo, para pintarlo: «Encabezado: imagen · Pie
   * de página · 2 botones». null cuando es solo cuerpo.
   */
  extras: string | null;
  /**
   * Por qué el CRM no puede rellenarla al enviar; null si sí puede. Se dice
   * en concreto (qué componente y qué le falta) porque la salida es crear
   * una versión solo de texto o mandarla desde el Administrador de WhatsApp.
   */
  requisito: string | null;
};

const FORMATOS_DE_ENCABEZADO: Record<string, string> = {
  TEXT: "texto",
  IMAGE: "imagen",
  VIDEO: "video",
  DOCUMENT: "documento",
  LOCATION: "ubicación",
};

/**
 * Qué tiene la plantilla y qué le impide al CRM enviarla.
 *
 * El CRM manda UN componente al enviar: el cuerpo, con parámetros
 * posicionales. Meta exige además un parámetro por cada cosa dinámica del
 * resto —el medio del encabezado, la variable de un botón de enlace, el
 * código de un botón de copiar— y responde 132000/132012 si falta. Mejor
 * decirlo aquí, con nombre, que dejar que el envío falle con un código.
 *
 * Lo estático (encabezado de texto sin variable, pie, botones de respuesta
 * rápida o de teléfono) no necesita parámetros: Meta lo rellena solo.
 */
export function analizarComponentes(
  components: TemplateComponent[] | null | undefined,
  body: string
): AnalisisDePlantilla {
  const extras: string[] = [];
  const requisitos: string[] = [];

  const nombradas = [...body.matchAll(NAMED_VARIABLE_REGEX)].map((m) => m[1]!);
  if (nombradas.length > 0) {
    const unicas = [...new Set(nombradas)];
    requisitos.push(
      `usa variables con nombre (${unicas.map((n) => `{{${n}}}`).join(", ")}) y el CRM solo rellena las numeradas {{1}}, {{2}}…`
    );
  }

  for (const c of components ?? []) {
    const tipo = (c.type ?? "").toUpperCase();
    if (tipo === "HEADER") {
      const formato = (c.format ?? "TEXT").toUpperCase();
      extras.push(`Encabezado: ${FORMATOS_DE_ENCABEZADO[formato] ?? formato.toLowerCase()}`);
      if (formato === "TEXT") {
        if (/\{\{[^}]+\}\}/.test(c.text ?? "")) {
          requisitos.push("el encabezado lleva una variable que hay que rellenar en cada envío");
        }
      } else {
        requisitos.push(
          `el encabezado es ${FORMATOS_DE_ENCABEZADO[formato] ?? "multimedia"} y hay que adjuntarlo en cada envío`
        );
      }
    } else if (tipo === "FOOTER") {
      extras.push("Pie de página");
    } else if (tipo === "BUTTONS") {
      const botones = c.buttons ?? [];
      extras.push(botones.length === 1 ? "1 botón" : `${botones.length} botones`);
      for (const b of botones) {
        const tb = (b.type ?? "").toUpperCase();
        if (tb === "QUICK_REPLY" || tb === "PHONE_NUMBER") continue;
        if (tb === "URL") {
          if (/\{\{[^}]+\}\}/.test(b.url ?? "")) {
            requisitos.push(`el botón «${b.text ?? "enlace"}» lleva un enlace con variable`);
          }
          continue;
        }
        requisitos.push(
          `el botón «${b.text ?? tb.toLowerCase()}» (${tb}) exige un parámetro en cada envío`
        );
      }
    } else if (tipo && tipo !== "BODY") {
      // CAROUSEL, LIMITED_TIME_OFFER… lo que Meta añada: se nombra y bloquea.
      extras.push(tipo.toLowerCase().replace(/_/g, " "));
      requisitos.push(`lleva un componente ${tipo} que el CRM todavía no sabe enviar`);
    }
  }

  return {
    extras: extras.length > 0 ? extras.join(" · ") : null,
    requisito:
      requisitos.length > 0
        ? `El CRM todavía no puede enviarla: ${requisitos.join("; ")}. Mándala desde el Administrador de WhatsApp o crea una versión solo de texto.`
        : null,
  };
}
