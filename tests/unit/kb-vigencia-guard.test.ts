import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 033 — Guardarraíl: una sola puerta lee el conocimiento.
 *
 * Con conocimiento que vence, leer `kb_entry` por fuera de
 * `src/server/kb/vigencia.ts` no rompe nada visible: el agente sigue
 * contestando… con una promoción vencida. Este test escanea la RAÍZ `src/` —no
 * una lista de archivos, que deja de proteger en cuanto el código se mueve— y
 * falla si aparece una lectura de la tabla fuera de la puerta.
 *
 * Si estás leyendo esto porque se puso rojo: no lo relajes. Usa
 * `conocimientoVigente()` (lo que puede llegar a un modelo) o
 * `conocimientoCompleto()` (la pantalla del dueño).
 *
 * Las escrituras (`insert`/`update`/`delete`) no cuentan: no leen, así que no
 * pueden afirmar nada vencido.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = path.join("server", "kb", "vigencia.ts");

/** Lecturas de la tabla: `.from(schema.kbEntry)`, `.from(kbEntry)` o `db.query.kbEntry`. */
const LECTURA = /\.from\(\s*(?:schema\.)?kbEntry\s*\)|\bquery\.kbEntry\b/;

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("033 — guardarraíl: una sola puerta lee el conocimiento", () => {
  it("ningún archivo fuera de server/kb/vigencia.ts lee la tabla kb_entry", () => {
    const infractores = archivosTs(SRC)
      .filter((f) => !f.endsWith(PUERTA))
      .filter((f) => LECTURA.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));

    expect(
      infractores,
      "Estos archivos leen el conocimiento sin pasar por la vigencia. Usa " +
        "conocimientoVigente() o conocimientoCompleto() de server/kb/vigencia.ts:\n" +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("la puerta sí lee la tabla (el patrón sigue detectando)", () => {
    // Si esto falla, alguien reescribió la lectura de la puerta con otra forma
    // y el guardarraíl de arriba quedó ciego: ajusta LECTURA, no lo borres.
    expect(LECTURA.test(readFileSync(path.join(SRC, PUERTA), "utf8"))).toBe(true);
  });
});
