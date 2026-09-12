"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

const TABS: Tab[] = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/templates", label: "Plantillas" },
  { href: "/settings/team", label: "Equipo" },
];

/** 015 — "Agenda" solo existe si esta instancia encendió la bandera. */
const AGENDA_TAB: Tab = { href: "/settings/calendar", label: "Agenda" };

/** 026 — "Inventario" solo con el conector encendido (bandera INVENTARIO). */
const INVENTARIO_TAB: Tab = { href: "/settings/inventario", label: "Inventario" };

/** 016 — Igual con "Anuncios" y la bandera ATRIBUCION. */
const ADS_TAB: Tab = { href: "/settings/ads", label: "Anuncios" };

/** 014/017 — "Instagram" y "Messenger" solo si el canal está encendido con CHANNELS. */
const INSTAGRAM_TAB: Tab = { href: "/settings/instagram", label: "Instagram" };
const MESSENGER_TAB: Tab = { href: "/settings/messenger", label: "Messenger" };

/** 020 — "Avisos" solo si esta instancia encendió la bandera PUSH. */
const AVISOS_TAB: Tab = { href: "/settings/avisos", label: "Avisos" };

export function SettingsNav({
  agenda = false,
  inventario = false,
  atribucion = false,
  instagram = false,
  messenger = false,
  avisos = false,
}: {
  agenda?: boolean;
  inventario?: boolean;
  atribucion?: boolean;
  instagram?: boolean;
  messenger?: boolean;
  avisos?: boolean;
}) {
  const pathname = usePathname();
  // Qué pestañas existen lo decide el servidor y baja por prop: este es un
  // componente de cliente y no puede leer variables de entorno.
  // Instagram y Messenger van junto a WhatsApp: son las conexiones de
  // mensajería, en el orden del catálogo (lib/channels.ts).
  const tabs = [
    ...TABS.slice(0, 1),
    ...(instagram ? [INSTAGRAM_TAB] : []),
    ...(messenger ? [MESSENGER_TAB] : []),
    ...TABS.slice(1),
    ...(agenda ? [AGENDA_TAB] : []),
    ...(inventario ? [INVENTARIO_TAB] : []),
    ...(atribucion ? [ADS_TAB] : []),
    ...(avisos ? [AVISOS_TAB] : []),
  ];
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block shrink-0 whitespace-nowrap rounded-sm px-3 py-2 text-[13.5px] font-semibold transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-text-2 hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
