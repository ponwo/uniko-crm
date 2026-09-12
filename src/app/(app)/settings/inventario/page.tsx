import { notFound } from "next/navigation";
import { InventarioClient } from "@/components/settings/inventario-client";
import { getEnv } from "@/lib/env";
import { inventarioEnabled } from "@/server/inventario/flag";

export const dynamic = "force-dynamic";

export default function InventarioSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!inventarioEnabled()) notFound();
  // Solo la dirección baja al cliente; la llave y el secreto, jamás.
  return <InventarioClient baseUrl={getEnv().STOCK_BASE_URL ?? ""} />;
}
