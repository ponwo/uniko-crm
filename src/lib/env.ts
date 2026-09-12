import { z } from "zod";
import { parseInventarioFlag } from "@/server/inventario/flag";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  // 014/017: canales encendidos, separados por coma. WhatsApp siempre esta on.
  // Ej.: CHANNELS=whatsapp,instagram,messenger. Sin ella, la instancia es solo
  // WhatsApp y las superficies de los demas canales responden 404.
  CHANNELS: z.string().optional(),
  // 015: motor de agenda. Apagado por defecto — sin el, toda la superficie de
  // agenda responde 404 y la UI no la menciona. Ej.: AGENDA=on
  AGENDA: z.string().optional(),
  // 020: notificaciones push cuando el agente escala. Apagadas por defecto
  // (ADR-003): Web Push se entrega por FCM/APNs, que es un tercero en runtime,
  // y el Principio II solo lo permite como conector opcional. Sin esta
  // variable, la instancia no registra manejador de push, no pide permiso, no
  // genera claves y sus rutas responden 404. Ej.: PUSH=on
  PUSH: z.string().optional(),
  // 020: a donde se mandan los avisos. Vacia en produccion (se usa el endpoint
  // que dio el navegador); en pruebas apunta al mock de esta misma app.
  PUSH_SERVICE_BASE_URL: z.string().optional(),
  // 016: atribucion de anuncios y reporte a la Conversions API de Meta.
  // Apagada por defecto: sin ella no se captura de que anuncio vino una
  // conversacion, no se le reporta nada a Meta y la superficie da 404.
  // Ej.: ATRIBUCION=on
  ATRIBUCION: z.string().optional(),
  // 026: conector de inventario (MS-Stock, repo hermano). Apagado por defecto:
  // sin `INVENTARIO` no hay botón, ni acción del agente, ni pestaña, y las tres
  // `STOCK_*` ni se leen. Encendido, las tres son OBLIGATORIAS (ver el
  // superRefine de abajo): una instancia con la bandera y sin llave no arranca
  // a medias, igual que con DATABASE_URL inválida. Ej.: INVENTARIO=on
  INVENTARIO: z.string().optional(),
  // Origen público de la instancia de MS-Stock, sin barra final (es el `aud`
  // del pase SSO y MS-Stock lo compara exacto con su APP_BASE_URL). En el
  // self-test apunta al stock-mock de esta misma app.
  STOCK_BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ""))
    .optional(),
  // Llave de esa instancia (X-API-Key de su API). Solo la usa el servidor. El
  // mínimo de 32 se exige en el superRefine, solo con la bandera encendida:
  // apagada, estas variables ni se leen.
  STOCK_API_KEY: z.string().optional(),
  // Secreto compartido con esa instancia para firmar el pase del botón
  // "Inventario" (= UNIKO_SSO_SECRET allá). Solo el servidor.
  STOCK_SSO_SECRET: z.string().optional(),
  // 015: bases de los conectores. Solo se sobreescriben para apuntar a los
  // mocks en el self-test; en producción se usan las reales.
  ZOOM_BASE_URL: z.string().url().default("https://api.zoom.us/v2"),
  ZOOM_OAUTH_BASE_URL: z.string().url().default("https://zoom.us"),
  GOOGLE_CAL_BASE_URL: z
    .string()
    .url()
    .default("https://www.googleapis.com/calendar/v3"),
  GOOGLE_OAUTH_BASE_URL: z.string().url().default("https://oauth2.googleapis.com"),
  ALLOW_SIGNUP: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  WA_MOCK_ENABLED: z.string().optional(),
  // API key de un cerebro externo que conduzca la conversación por /api/bot/*.
  // Sin ella, toda esa superficie responde 401.
  BOT_API_KEY: z.string().optional(),
  // 008: volumen local de adjuntos (constitución II: sin S3/R2).
  MEDIA_DIR: z.string().default("./.dev-media"),
  NODE_ENV: z.string().default("development"),
});

/**
 * 026 — Con `INVENTARIO` encendida, las tres `STOCK_*` son obligatorias. Va
 * aparte del objeto para que el mensaje nombre la variable exacta que falta:
 * es lo único que quien despliega necesita leer.
 */
const INVENTARIO_REQUIRED = ["STOCK_BASE_URL", "STOCK_API_KEY", "STOCK_SSO_SECRET"] as const;

const envSchemaChecked = envSchema.superRefine((env, ctx) => {
  if (!parseInventarioFlag(env.INVENTARIO)) return;
  for (const key of INVENTARIO_REQUIRED) {
    const value = env[key];
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "obligatoria con INVENTARIO encendida (ver .env.example)",
      });
    } else if (key !== "STOCK_BASE_URL" && value.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "debe tener al menos 32 caracteres (openssl rand -hex 32)",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchemaChecked.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * true si el entorno de pruebas interno (mocks) está habilitado y NO es
 * producción. Vive en `mock-flag.ts` (módulo hoja, apto para el runtime Edge
 * del middleware de la 024); aquí se re-exporta para no mover a nadie.
 */
export { isMockEnabled } from "./mock-flag";

/** true si hay proveedor de IA configurado (token presente y no vacío). */
export function isAiConfigured(): boolean {
  const token = process.env.OPENROUTER_API_TOKEN;
  return typeof token === "string" && token.trim().length > 0;
}
