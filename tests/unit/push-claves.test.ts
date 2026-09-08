import { beforeAll, describe, expect, it } from "vitest";
import { createPublicKey, createVerify } from "node:crypto";
import {
  clavePrivadaParaFirmar,
  generarParVapid,
} from "@/server/push/claves";
import { derARaw, firmarVapid } from "@/server/push/vapid";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// El cifrado en reposo lee el entorno validado, igual que en producción.
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

describe("claves VAPID", () => {
  it("genera un par en el formato que espera el navegador", () => {
    const { publicKey, privateKey } = generarParVapid();
    const publica = Buffer.from(publicKey, "base64url");
    // 65 bytes que empiezan por 0x04: punto sin comprimir de P-256. Si esto
    // cambiara, el navegador rechazaría la suscripción sin decir por qué.
    expect(publica.length).toBe(65);
    expect(publica[0]).toBe(0x04);
    expect(Buffer.from(privateKey, "base64url").length).toBe(32);
  });

  it("cada par es distinto", () => {
    expect(generarParVapid().publicKey).not.toBe(generarParVapid().publicKey);
  });

  it("la privada se puede reconstruir para firmar", () => {
    const claves = generarParVapid();
    expect(() => clavePrivadaParaFirmar(claves)).not.toThrow();
  });

  it("se guarda cifrada, y descifra a lo mismo", () => {
    const { privateKey } = generarParVapid();
    const cifrada = encryptSecret(privateKey);
    expect(cifrada.cipher).not.toContain(privateKey);
    expect(decryptSecret(cifrada)).toBe(privateKey);
  });

  it("un tag manipulado hace que el descifrado lance", () => {
    // AES-GCM da integridad además de confidencialidad: si alguien tocó la
    // fila, esto revienta en vez de devolver basura.
    const cifrada = encryptSecret(generarParVapid().privateKey);
    const tagRoto = Buffer.from(cifrada.tag, "base64");
    tagRoto[0] = (tagRoto[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptSecret({ ...cifrada, tag: tagRoto.toString("base64") })
    ).toThrow();
  });
});

describe("la firma VAPID", () => {
  const claves = generarParVapid();
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

  it("el JWT tiene tres partes y dice ES256", () => {
    const jwt = firmarVapid({ endpoint, claves, sujeto: "mailto:a@b.c" });
    const [header, payload, firma] = jwt.split(".");
    expect(firma).toBeTruthy();
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(
      JSON.parse(Buffer.from(payload!, "base64url").toString()).aud
    ).toBe("https://fcm.googleapis.com");
  });

  it("`aud` es el ORIGEN, no el endpoint entero", () => {
    // Mandar el endpoint completo hace que el servicio rechace sin explicar.
    const jwt = firmarVapid({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz",
      claves,
      sujeto: "mailto:a@b.c",
    });
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1]!, "base64url").toString()
    );
    expect(payload.aud).toBe("https://updates.push.services.mozilla.com");
  });

  it("la firma son 64 bytes crudos, no DER", () => {
    const jwt = firmarVapid({ endpoint, claves, sujeto: "mailto:a@b.c" });
    expect(Buffer.from(jwt.split(".")[2]!, "base64url").length).toBe(64);
  });

  it("y la firma verifica de verdad contra la clave", () => {
    // Que tenga 64 bytes no prueba que sea correcta. Esto sí.
    const jwt = firmarVapid({ endpoint, claves, sujeto: "mailto:a@b.c" });
    const [header, payload, firma] = jwt.split(".");
    const raw = Buffer.from(firma!, "base64url");
    // De R‖S de vuelta a DER para poder verificar con node:crypto.
    const aDer = (v: Buffer) => {
      let x = v;
      while (x.length > 1 && x[0] === 0x00 && (x[1]! & 0x80) === 0) x = x.subarray(1);
      if (x[0]! & 0x80) x = Buffer.concat([Buffer.from([0x00]), x]);
      return Buffer.concat([Buffer.from([0x02, x.length]), x]);
    };
    const r = aDer(raw.subarray(0, 32));
    const s = aDer(raw.subarray(32));
    const der = Buffer.concat([
      Buffer.from([0x30, r.length + s.length]),
      r,
      s,
    ]);
    const publica = Buffer.from(claves.publicKey, "base64url");
    const pub = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: publica.subarray(1, 33).toString("base64url"),
        y: publica.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      createVerify("SHA256").update(`${header}.${payload}`).verify(pub, der)
    ).toBe(true);
  });

  it("derARaw rellena por la izquierda cuando el entero es corto", () => {
    // Un R de 31 bytes es legal en DER y mortal en JWS si no se rellena.
    const r = Buffer.alloc(31, 0x11);
    const s = Buffer.alloc(32, 0x22);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    const raw = derARaw(der);
    expect(raw.length).toBe(64);
    expect(raw[0]).toBe(0x00);
  });
});
