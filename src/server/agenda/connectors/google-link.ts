import { createHash, randomBytes } from "node:crypto";
import { desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  clearGoogleTokenCache,
  googleCredentialValues,
  type GoogleCredentialsInput,
} from "@/server/agenda/connectors/google-credentials";

/**
 * 029 — El registro de links de conexión de Google (modelo agencia, ADR-004).
 *
 * Un link es una LLAVE: quien la tenga puede conectar SU calendario y recibir
 * ahí las citas del negocio. Por eso es de un solo uso, vence a las 72 horas,
 * se revoca al generar otro, y aquí vive solo su huella — el link completo se
 * muestra una vez y no se puede reconstruir desde la base.
 *
 * Los cortes de tiempo se deciden en código (`linkState`), con el "ahora" que
 * pasa quien llama: una consulta con `expires_at > now()` en SQL sería
 * invisible para los unitarios (el doble de base ignora el `where`) y no se
 * podría leer un link "de hace tres días" sin esperar tres días.
 */

export const GOOGLE_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/** Una llave emitida aquí mide 43; se acepta un margen para no atarse a él. */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type LinkRow = {
  id: string;
  organizationId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export type LinkState = "pendiente" | "usado" | "revocado" | "vencido";

/**
 * El estado de un link en un instante. USADO y REVOCADO mandan sobre VENCIDO:
 * a quien reabre un link que usó ayer no le sirve oír "venció".
 */
export function linkState(row: LinkRow, now: Date): LinkState {
  if (row.usedAt) return "usado";
  if (row.revokedAt) return "revocado";
  if (row.expiresAt.getTime() <= now.getTime()) return "vencido";
  return "pendiente";
}

export type LinkCheck =
  | { ok: true; link: LinkRow }
  | { ok: false; motivo: "link_invalido" | "link_vencido" | "link_usado" };

/** Traducción del estado a lo que ve quien abre el link. */
export function linkCheckFor(row: LinkRow | null, now: Date): LinkCheck {
  if (!row) return { ok: false, motivo: "link_invalido" };
  switch (linkState(row, now)) {
    case "pendiente":
      return { ok: true, link: row };
    case "usado":
      return { ok: false, motivo: "link_usado" };
    case "vencido":
      return { ok: false, motivo: "link_vencido" };
    // Revocado: para quien lo abre, ya no es un link válido.
    case "revocado":
      return { ok: false, motivo: "link_invalido" };
  }
}

/** Genera un link y revoca los pendientes de la organización (FR-1407). */
export async function issueGoogleLink(input: {
  organizationId: string;
  userId: string | null;
  now: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + GOOGLE_LINK_TTL_MS);
  const db = getDb();
  await db.transaction(async (tx) => {
    // Revocar uno ya vencido es inocuo: por eso este UPDATE no mira el tiempo.
    await tx
      .update(schema.googleLink)
      .set({ revokedAt: input.now })
      .where(
        scoped(
          schema.googleLink.organizationId,
          input.organizationId,
          isNull(schema.googleLink.usedAt),
          isNull(schema.googleLink.revokedAt)
        )
      );
    await tx.insert(schema.googleLink).values({
      id: newId("googleLink"),
      organizationId: input.organizationId,
      tokenHash: hashLinkToken(token),
      createdBy: input.userId,
      expiresAt,
      createdAt: input.now,
    });
  });
  return { token, expiresAt };
}

/** Revoca el link pendiente, si hay. Devuelve cuántos revocó. */
export async function revokeGoogleLinks(
  organizationId: string,
  now: Date
): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.googleLink)
    .set({ revokedAt: now })
    .where(
      scoped(
        schema.googleLink.organizationId,
        organizationId,
        isNull(schema.googleLink.usedAt),
        isNull(schema.googleLink.revokedAt)
      )
    )
    .returning({ id: schema.googleLink.id });
  return rows.length;
}

/** El link vigente, SIN la llave (FR-1408): solo cuándo se creó y vence. */
export async function pendingGoogleLink(
  organizationId: string,
  now: Date
): Promise<{ createdAt: Date; expiresAt: Date } | null> {
  const db = getDb();
  // Generar revoca los anteriores, así que el candidato es el más reciente.
  const rows = await db
    .select({
      id: schema.googleLink.id,
      organizationId: schema.googleLink.organizationId,
      createdAt: schema.googleLink.createdAt,
      expiresAt: schema.googleLink.expiresAt,
      usedAt: schema.googleLink.usedAt,
      revokedAt: schema.googleLink.revokedAt,
    })
    .from(schema.googleLink)
    .where(scoped(schema.googleLink.organizationId, organizationId))
    .orderBy(desc(schema.googleLink.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row || linkState(row, now) !== "pendiente") return null;
  return { createdAt: row.createdAt, expiresAt: row.expiresAt };
}

/**
 * Busca el link por su llave. Es la puerta de entrada de quien NO tiene sesión:
 * todavía no se conoce la organización, así que se resuelve por la huella —
 * igual que el webhook resuelve la suya por `phone_number_id` — y a partir de
 * aquí todo va con `scoped()` sobre la organización de la fila.
 */
export async function findGoogleLink(token: string): Promise<LinkRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: schema.googleLink.id,
      organizationId: schema.googleLink.organizationId,
      expiresAt: schema.googleLink.expiresAt,
      usedAt: schema.googleLink.usedAt,
      revokedAt: schema.googleLink.revokedAt,
    })
    .from(schema.googleLink)
    .where(eq(schema.googleLink.tokenHash, hashLinkToken(token)))
    .limit(1);
  return rows[0] ?? null;
}

/** Relee un link por id dentro de su organización (el `state` lleva los dos). */
export async function getGoogleLink(
  organizationId: string,
  linkId: string
): Promise<LinkRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.googleLink.id,
      organizationId: schema.googleLink.organizationId,
      expiresAt: schema.googleLink.expiresAt,
      usedAt: schema.googleLink.usedAt,
      revokedAt: schema.googleLink.revokedAt,
    })
    .from(schema.googleLink)
    .where(
      scoped(
        schema.googleLink.organizationId,
        organizationId,
        eq(schema.googleLink.id, linkId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type ConsumeResult = "ok" | "link_usado" | "link_invalido";

/**
 * Consume el link y guarda la conexión, TODO O NADA (FR-1416, FR-1419).
 *
 * El `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL RETURNING` es lo
 * que resuelve la carrera de dos pestañas: la segunda no recibe fila y no
 * guarda nada. Si no consumió, se relee la fila para decir la verdad: usado o
 * revocado (un revocado es `link_invalido` en todas partes).
 */
export async function consumeLinkAndSaveCredentials(input: {
  organizationId: string;
  linkId: string;
  creds: GoogleCredentialsInput;
  now: Date;
}): Promise<ConsumeResult> {
  const db = getDb();
  const consumed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.googleLink)
      .set({ usedAt: input.now })
      .where(
        scoped(
          schema.googleLink.organizationId,
          input.organizationId,
          eq(schema.googleLink.id, input.linkId),
          isNull(schema.googleLink.usedAt),
          isNull(schema.googleLink.revokedAt)
        )
      )
      .returning({ id: schema.googleLink.id });
    if (rows.length === 0) return false;

    const values = googleCredentialValues(input.creds);
    await tx
      .insert(schema.googleCredentials)
      .values({
        id: newId("googleCredentials"),
        organizationId: input.organizationId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [schema.googleCredentials.organizationId],
        set: { ...values, updatedAt: input.now },
      });
    return true;
  });

  if (consumed) {
    clearGoogleTokenCache();
    return "ok";
  }
  const row = await getGoogleLink(input.organizationId, input.linkId);
  return row?.revokedAt && !row.usedAt ? "link_invalido" : "link_usado";
}
