/**
 * Prepara la base de datos de DESARROLLO: la crea si no existe y aplica las
 * migraciones.
 *
 * Uso:  pnpm db:dev
 *
 * Idempotente: correrlo dos veces no rompe nada. Si la base ya existe, se salta
 * la creación; si las migraciones ya están aplicadas, drizzle no repite.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * `scripts/migrate.mjs` aplica migraciones pero da por hecho que la base ya
 * está creada: en producción la crea la plataforma de hosting al aprovisionar
 * el Postgres. En local no hay nadie que lo haga, y ese hueco es parte de por
 * qué levantar el proyecto en una máquina nueva no estaba escrito.
 *
 * ── Guardarraíl ─────────────────────────────────────────────────────────────
 * Se NIEGA a tocar nada que no sea local. Esta base es desechable y de
 * desarrollo; apuntar el ciclo de desarrollo a datos de un cliente sería una
 * violación del Principio I, y una equivocación de una línea en `.env` basta
 * para provocarla. Más vale que falle aquí.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

/** Lee DATABASE_URL del entorno o de `.env`, igual que hace drizzle.config.ts. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {
    /* sin .env */
  }
  return "";
}

const url = databaseUrl();
if (!url) {
  console.error(
    "[db:dev] No hay DATABASE_URL. Copia .env.example a .env y rellénalo.\n" +
      "         Guía: docs/desarrollo-local.md"
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error(`[db:dev] DATABASE_URL no es una URL válida: ${url}`);
  process.exit(1);
}

// ── El guardarraíl ──────────────────────────────────────────────────────────
const LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!LOCALES.has(parsed.hostname)) {
  console.error(
    `[db:dev] NEGADO: DATABASE_URL apunta a "${parsed.hostname}", que no es local.\n\n` +
      "  Este script crea bases y aplica migraciones. Correrlo contra una\n" +
      "  instancia real sería tocar datos de un cliente desde el ciclo de\n" +
      "  desarrollo (Principio I). Si de verdad quieres migrar una instancia,\n" +
      "  eso se hace al arrancar su contenedor, no desde aquí.\n\n" +
      "  Para desarrollo local, DATABASE_URL debe apuntar a localhost."
  );
  process.exit(1);
}

const dbName = parsed.pathname.replace(/^\//, "");
if (!dbName) {
  console.error("[db:dev] DATABASE_URL no nombra una base de datos.");
  process.exit(1);
}

// Conexión a la base `postgres` (siempre existe) para poder crear la nuestra.
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

console.log(`[db:dev] Base objetivo: ${dbName} en ${parsed.hostname}`);

const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
try {
  const existe = await admin`
    select 1 from pg_database where datname = ${dbName}
  `;
  if (existe.length > 0) {
    console.log(`[db:dev] La base "${dbName}" ya existe.`);
  } else {
    // El nombre no puede ir parametrizado en un CREATE DATABASE; se valida
    // antes para no construir SQL con texto arbitrario.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
      console.error(
        `[db:dev] Nombre de base no admitido: "${dbName}". Usa letras, dígitos y guion bajo.`
      );
      process.exit(1);
    }
    await admin.unsafe(`create database "${dbName}"`);
    console.log(`[db:dev] Base "${dbName}" creada.`);
  }
} catch (err) {
  console.error(
    `[db:dev] No se pudo preparar la base: ${err instanceof Error ? err.message : err}\n\n` +
      "  ¿Está PostgreSQL corriendo y la contraseña de DATABASE_URL es la correcta?\n" +
      "  Guía: docs/desarrollo-local.md"
  );
  process.exit(1);
} finally {
  await admin.end({ timeout: 5 });
}

// Migraciones: se delega en el mismo script que corre al arrancar el
// contenedor, para que local y producción apliquen exactamente lo mismo.
//
// `MIGRATIONS_DIR` hay que pasarlo: por defecto `migrate.mjs` busca la carpeta
// `drizzle/` JUNTO A SÍ MISMO, que es correcto dentro de la imagen (ahí queda
// bundleado en la raíz, con las migraciones al lado) pero no desde `scripts/`
// en el repo, donde apuntaría a `scripts/drizzle`.
console.log("[db:dev] Aplicando migraciones…");
const res = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, MIGRATIONS_DIR: "drizzle" },
});
process.exit(res.status ?? 1);
