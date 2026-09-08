import { notFound } from "next/navigation";
import { AvisosCard } from "@/components/settings/avisos-card";
import { pushEnabled } from "@/server/push/flag";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Avisos. **Solo existe con la bandera `PUSH` encendida** (FR-518):
 * en una instancia sin ella, esta ruta responde 404 como cualquier otra que no
 * exista. No hay pestaña, no hay pantalla y no hay nada que explicar.
 */
export default function AvisosSettingsPage() {
  if (!pushEnabled()) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <AvisosCard />
    </div>
  );
}
