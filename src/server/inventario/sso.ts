import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getEnv } from "@/lib/env";

/**
 * 026 — El pase de entrada al portal de MS-Stock (FR-1106).
 *
 * Contrato: ../MS-Sotck/specs/003-sso-uniko/contracts/sso-token.md. Un JWT
 * HS256 firmado con el secreto compartido, de UN solo uso (MS-Stock recuerda
 * el `jti`) y dos minutos de vida: la identidad humana vive aquí, MS-Stock no
 * tiene usuarios. Nada se guarda ni se reutiliza: cada clic, un pase nuevo.
 */

/** Lo que el contrato pide a Uniko; MS-Stock admite hasta 300. */
export const SSO_TTL_SECONDS = 120;
const NAME_MAX = 80;
const NEXT_RE = /^\/portal(?:[/?#]|$)/;

export async function issueSsoUrl(input: {
  userId: string;
  name: string;
  next?: string;
}): Promise<string> {
  const env = getEnv();
  const stock = env.STOCK_BASE_URL;
  const secret = env.STOCK_SSO_SECRET;
  if (!stock || !secret) {
    // Con la bandera encendida, env.ts ya exigió las dos; esto es solo el tipo.
    throw new Error("STOCK_BASE_URL y STOCK_SSO_SECRET son obligatorias para el SSO");
  }
  const name = input.name.trim().slice(0, NAME_MAX) || "Uniko";
  const next = input.next && NEXT_RE.test(input.next) ? input.next : undefined;

  const token = await new SignJWT({ name, ...(next ? { next } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.APP_BASE_URL)
    .setAudience(stock)
    .setSubject(input.userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SSO_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  return `${stock}/portal/sso?token=${encodeURIComponent(token)}`;
}
