import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { obtainWabaDataset } from "@/lib/meta/capi";
import { MetaApiError } from "@/lib/meta/client";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * 016 — La conexión del negocio con su dataset de Meta.
 *
 * El token se cifra con el MISMO mecanismo que el de WhatsApp (`lib/crypto`,
 * AES-256-GCM), no con un segundo: dos formas de guardar un secreto es una de
 * más que auditar.
 */

export type CapiSettings = {
  datasetId: string;
  token: string;
  qualifiedStageId: string | null;
  status: "connected" | "error";
};

/** Lo que puede ver el cliente. El token NUNCA sale: solo sus últimos 4. */
export type CapiSettingsView = {
  datasetId: string;
  status: "connected" | "error";
  tokenLast4: string;
  qualifiedStageId: string | null;
};

/**
 * Por qué un ID NO puede ser el del dataset, o null si no se le ve problema.
 *
 * Existe porque el error real fue este: en la pantalla se pegaron, uno tras
 * otro, el ID de la cuenta de WhatsApp, el del número de teléfono y una cadena
 * que no era un ID. Los tres se guardaron sin queja y cada venta reportada
 * después falló en Meta con un 400 opaco ("Object with ID … does not exist").
 * Como cada evento se intenta UNA sola vez, una configuración mala cuesta las
 * conversiones que ocurran mientras dure: hay que pararla al guardar.
 *
 * El camino bueno es no teclearlo: `datasetFromMeta` se lo pide a Meta. Esto
 * es la red para quien lo pega a mano: el dataset de mensajería tiene un ID
 * PROPIO, así que los dos IDs que la conexión de WhatsApp tiene a la vista se
 * descartan sin hablar con nadie.
 */
export function datasetIdProblem(
  datasetId: string,
  whatsapp: { wabaId: string; phoneNumberId: string } | null
): string | null {
  if (!/^\d+$/.test(datasetId)) {
    return "El ID del dataset es solo números: usa «Obtener de Meta»";
  }
  if (whatsapp && datasetId === whatsapp.wabaId) {
    return "Ese es el ID de tu cuenta de WhatsApp, no el de su dataset: usa «Obtener de Meta»";
  }
  if (whatsapp && datasetId === whatsapp.phoneNumberId) {
    return "Ese es el ID de tu número de WhatsApp, no el del dataset: usa «Obtener de Meta»";
  }
  return null;
}

export type DatasetFromMeta =
  | { ok: true; datasetId: string; displayPhoneNumber: string | null }
  | { ok: false; status: number; code: string; message: string };

/** Lo que tarda de más Meta antes de que el botón se rinda. */
const DATASET_TIMEOUT_MS = 20_000;

/**
 * Le pide a Meta el dataset de la cuenta de WhatsApp conectada, con el token
 * que ya está guardado. NO guarda nada: la pantalla lo coloca en el campo y el
 * negocio lo confirma con «Guardar», junto con su etapa de calificado.
 */
export async function datasetFromMeta(
  organizationId: string
): Promise<DatasetFromMeta> {
  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    return {
      ok: false,
      status: 409,
      code: "sin_whatsapp",
      message:
        "Conecta WhatsApp primero: el dataset se le pide a Meta con esa cuenta",
    };
  }
  try {
    const datasetId = await obtainWabaDataset({
      wabaId: credentials.wabaId,
      token: credentials.token,
      signal: AbortSignal.timeout(DATASET_TIMEOUT_MS),
    });
    return {
      ok: true,
      datasetId,
      displayPhoneNumber: credentials.displayPhoneNumber,
    };
  } catch (err) {
    if (err instanceof MetaApiError && (err.status === 0 || err.status >= 500)) {
      return {
        ok: false,
        status: 503,
        code: "meta_no_disponible",
        message: "No se pudo contactar a Meta; intenta de nuevo",
      };
    }
    if (err instanceof MetaApiError) {
      // Lo más probable: el token no tiene `whatsapp_business_management`.
      // Se muestra lo que dijo Meta, tal cual: es lo que hay que corregir.
      return {
        ok: false,
        status: 422,
        code: "meta_rechazo",
        message: `Meta no entregó el dataset: ${err.explanation}`,
      };
    }
    return {
      ok: false,
      status: 502,
      code: "meta_respuesta_inesperada",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getCapiSettings(
  organizationId: string
): Promise<CapiSettings | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.capiSettings)
    .where(scoped(schema.capiSettings.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    datasetId: row.datasetId,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    qualifiedStageId: row.qualifiedStageId,
    status: row.status,
  };
}

export async function getCapiSettingsView(
  organizationId: string
): Promise<CapiSettingsView | null> {
  const settings = await getCapiSettings(organizationId);
  if (!settings) return null;
  return {
    datasetId: settings.datasetId,
    status: settings.status,
    tokenLast4: settings.token.slice(-4),
    qualifiedStageId: settings.qualifiedStageId,
  };
}

export async function saveCapiSettings(input: {
  organizationId: string;
  datasetId: string;
  token: string;
  qualifiedStageId: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  await db
    .insert(schema.capiSettings)
    .values({
      id: newId("capiSettings"),
      organizationId: input.organizationId,
      datasetId: input.datasetId,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      qualifiedStageId: input.qualifiedStageId,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [schema.capiSettings.organizationId],
      set: {
        datasetId: input.datasetId,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        qualifiedStageId: input.qualifiedStageId,
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

export async function deleteCapiSettings(
  organizationId: string
): Promise<void> {
  const db = getDb();
  // Los eventos ya registrados NO se borran: son la bitácora de lo que se le
  // dijo a Meta, y eso no deja de ser cierto porque el negocio desconecte.
  await db
    .delete(schema.capiSettings)
    .where(scoped(schema.capiSettings.organizationId, organizationId));
}

/** ¿Esa etapa es de esta organización? (multi-tenancy: III). */
export async function stageBelongsToOrg(
  organizationId: string,
  stageId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      and(
        eq(schema.pipelineStage.organizationId, organizationId),
        eq(schema.pipelineStage.id, stageId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
