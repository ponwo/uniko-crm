/**
 * 029 — El algoritmo del relevo de lanco.cloud, para el mock del self-test.
 *
 * Es una copia DELIBERADA de lo que hace `pages/GoogleCalendarCallback.tsx` en
 * el repo `lanco-ws`, escrita contra el mismo contrato
 * (specs/029-google-por-link/contracts/relevo-lanco-cloud.md §3). Existe para
 * que el arnés ejercite el recorrido real —Google → relevo → instancia— sin
 * lanco.cloud. Si el contrato cambia, cambian los dos.
 *
 * La única diferencia con producción: aquí se admite `http:` para `localhost`,
 * porque la instancia del self-test no tiene TLS.
 */

export type RelayDecision =
  | { ok: true; target: string }
  | { ok: false; reason: string };

/** Lee `ret` de la carga útil del JWT, SIN verificar la firma (no hay clave). */
export function readRet(state: string | null): string | null {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    const ret = (payload as { ret?: unknown } | null)?.ret;
    return typeof ret === "string" ? ret : null;
  } catch {
    return null;
  }
}

export function relayTarget(
  search: string,
  allowedHosts: readonly string[]
): RelayDecision {
  const params = new URLSearchParams(search);
  const ret = readRet(params.get("state"));
  if (!ret) return { ok: false, reason: "sin state legible" };

  let url: URL;
  try {
    url = new URL(ret);
  } catch {
    return { ok: false, reason: "ret no es una URL" };
  }
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    return { ok: false, reason: "ret sin conexión segura" };
  }
  // Un origen pelado: sin ruta, consulta ni fragmento que colar.
  if (url.origin !== ret) return { ok: false, reason: "ret no es un origen" };
  if (!allowedHosts.includes(url.host)) return { ok: false, reason: "fuera de la flota" };

  const query = search.startsWith("?") ? search : `?${search}`;
  return { ok: true, target: `${url.origin}/api/google/oauth/callback${query}` };
}
