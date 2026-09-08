import { createSign } from "node:crypto";
import { clavePrivadaParaFirmar, type ClavesVapid } from "@/server/push/claves";

/**
 * La firma VAPID: un JWT ES256 que prueba al servicio de entrega que el aviso
 * sale de quien dice.
 *
 * Se hace a mano porque `node:crypto` ya trae todo y el único trozo incómodo
 * —convertir la firma de DER a R‖S— son treinta líneas. Ver research R2.
 */

/** Cuánto vale la firma. 12 h: el estándar tolera hasta 24, y menos es más sano. */
const VIGENCIA_S = 12 * 60 * 60;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * ECDSA en DER viene como SEQUENCE de dos enteros de longitud variable, con
 * ceros por delante si el byte alto está puesto. JWS quiere **exactamente** 64
 * bytes: R y S de 32, rellenados por la izquierda. Sin esta conversión, el
 * servicio de entrega rechaza la firma sin decir por qué.
 */
export function derARaw(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error("Firma DER inesperada");
  let offset = der[1] === 0x81 ? 3 : 2;

  const leer = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("Entero DER inesperado");
    const largo = der[offset + 1] ?? 0;
    const inicio = offset + 2;
    offset = inicio + largo;
    let valor = der.subarray(inicio, inicio + largo);
    // Quitar el 0x00 de signo, o rellenar hasta 32.
    while (valor.length > 32 && valor[0] === 0x00) valor = valor.subarray(1);
    if (valor.length < 32) {
      valor = Buffer.concat([Buffer.alloc(32 - valor.length, 0), valor]);
    }
    return valor;
  };

  const r = leer();
  const s = leer();
  return Buffer.concat([r, s]);
}

/**
 * El JWT que va en la cabecera `Authorization` del envío.
 *
 * `aud` es el ORIGEN del endpoint, no el endpoint entero: es lo que pide el
 * estándar, y mandarlo completo hace que el servicio rechace sin explicar nada.
 */
export function firmarVapid(input: {
  endpoint: string;
  claves: ClavesVapid;
  /** Contacto del emisor. `mailto:` o una URL; nadie lo lee salvo si algo va mal. */
  sujeto: string;
  ahoraMs?: number;
}): string {
  const aud = new URL(input.endpoint).origin;
  const exp = Math.floor((input.ahoraMs ?? Date.now()) / 1000) + VIGENCIA_S;

  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(JSON.stringify({ aud, exp, sub: input.sujeto }));
  const firmable = `${header}.${payload}`;

  const der = createSign("SHA256")
    .update(firmable)
    .sign(clavePrivadaParaFirmar(input.claves));

  return `${firmable}.${b64url(derARaw(der))}`;
}

/** Las cabeceras del envío. El cuerpo va vacío: ver el contrato. */
export function cabecerasDeEnvio(input: {
  endpoint: string;
  claves: ClavesVapid;
  sujeto: string;
  /** Segundos que el servicio guarda el aviso si el teléfono está apagado. */
  ttl?: number;
}): Record<string, string> {
  return {
    Authorization: `vapid t=${firmarVapid(input)}, k=${input.claves.publicKey}`,
    TTL: String(input.ttl ?? 3600),
    // Sin cuerpo no hay content-type ni content-encoding que declarar: el
    // aviso es opaco a propósito (FR-505).
    Urgency: "high",
  };
}
