import { cabecerasDeEnvio } from "@/server/push/vapid";
import type { ClavesVapid } from "@/server/push/claves";

/**
 * El adaptador: lo único que habla Web Push.
 *
 * Contrato en
 * [contracts/push.md](../../../specs/020-notificaciones-push/contracts/push.md).
 * El dominio no lo llama directamente: llama a `avisar.ts`.
 */

export type ResultadoEnvio = "entregada" | "caducada" | "fallo";

/** Cuánto se espera a un servicio que no contesta. */
const TIMEOUT_MS = 8000;

/**
 * A dónde van los envíos. En producción, al `endpoint` que dio el navegador.
 * En pruebas, al mock — que es una ruta de esta misma app tras `dev-guard`.
 *
 * Se resuelve por variable y no por parámetro para que ni el dominio ni las
 * rutas tengan que saber que existe un mock.
 */
function destino(endpoint: string): string {
  const base = process.env.PUSH_SERVICE_BASE_URL;
  if (!base) return endpoint;
  // El mock recibe el endpoint entero como parámetro: así puede responder
  // distinto según cuál sea (410 para el caducado, 500 para el que falla…).
  return `${base}?endpoint=${encodeURIComponent(endpoint)}`;
}

/**
 * Manda UN aviso, sin contenido.
 *
 * **El cuerpo va vacío a propósito** (FR-505): ningún dato del negocio ni de sus
 * clientes atraviesa a Google o Apple. El detalle lo pide el service worker a su
 * propia instancia. Ver el ADR-003 y la spec.
 *
 * **No reintenta.** Decisión de producto: un aviso que insiste convierte una
 * herramienta de trabajo en una alarma.
 */
export async function enviarAviso(input: {
  endpoint: string;
  claves: ClavesVapid;
  sujeto: string;
}): Promise<ResultadoEnvio> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(destino(input.endpoint), {
      method: "POST",
      headers: cabecerasDeEnvio({
        endpoint: input.endpoint,
        claves: input.claves,
        sujeto: input.sujeto,
      }),
      signal: control.signal,
    });

    // 404 y 410 significan lo mismo para nosotros: ese teléfono ya no está.
    if (res.status === 404 || res.status === 410) return "caducada";
    if (res.ok) return "entregada";
    return "fallo";
  } catch {
    // Red caída, DNS, tiempo agotado. Nunca propaga: la escalación ya ocurrió.
    return "fallo";
  } finally {
    clearTimeout(reloj);
  }
}
