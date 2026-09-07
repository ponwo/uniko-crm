"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Smartphone, Trash2 } from "lucide-react";
import type { Branding } from "@/lib/branding";
import {
  faviconHref,
  FAVICON_MIMES,
  MAX_FAVICON_BYTES,
} from "@/lib/favicon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * El icono de la pestaña.
 *
 * Se muestra SIEMPRE una vista previa: sin logo subido, la del icono generado
 * con la inicial y el acento. Así queda claro que la instancia ya tiene uno y
 * que subir algo es reemplazarlo, no estrenarlo.
 */
export function FaviconCard({
  branding,
  iconoInstalable,
}: {
  branding: Branding;
  /**
   * 019 — ¿el icono actual sirve para la app instalada? Lo calcula el servidor
   * mirando los bytes (PNG, cuadrado, ≥512). Si no sirve, la app se instala
   * igual: lleva el logo de Uniko hasta que el dueño suba uno que valga.
   */
  iconoInstalable: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cambia con cada carga para que la vista previa no se quede con la anterior.
  const [rev, setRev] = useState(0);
  const [actual, setActual] = useState(branding.favicon);

  const src = `${faviconHref({ ...branding, favicon: actual })}&r=${rev}`;

  async function subir(file: File) {
    setError(null);
    if (file.size > MAX_FAVICON_BYTES) {
      setError(
        `El icono no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB.`
      );
      return;
    }
    setSubiendo(true);
    const res = await fetch("/api/settings/branding/favicon", {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo subir el icono");
      return;
    }
    const data = (await res.json()) as { favicon: Branding["favicon"] };
    setActual(data.favicon);
    setRev((v) => v + 1);
    router.refresh(); // el layout raíz vuelve a emitir el <link rel="icon">
  }

  async function quitar() {
    setError(null);
    setSubiendo(true);
    const res = await fetch("/api/settings/branding/favicon", {
      method: "DELETE",
    }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      setError("No se pudo quitar el icono");
      return;
    }
    setActual(null);
    setRev((v) => v + 1);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Icono de la pestaña</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          {/* Sin next/image a propósito: es un archivo servido por una ruta
              propia, de 64 px y ya optimizado. Pasarlo por el optimizador
              sería trabajo de servidor para no ahorrar nada. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Vista previa del icono de la pestaña"
            width={48}
            height={48}
            className="h-12 w-12 rounded-lg border bg-card object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {actual ? "Logo propio" : "Generado con tu marca"}
            </p>
            <p className="mt-0.5 text-xs text-text-3">
              {actual
                ? "Reemplaza al generado. Puedes quitarlo para volver a él."
                : "La inicial sobre tu color de acento. Sube un logo para reemplazarlo."}
            </p>
          </div>
        </div>

        <input
          ref={input}
          type="file"
          accept={FAVICON_MIMES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Se limpia el valor para que subir el MISMO archivo dos veces
            // vuelva a disparar el evento.
            e.target.value = "";
            if (f) void subir(f);
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={subiendo}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="h-4 w-4" />
            {subiendo ? "Subiendo…" : actual ? "Cambiar logo" : "Subir logo"}
          </Button>
          {actual && (
            <Button variant="ghost" disabled={subiendo} onClick={() => void quitar()}>
              <Trash2 className="h-4 w-4" /> Quitar
            </Button>
          )}
        </div>

        <p className="text-xs text-text-3">
          PNG, SVG, ICO, JPEG o WebP, hasta{" "}
          {Math.round(MAX_FAVICON_BYTES / 1024)} KB. Cuadrado se ve mejor.
        </p>

        {/*
          019 — El icono de la pestaña y el de la app instalada no piden lo
          mismo: la pantalla de inicio de un teléfono necesita PNG grande. Esto
          NO es un error y no bloquea nada; la app se instala igual. Solo dice
          qué falta para que lleve el logo del negocio en vez del de Uniko.
        */}
        {!iconoInstalable && (
          <p
            data-testid="icono-no-instalable"
            className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs leading-relaxed text-text-2"
          >
            <Smartphone aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              En un teléfono, la app instalada usará el logo de Uniko: el icono
              actual no sirve para la pantalla de inicio.{" "}
              <b>Sube un PNG cuadrado de 512×512 o más</b> y pasará a ser el
              tuyo, sin reinstalar nada.
            </span>
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
