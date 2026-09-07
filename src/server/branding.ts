import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";
import { FAVICON_ASSET } from "@/lib/favicon";
import { iconoSirveParaInstalar } from "@/lib/png";
import { readMediaFile } from "@/server/whatsapp/media";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  const db = getDb();
  const rows = organizationId
    ? await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    : // Sin sesión (login, layout raíz): la única organización de la instancia.
      await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .limit(1);
  if (!rows[0]) return { organizationId: null, branding: DEFAULT_BRANDING };
  const meta = parseMetadata(rows[0].metadata);
  return {
    organizationId: rows[0].id,
    branding: normalizeBranding(
      (meta.branding as Partial<Branding> | undefined) ?? null
    ),
  };
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

/**
 * El icono subido por el negocio, si existe y **sirve para instalar**.
 *
 * Devuelve los bytes para que quien pregunte no tenga que leerlos otra vez: la
 * ruta del icono los necesita para servirlos, y el manifiesto solo necesita
 * saber que están. Leer el archivo dos veces por petición sería tonto.
 *
 * Que "sirva" es exacto y se decide con los bytes (`lib/png`): PNG, cuadrado, y
 * 512 px o más. Si el volumen de medios no está montado —el gotcha clásico de
 * esta flota— esto devuelve `null` y todo cae al icono de fábrica, que vive en
 * la imagen. Es una degradación mejor que la de hoy, no peor.
 */
export async function iconoInstalableDelNegocio(
  organizationId: string | null,
  branding: Branding
): Promise<Buffer | null> {
  if (!organizationId || !branding.favicon) return null;
  if (branding.favicon.mime !== "image/png") return null;
  try {
    const buf = await readMediaFile(organizationId, FAVICON_ASSET);
    return iconoSirveParaInstalar(branding.favicon.mime, new Uint8Array(buf))
      ? buf
      : null;
  } catch {
    // El archivo se perdió (volumen sin montar, restauración a medias).
    return null;
  }
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
