import type { Branding } from "@/lib/branding";
import {
  BRAND_CYAN,
  BRAND_CYAN_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isUnikoName,
} from "@/lib/brand";
import { faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";

/**
 * El trazo de la marca: la "u" caligráfica con remate cian de Uniko.
 * El cuerpo hereda `currentColor`; píntalo con `text-brand` (o blanco sobre el
 * mosaico) y el remate sigue siendo cian.
 */
export function BrandMark({
  className,
  cyan = BRAND_CYAN,
}: {
  className?: string;
  cyan?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d={BRAND_MARK_BODY}
        stroke="currentColor"
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={BRAND_MARK_TAIL}
        stroke={cyan}
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Mosaico cuadrado con degradado del acento: es el favicon en grande. Con la
 * marca Uniko lleva la "u"; con un nombre white-label, la inicial.
 *
 * Esta rama tiene que decidir lo mismo que `generatedFaviconSvg`: la pestaña y
 * la barra se miran a la vez, y verlas discrepar es justo lo que hace dudar de
 * si el despliegue tomó la marca nueva.
 */
export function BrandTile({
  branding,
  className,
  size = "md",
}: {
  branding: Pick<Branding, "name">;
  className?: string;
  size?: keyof typeof MARK_SIZE;
}) {
  return (
    <span
      className={cn(
        "brand-tile flex shrink-0 items-center justify-center text-brand-fg",
        className
      )}
      aria-hidden
    >
      {isUnikoName(branding.name) ? (
        // El cian del mosaico y no el de fondo claro: sobre el azul, el otro
        // se hunde y el remate deja de leerse.
        <BrandMark className={MARK_SIZE[size]} cyan={BRAND_CYAN_ON_TILE} />
      ) : (
        <span className="font-bold leading-none">{faviconInitial(branding.name)}</span>
      )}
    </span>
  );
}

const WORDMARK_SIZE = {
  md: "text-[21px]",
  lg: "text-[30px]",
} as const;

const MARK_SIZE = {
  md: "h-[24px] w-[24px]",
  lg: "h-[34px] w-[34px]",
} as const;

const TILE_SIZE = {
  md: "h-[30px] w-[30px] rounded-[9px] text-[15px]",
  lg: "h-[44px] w-[44px] rounded-[13px] text-[22px]",
} as const;

/**
 * La marca completa de Uniko CRM: mosaico con inicial + wordmark
 * "uniko" en minúsculas y apretado. Una instancia rebautizada ve en su
 * lugar el mosaico con su propia inicial y su nombre (white-label).
 */
export function BrandLogo({
  branding,
  size = "md",
  className,
}: {
  branding: Pick<Branding, "name">;
  size?: keyof typeof WORDMARK_SIZE;
  className?: string;
}) {
  if (isUnikoName(branding.name)) {
    return (
      <span className={cn("flex items-center gap-2.5 text-foreground", className)}>
        <BrandTile branding={branding} className={TILE_SIZE[size]} size={size} />
        <span
          className={cn(
            "font-[800] leading-none tracking-[-0.045em]",
            WORDMARK_SIZE[size]
          )}
        >
          uniko
        </span>
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandTile branding={branding} className={TILE_SIZE[size]} />
      <span
        className={cn(
          "truncate font-[750] leading-none tracking-tight",
          size === "lg" ? "text-[26px]" : "text-[17px]"
        )}
      >
        {branding.name}
      </span>
    </span>
  );
}
