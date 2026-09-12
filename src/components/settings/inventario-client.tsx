"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 026 — Ajustes → Inventario: a qué MS-Stock apunta esta instancia y si la
 * conexión funciona. No hay nada que configurar desde aquí (las variables
 * viven en el despliegue): la pantalla existe para diagnosticar en diez
 * segundos por qué el agente no da existencias o el botón no entra.
 */

type Status = "connected" | "unauthorized" | "unavailable";

const RESULT: Record<Status, { label: string; hint: string; className: string }> = {
  connected: {
    label: "Conectado",
    hint: "El servicio responde y aceptó la llave. El agente puede consultar existencias.",
    className: "bg-success-tint text-success-text",
  },
  unauthorized: {
    label: "Llave rechazada",
    hint: "MS-Stock respondió, pero no aceptó la llave (STOCK_API_KEY). Copia de nuevo la llave de esa instancia.",
    className: "bg-danger-tint text-danger-text",
  },
  unavailable: {
    label: "Servicio no disponible",
    hint: "MS-Stock no respondió a tiempo o su base está caída. El agente contesta sin inventario hasta que vuelva.",
    className: "bg-warning-tint text-warning-text",
  },
};

export function InventarioClient({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [probing, setProbing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function probe() {
    setProbing(true);
    setFailed(false);
    try {
      const res = await fetch("/api/inventario/status", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { status: Status };
      setStatus(data.status);
    } catch {
      setFailed(true);
      setStatus(null);
    } finally {
      setProbing(false);
    }
  }

  const result = status ? RESULT[status] : null;

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Inventario</CardTitle>
          <CardDescription>
            El catálogo y las existencias viven en MS-Stock, un servicio aparte de este
            negocio. Desde aquí solo se comprueba que la conexión funciona.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="kicker block">Instancia de MS-Stock</span>
            <code className="mt-1 block break-all text-[13px]">{baseUrl}</code>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={probe} disabled={probing}>
              {probing ? "Probando…" : "Probar conexión"}
            </Button>
            {result && (
              <span
                role="status"
                className={cn(
                  "rounded-full px-3 py-1 text-[12.5px] font-semibold",
                  result.className
                )}
              >
                {result.label}
              </span>
            )}
            {failed && (
              <span role="status" className="text-[12.5px] text-danger-text">
                No se pudo probar. Intenta de nuevo.
              </span>
            )}
          </div>
          {result && <p className="text-[13px] text-text-2">{result.hint}</p>}

          <p className="text-[12.5px] text-text-3">
            Si aquí dice &quot;Conectado&quot; pero el botón Inventario termina en un
            &quot;enlace no válido&quot;, los secretos del acceso (STOCK_SSO_SECRET aquí y
            UNIKO_SSO_SECRET en MS-Stock) no coinciden. La llave y el secreto viven en el
            despliegue: esta pantalla nunca los muestra.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
