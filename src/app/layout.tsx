import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconCacheKey, faviconHref } from "@/lib/favicon";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import "./globals.css";

// Las tres voces de la marca de Uniko. next/font las
// descarga en BUILD y las sirve self-hosted (sin CDN en runtime: soberanía).
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
  // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer. Lo
  // mismo vale para el icono de la app instalada, así que van con la misma.
  const v = faviconCacheKey(branding);
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
    icons: {
      icon: faviconHref(branding),
      // iOS ignora el manifiesto para el icono de la pantalla de inicio: lee
      // esto, y quiere PNG. Sin él usaría una captura de la página.
      apple: `/api/branding/icon?size=192&v=${v}`,
    },
    manifest: `/api/branding/manifest?v=${v}`,
    appleWebApp: {
      capable: true,
      title: branding.name,
      statusBarStyle: "default",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">
        {children}
        {/* Registra el service worker cuando la app ya es usable. No pinta nada. */}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
