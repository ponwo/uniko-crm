/**
 * Borra y recrea la base DESECHABLE de la demo (uniko_demo) y la migra.
 *
 * PARA LA APP antes de correrlo (corta las conexiones y la tira si sigue viva).
 * Se NIEGA con cualquier base que no se llame uniko_demo y con hosts que no
 * sean locales: es destructivo a propósito y solo existe para repetir las
 * escenas de scripts/demo-media.mjs desde cero. Jamás contra uniko_dev ni una
 * instancia de un cliente (Principio I).
 *
 *   DATABASE_URL=postgresql://…/uniko_demo node scripts/demo-reset-db.mjs
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
let u;
try {
  u = new URL(url);
} catch {
  console.error("[demo-reset] DATABASE_URL inválida");
  process.exit(1);
}
const db = u.pathname.replace(/^\//, "");
if (db !== "uniko_demo" || !["localhost", "127.0.0.1"].includes(u.hostname)) {
  console.error(`[demo-reset] NEGADO: solo uniko_demo en localhost (recibí ${db}@${u.hostname}).`);
  process.exit(1);
}

u.pathname = "/postgres";
const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
await sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${db} and pid <> pg_backend_pid()`;
await sql.unsafe(`drop database if exists "${db}"`);
await sql.end();
console.log(`[demo-reset] ${db} borrada`);

const r = spawnSync(process.execPath, ["scripts/dev-db.mjs"], { stdio: "inherit", env: process.env });
if (r.status !== 0) process.exit(r.status ?? 1);

// Postgres de Windows suele traer su zona local; las columnas son «timestamp»
// sin zona y la app las lee como UTC, así que las horas de los mensajes
// nuevos salen desplazadas. En producción (contenedores) ya es UTC: se iguala.
{
  const adm = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await adm.unsafe(`alter database "${db}" set timezone to 'UTC'`);
  await adm.end();
}
console.log("[demo-reset] zona horaria de la base: UTC");

