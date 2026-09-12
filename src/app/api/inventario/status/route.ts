import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getProduct, health } from "@/server/inventario/client";
import { inventarioDisabledResponse, inventarioEnabled } from "@/server/inventario/flag";

export const dynamic = "force-dynamic";

export type InventarioStatus = "connected" | "unauthorized" | "unavailable";

/**
 * 026 — "Probar conexión" de Ajustes → Inventario (FR-1115).
 *
 * Dos sondas, en orden: `/health` (sin llave: ¿el servicio y su base están
 * arriba?) y un producto que no existe CON la llave: MS-Stock responde 404
 * solo después de aceptar la llave y consultar su base, así que un 404 es la
 * prueba más barata de que todo el camino funciona. Nunca devuelve la llave ni
 * el secreto; el diagnóstico del SSO (secretos distintos) no se puede hacer
 * desde aquí y la pantalla lo explica.
 */
export const GET = withAuth(async () => {
  if (!inventarioEnabled()) return inventarioDisabledResponse();
  const baseUrl = getEnv().STOCK_BASE_URL ?? "";
  const status = await probe();
  return Response.json({ baseUrl, status });
});

async function probe(): Promise<InventarioStatus> {
  const alive = await health();
  if (!alive.ok) return "unavailable";
  const withKey = await getProduct("UNIKO-STATUS-PROBE");
  if (withKey.ok) return "connected"; // improbable, pero significa lo mismo
  switch (withKey.error) {
    case "not_found":
      return "connected";
    case "unauthorized":
      return "unauthorized";
    default:
      return "unavailable";
  }
}
