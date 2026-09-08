import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * El par de claves VAPID de la instancia.
 *
 * VAPID identifica al emisor de un aviso ante el servicio de entrega: la pública
 * viaja al navegador al suscribirse, y con la privada se firma un JWT en cada
 * envío. **No son credenciales de un tercero**: no hay cuenta de Google ni de
 * Apple que dar de alta. Las genera la instancia (FR-515).
 *
 * Sin librería: `node:crypto` hace P-256 (`prime256v1`), que es la curva que
 * exige Web Push. Traerse `web-push` sería aceptable —es una librería, no un
 * servicio— pero no hace falta, y el repo ya tiene el precedente de leer bytes a
 * mano en vez de añadir dependencia (el IHDR del PNG en la 019).
 */

export type ClavesVapid = {
  /** Base64url, formato "raw" (65 bytes, 0x04 + X + Y): lo que espera el navegador. */
  publicKey: string;
  /** Base64url de la d (32 bytes). Solo sale de aquí para firmar. */
  privateKey: string;
};

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Genera el par en el formato que Web Push espera.
 *
 * El navegador quiere la pública **cruda** (no DER): 65 bytes que empiezan por
 * 0x04. Node la da en DER, y los últimos 65 bytes de esa codificación son
 * exactamente el punto sin comprimir — por eso el corte.
 */
export function generarParVapid(): ClavesVapid {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const derPublica = publicKey.export({ type: "spki", format: "der" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.d) throw new Error("La clave privada generada no trae d");
  return {
    publicKey: base64url(derPublica.subarray(derPublica.length - 65)),
    privateKey: jwk.d,
  };
}

/** Reconstruye la clave de Node para firmar, desde la privada guardada. */
export function clavePrivadaParaFirmar(claves: ClavesVapid) {
  const publica = Buffer.from(claves.publicKey, "base64url");
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: claves.privateKey,
      x: base64url(publica.subarray(1, 33)),
      y: base64url(publica.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/**
 * Las claves de esta organización, generándolas la primera vez.
 *
 * La privada se guarda cifrada con el mismo mecanismo que el token de WhatsApp
 * (AES-256-GCM, `lib/crypto`): no estrena nada.
 *
 * **Cuidado al llamar a esto desde una superficie pública**: devuelve la privada.
 * Para lo único que se necesita fuera del servidor —suscribirse— existe
 * `clavePublicaDeLaOrganizacion()`, que no la toca.
 */
export async function clavesDeLaOrganizacion(
  organizationId: string
): Promise<ClavesVapid> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.pushKey)
    .where(eq(schema.pushKey.organizationId, organizationId))
    .limit(1);

  const fila = filas[0];
  if (fila) {
    return {
      publicKey: fila.publicKey,
      privateKey: decryptSecret({
        cipher: fila.privateCipher,
        iv: fila.privateIv,
        tag: fila.privateTag,
      }),
    };
  }

  const nuevas = generarParVapid();
  const cifrada = encryptSecret(nuevas.privateKey);
  await db.insert(schema.pushKey).values({
    id: newId("pushKey"),
    organizationId,
    publicKey: nuevas.publicKey,
    privateCipher: cifrada.cipher,
    privateIv: cifrada.iv,
    privateTag: cifrada.tag,
  });
  return nuevas;
}

/**
 * Solo la pública, que es lo único que puede salir al navegador.
 *
 * Existe aparte a propósito: quien solo necesita suscribir un teléfono no debe
 * tener a mano la privada, ni por descuido ni por copiar y pegar.
 */
export async function clavePublicaDeLaOrganizacion(
  organizationId: string
): Promise<string> {
  return (await clavesDeLaOrganizacion(organizationId)).publicKey;
}
