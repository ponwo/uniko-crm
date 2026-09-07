import { DEFAULT_BRANDING } from "@/lib/branding";
import { faviconCacheKey } from "@/lib/favicon";
import { construirManifiesto } from "@/lib/manifest";
import { getBrandingContext, iconoInstalableDelNegocio } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * El manifiesto de la aplicación, con la marca de ESTA instancia.
 *
 * Ruta dinámica y no archivo en `public/` porque una sola imagen sirve a toda la
 * flota: un manifiesto congelado en el build pondría el nombre y el color de
 * Uniko en las tres instancias, o exigiría una imagen por cliente — que es justo
 * lo que el white-label existe para evitar.
 *
 * **Pública**, como el favicon: el navegador la pide antes de que nadie haya
 * iniciado sesión. En una instancia de un solo negocio, su nombre y su color no
 * son un secreto.
 *
 * Contrato:
 * [contracts/manifest.md](../../../../../specs/019-pwa-instalable/contracts/manifest.md)
 */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");

  const ctx = await getBrandingContext().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  const propio = ctx
    ? await iconoInstalableDelNegocio(ctx.organizationId, branding)
    : null;

  const manifiesto = construirManifiesto({
    branding,
    iconoDelNegocioSirve: propio !== null,
    version: faviconCacheKey(branding),
  });

  return new Response(JSON.stringify(manifiesto, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": cacheable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60",
    },
  });
}
