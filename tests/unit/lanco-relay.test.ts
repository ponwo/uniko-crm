import { describe, expect, it } from "vitest";
import { readRet, relayTarget } from "@/server/dev/lanco-relay";

/**
 * 029 — El algoritmo del relevo (contracts/relevo-lanco-cloud.md §3), en la
 * copia que usa el mock del self-test. El sitio real (`lanco-ws`) implementa
 * el mismo contrato; estos casos son los que ahí se comprueban a mano.
 */

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma`;
}

const FLOTA = ["uniko.negocio.test", "localhost:3000"];

describe("029 — el relevo", () => {
  it("lee `ret` de la carga útil sin clave", () => {
    expect(readRet(jwtWith({ ret: "https://uniko.negocio.test", lnk: "x" }))).toBe(
      "https://uniko.negocio.test"
    );
    expect(readRet("no.es-json.valido")).toBeNull();
    expect(readRet("dos.partes")).toBeNull();
    expect(readRet(null)).toBeNull();
  });

  it("reenvía la consulta COMPLETA y sin tocar al callback de la instancia", () => {
    const state = jwtWith({ ret: "https://uniko.negocio.test" });
    const search = `?code=4%2F0Ab&state=${state}&scope=x`;
    expect(relayTarget(search, FLOTA)).toEqual({
      ok: true,
      target: `https://uniko.negocio.test/api/google/oauth/callback${search}`,
    });
  });

  it("también reenvía cuando Google trae error (lo decide la instancia)", () => {
    const state = jwtWith({ ret: "https://uniko.negocio.test" });
    const out = relayTarget(`?error=access_denied&state=${state}`, FLOTA);
    expect(out.ok).toBe(true);
  });

  it.each([
    ["fuera de la flota", "https://atacante.test"],
    ["sin conexión segura", "http://uniko.negocio.test"],
    ["con ruta colada", "https://uniko.negocio.test/phishing"],
    ["con consulta colada", "https://uniko.negocio.test?x=1"],
    ["que no es URL", "javascript:alert(1)"],
  ])("se niega: %s", (_nombre, ret) => {
    const out = relayTarget(`?code=c&state=${jwtWith({ ret })}`, FLOTA);
    expect(out.ok).toBe(false);
  });

  it("se niega sin state legible", () => {
    expect(relayTarget("?code=c", FLOTA).ok).toBe(false);
    expect(relayTarget("?code=c&state=basura", FLOTA).ok).toBe(false);
  });

  it("en el self-test admite http solo para localhost", () => {
    const out = relayTarget(`?code=c&state=${jwtWith({ ret: "http://localhost:3000" })}`, FLOTA);
    expect(out).toEqual({
      ok: true,
      target: `http://localhost:3000/api/google/oauth/callback?code=c&state=${jwtWith({ ret: "http://localhost:3000" })}`,
    });
  });
});
