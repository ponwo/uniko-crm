import { readFile } from "node:fs/promises";
import path from "node:path";
import { getBrandingContext, iconoInstalableDelNegocio } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * El icono de la app instalada. **Ruta pública**, como el favicon: el
 * manifiesto se pide antes de que nadie haya iniciado sesión.
 *
 * Siempre PNG. Devuelve el icono del negocio si sirve para instalar (PNG,
 * cuadrado, ≥512), y si no el de fábrica que viaja en la imagen. Nunca falla:
 * un 404 aquí dejaría la app instalada sin icono, y en iOS eso significa que el
 * sistema usa una captura de la página.
 *
 * Contrato:
 * [contracts/manifest.md](../../../../../specs/019-pwa-instalable/contracts/manifest.md)
 */

const MEDIDAS_DE_FABRICA = [192, 512] as const;
type MedidaDeFabrica = (typeof MEDIDAS_DE_FABRICA)[number];

function medidaPedida(url: URL): MedidaDeFabrica {
  const crudo = Number(url.searchParams.get("size"));
  return MEDIDAS_DE_FABRICA.includes(crudo as MedidaDeFabrica)
    ? (crudo as MedidaDeFabrica)
    : 512;
}

function cabeceras(cacheable: boolean): HeadersInit {
  return {
    "content-type": "image/png",
    // Misma defensa que el favicon: nada que ejecutar y sin reinterpretar tipo.
    "content-security-policy": "default-src 'none'",
    "x-content-type-options": "nosniff",
    // La URL lleva `?v=` y cambia con la marca, así que se puede cachear fuerte.
    "cache-control": cacheable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=60",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cacheable = url.searchParams.has("v");

  const ctx = await getBrandingContext().catch(() => null);
  if (ctx) {
    const propio = await iconoInstalableDelNegocio(
      ctx.organizationId,
      ctx.branding
    );
    if (propio) {
      return new Response(new Uint8Array(propio), { headers: cabeceras(cacheable) });
    }
  }

  // De fábrica. Vive en `public/`, que el Dockerfile copia al runner: no
  // depende ni de la base de datos ni del volumen de medios, y por eso una
  // instancia recién desplegada y sin marca ya es instalable.
  const archivo = path.join(
    process.cwd(),
    "public",
    `icon-${medidaPedida(url)}.png`
  );
  const bytes = new Uint8Array(await readFile(archivo));
  return new Response(bytes, { headers: cabeceras(cacheable) });
}
