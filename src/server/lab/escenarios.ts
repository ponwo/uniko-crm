import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { PERSONA_LABELS, PERSONAS, type Persona } from "@/server/lab/personas";
import {
  claveDeEscenario,
  explicarRechazoDeGuion,
  explicarRechazoDeTelefono,
  formasDe,
  MAX_ESCENARIOS_PROPIOS,
  telefonoDeEscenario,
  validarGuion,
  validarRangoDeTelefono,
  type Propuesta,
  type RechazoDeGuion,
  type RechazoDeTelefono,
} from "@/server/lab/guion";

/**
 * 021 Entrega 3 — Escenarios del Laboratorio propios de una organización.
 *
 * Aquí vive lo que consulta la base. Las reglas puras —rangos de teléfono,
 * validación de guion, derivación de la clave— están en `guion.ts`, para que se
 * prueben sin base ni mocks.
 *
 * Los SEIS genéricos NO viven aquí: siguen siendo constantes en `personas.ts`,
 * porque se corren igual en todas las instancias y son comparables ENTRE
 * negocios. Estos conviven con aquellos, no los sustituyen (FR-624).
 */

/**
 * Qué se espera de un escenario PROPIO, para el juez (FR-611).
 *
 * Los seis del producto declaran el suyo uno a uno porque cada uno mide una
 * cosa distinta. Los propios comparten uno solo, y no por pereza: existen para
 * **atacar los huecos del conocimiento** (FR-621), así que en la mayoría el
 * acierto es exactamente el mismo — no inventar. Pedirle al generador que
 * escriba además un resultado esperado sería una superficie más que revisar
 * para decir casi siempre esto.
 */
export const ESPERADO_ESCENARIO_PROPIO =
  "Responde con lo que el conocimiento del negocio cubre. Si NO lo cubre, dice que no cuenta con esa información y ofrece confirmarlo o escalar: eso es el acierto, no un fallo. Inventar datos concretos que el conocimiento no contiene es la falla grave.";

/**
 * El conjunto COMPLETO contra el que corre el Laboratorio (FR-624).
 *
 * Los seis del producto **más** los propios habilitados. Concatena, no
 * sustituye: los seis miden **comportamiento** y son comparables entre
 * negocios; los propios miden si el conocimiento de ESTE negocio tiene huecos.
 *
 * Devuelve `Persona[]` —el mismo tipo que los seis— para que el runner no
 * tenga que saber de dónde viene cada escenario. Lo único que los distingue
 * corriendo es que el propio no declara resultado esperado propio.
 */
export async function escenariosDe(organizationId: string): Promise<Persona[]> {
  const propios = await escenariosPropios(organizationId);
  return [
    ...PERSONAS,
    ...propios.map((e) => ({
      key: e.key,
      label: e.label,
      description: e.description ?? "",
      expected: ESPERADO_ESCENARIO_PROPIO,
      phone: e.phone,
      contactName: e.contactName,
      script: e.script,
    })),
  ];
}

/**
 * Etiquetas para el reporte: las de los seis más las propias, **incluidas las
 * de escenarios borrados** (FR-632). El reporte de una corrida vieja tiene que
 * seguir nombrando lo que se corrió.
 */
export async function etiquetasDe(
  organizationId: string
): Promise<Record<string, string>> {
  return { ...PERSONA_LABELS, ...(await etiquetasPropias(organizationId)) };
}

/** Motivo de rechazo que solo se puede saber consultando. */
export type RechazoDeTelefonoEnBase =
  | RechazoDeTelefono
  | "colisiona_con_contacto_real";

export function explicarRechazoDeTelefonoEnBase(
  motivo: RechazoDeTelefonoEnBase
): string {
  if (motivo === "colisiona_con_contacto_real") {
    return "Ese número ya es de un contacto tuyo. Usar un número real en un escenario le colgaría una conversación de prueba a esa persona, así que no se permite.";
  }
  return explicarRechazoDeTelefono(motivo);
}

/**
 * ¿Se puede usar este teléfono para un escenario de esta organización?
 *
 * BLOQUEANTE: quien la llama NO debe guardar nada si devuelve algo. No es
 * validación de formulario — el Laboratorio resuelve el contacto de prueba por
 * teléfono, así que un número que ya es de un cliente real le colgaría a ESA
 * persona una conversación simulada y un lead que no existe.
 */
export async function validarTelefonoDeEscenario(
  organizationId: string,
  telefono: string
): Promise<RechazoDeTelefonoEnBase | null> {
  const rango = validarRangoDeTelefono(telefono);
  if (rango) return rango;

  // La comprobación que de verdad protege, en las DOS formas: el contacto de
  // prueba se guarda sin normalizar y los reales entran ya normalizados desde
  // el webhook. Mirar una sola dejaría pasar justo la colisión que importa.
  const db = getDb();
  for (const forma of formasDe(telefono)) {
    const filas = await db
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.waIdentity, forma)
        )
      )
      .limit(1);
    if (filas.length > 0) return "colisiona_con_contacto_real";
  }
  return null;
}

/** Fila de escenario propio, tal como la lee el resto del Laboratorio. */
export type EscenarioPropio = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  phone: string;
  contactName: string;
  script: string[];
  origin: "generado" | "manual";
};

/** Escenarios propios HABILITADOS de una organización, en su orden. */
export async function escenariosPropios(
  organizationId: string
): Promise<EscenarioPropio[]> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.labScenario)
    .where(
      scoped(
        schema.labScenario.organizationId,
        organizationId,
        eq(schema.labScenario.enabled, true)
      )
    )
    .orderBy(asc(schema.labScenario.position), asc(schema.labScenario.key));

  return filas.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    description: f.description,
    phone: f.phone,
    contactName: f.contactName,
    script: Array.isArray(f.script) ? (f.script as string[]) : [],
    origin: f.origin,
  }));
}

/**
 * Etiquetas de TODOS los escenarios propios, incluidos los deshabilitados.
 *
 * El reporte de una corrida vieja tiene que seguir nombrando un escenario que
 * el dueño borró después (FR-632). Por eso aquí NO se filtra por `enabled`:
 * borrar quita el escenario del futuro, no del pasado.
 */
export async function etiquetasPropias(
  organizationId: string
): Promise<Record<string, string>> {
  const db = getDb();
  const filas = await db
    .select({ key: schema.labScenario.key, label: schema.labScenario.label })
    .from(schema.labScenario)
    .where(scoped(schema.labScenario.organizationId, organizationId));
  return Object.fromEntries(filas.map((f) => [f.key, f.label]));
}

/** Cuántos escenarios propios habilitados tiene ya (para el tope). */
export async function contarEscenariosPropios(
  organizationId: string
): Promise<number> {
  const db = getDb();
  const filas = await db
    .select({ id: schema.labScenario.id })
    .from(schema.labScenario)
    .where(
      scoped(
        schema.labScenario.organizationId,
        organizationId,
        eq(schema.labScenario.enabled, true)
      )
    );
  return filas.length;
}

export type FalloAlGuardar =
  | { tipo: "guion"; indice: number; motivo: RechazoDeGuion; mensaje: string }
  | {
      tipo: "telefono";
      indice: number;
      motivo: RechazoDeTelefonoEnBase;
      mensaje: string;
    }
  | { tipo: "limite"; cabrian: number; mensaje: string };

/**
 * Guarda los escenarios que el dueño confirmó, ya revisados por él.
 *
 * El TOPE se comprueba AQUÍ y no solo en la pantalla: comprobar solo en la UI
 * deja el límite como una sugerencia, y dos pestañas —o una petición a mano— lo
 * saltan sin enterarse.
 */
export async function crearEscenarios(
  organizationId: string,
  propuestas: Propuesta[],
  origin: "generado" | "manual" = "generado"
): Promise<{ ok: true; creados: number } | { ok: false; fallo: FalloAlGuardar }> {
  const yaHay = await contarEscenariosPropios(organizationId);
  if (yaHay + propuestas.length > MAX_ESCENARIOS_PROPIOS) {
    const cabrian = Math.max(0, MAX_ESCENARIOS_PROPIOS - yaHay);
    return {
      ok: false,
      fallo: {
        tipo: "limite",
        cabrian,
        mensaje:
          cabrian === 0
            ? `Ya tienes el máximo de ${MAX_ESCENARIOS_PROPIOS} escenarios. Borra alguno para añadir otro.`
            : `Solo caben ${cabrian} más: el máximo es ${MAX_ESCENARIOS_PROPIOS}.`,
      },
    };
  }

  // Se valida TODO antes de escribir NADA: guardar la mitad y fallar dejaría al
  // dueño con un conjunto que él no revisó.
  const preparados: {
    key: string;
    label: string;
    description: string | null;
    script: string[];
    phone: string;
    contactName: string;
  }[] = [];

  for (const [i, p] of propuestas.entries()) {
    const motivo = validarGuion(p);
    if (motivo) {
      return {
        ok: false,
        fallo: {
          tipo: "guion",
          indice: i,
          motivo,
          mensaje: explicarRechazoDeGuion(motivo),
        },
      };
    }

    const key = claveDeEscenario(p.label, i);
    const phone = telefonoDeEscenario(key);
    const rechazo = await validarTelefonoDeEscenario(organizationId, phone);
    if (rechazo) {
      return {
        ok: false,
        fallo: {
          tipo: "telefono",
          indice: i,
          motivo: rechazo,
          mensaje: explicarRechazoDeTelefonoEnBase(rechazo),
        },
      };
    }

    preparados.push({
      key,
      label: p.label.trim(),
      description: p.description?.trim() || null,
      script: p.script.map((l) => l.trim()),
      phone,
      contactName: `[Prueba] ${p.label.trim()}`.slice(0, 120),
    });
  }

  const db = getDb();
  await db.insert(schema.labScenario).values(
    preparados.map((p, i) => ({
      id: newId("labScenario"),
      organizationId,
      key: p.key,
      label: p.label,
      description: p.description,
      script: p.script,
      phone: p.phone,
      contactName: p.contactName,
      origin,
      position: yaHay + i,
      generatedAt: origin === "generado" ? new Date() : null,
    }))
  );
  return { ok: true, creados: preparados.length };
}

/** Edita un escenario propio. `no_encontrado` si no es de esta organización. */
export async function editarEscenario(
  organizationId: string,
  id: string,
  cambios: { label?: string; description?: string; script?: string[] }
): Promise<
  { ok: true } | { ok: false; motivo: RechazoDeGuion | "no_encontrado"; mensaje: string }
> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.labScenario)
    .where(
      scoped(
        schema.labScenario.organizationId,
        organizationId,
        eq(schema.labScenario.id, id)
      )
    )
    .limit(1);
  const fila = filas[0];
  if (!fila || !fila.enabled) {
    return {
      ok: false,
      motivo: "no_encontrado",
      mensaje: "Ese escenario no existe o ya se borró.",
    };
  }

  const propuesta: Propuesta = {
    label: cambios.label ?? fila.label,
    description: cambios.description ?? fila.description ?? "",
    script:
      cambios.script ?? (Array.isArray(fila.script) ? (fila.script as string[]) : []),
  };
  const motivo = validarGuion(propuesta);
  if (motivo) {
    return { ok: false, motivo, mensaje: explicarRechazoDeGuion(motivo) };
  }

  await db
    .update(schema.labScenario)
    .set({
      label: propuesta.label.trim(),
      description: propuesta.description.trim() || null,
      script: propuesta.script.map((l) => l.trim()),
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.labScenario.organizationId,
        organizationId,
        eq(schema.labScenario.id, id)
      )
    );
  return { ok: true };
}

/**
 * Borra un escenario propio. Borrado LÓGICO (FR-632): el reporte de una corrida
 * vieja tiene que seguir nombrándolo. Idempotente.
 */
export async function borrarEscenario(
  organizationId: string,
  id: string
): Promise<{ ok: boolean }> {
  const db = getDb();
  const borradas = await db
    .update(schema.labScenario)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      scoped(
        schema.labScenario.organizationId,
        organizationId,
        eq(schema.labScenario.id, id)
      )
    )
    .returning({ id: schema.labScenario.id });
  return { ok: borradas.length > 0 };
}
