import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_BRANDING } from "@/lib/branding";
import {
  MENSAJES,
  MENSAJE_GENERICO,
  parseMotivo,
} from "@/lib/google-link-motivos";
import { getBranding } from "@/server/branding";
import {
  CALENDAR_COOKIE,
  googleLinkAvailable,
} from "@/server/agenda/connectors/google-oauth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conexión de Google Calendar",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * 029 — Dónde termina el titular del calendario después de Google. PÚBLICA:
 * no tiene sesión en Uniko, y por eso vive fuera del grupo `(app)`.
 *
 * El mensaje se elige por clave de un catálogo cerrado; nada de la dirección
 * se muestra tal cual (FR-1420). El nombre del calendario llega por una cookie
 * de un solo propósito, no por la dirección (FR-1421).
 */
export default async function ConectarGooglePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!googleLinkAvailable()) notFound();

  const params = await searchParams;
  const motivo = parseMotivo(params.estado);
  const mensaje = motivo ? MENSAJES[motivo] : MENSAJE_GENERICO;
  const calendario =
    motivo === "ok" ? (await cookies()).get(CALENDAR_COOKIE)?.value ?? null : null;
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);

  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo branding={branding} size="lg" />
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle
              className={
                mensaje.tono === "ok" ? "text-success-text" : "text-danger-text"
              }
            >
              {mensaje.titulo}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-text-2">
            {calendario && (
              <p>
                Calendario conectado:{" "}
                <strong className="font-semibold text-foreground">{calendario}</strong>
              </p>
            )}
            <p>{mensaje.texto}</p>
            {motivo === "ok" && (
              <p className="text-xs text-text-3">
                Puedes quitar este acceso cuando quieras desde la sección de
                seguridad de tu cuenta de Google (Apps de terceros con acceso a
                tu cuenta).
              </p>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-text-3">{branding.name}</p>
      </div>
    </main>
  );
}
