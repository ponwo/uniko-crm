import { BrandingClient } from "@/components/settings/branding-client";
import { FaviconCard } from "@/components/settings/favicon-card";
import { getBranding, iconoInstalableDelNegocio } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // La marca se lee en el servidor para que la tarjeta del icono ya pinte la
  // vista previa correcta en el primer render, sin un parpadeo del generado al
  // subido mientras un fetch del cliente va y vuelve.
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);
  // 019 — ¿el icono actual sirve para la app instalada? Se decide con los bytes
  // del archivo (PNG, cuadrado, ≥512), no con lo que declare nadie.
  const iconoInstalable =
    (await iconoInstalableDelNegocio(
      session?.organizationId ?? null,
      branding
    )) !== null;

  return (
    <div className="max-w-2xl space-y-6">
      <BrandingClient />
      <FaviconCard branding={branding} iconoInstalable={iconoInstalable} />
    </div>
  );
}
