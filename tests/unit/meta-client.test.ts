import { describe, expect, it } from "vitest";
import {
  MetaApiError,
  metaApiErrorFromResponse,
  normalizeMx,
  normalizeRecipient,
} from "@/lib/meta/client";

describe("normalizeRecipient", () => {
  it("México móvil legado: 521 + 10 dígitos → 52 + 10 dígitos", () => {
    expect(normalizeRecipient("5215512345678")).toBe("525512345678");
  });

  it("México ya normalizado queda intacto", () => {
    expect(normalizeRecipient("525512345678")).toBe("525512345678");
  });

  it("Argentina móvil: 549 + 10 dígitos → 54 + 10 dígitos (issue #35)", () => {
    // Meta reporta `549…` pero la lista de destinatarios de prueba solo
    // acepta el número sin el 9: con el 9 responde 131030 y el panel muestra
    // el número como habilitado, así que el error manda a revisar donde no es.
    expect(normalizeRecipient("5491122334455")).toBe("541122334455");
  });

  it("Argentina ya normalizada queda intacta", () => {
    expect(normalizeRecipient("541122334455")).toBe("541122334455");
  });

  it("otros países quedan intactos", () => {
    expect(normalizeRecipient("14155552671")).toBe("14155552671");
    expect(normalizeRecipient("50761234567")).toBe("50761234567");
  });

  it("no confunde números que empiezan en el troncal pero con otra longitud", () => {
    expect(normalizeRecipient("521123")).toBe("521123");
    expect(normalizeRecipient("549123")).toBe("549123");
    // 549 + 11 dígitos no es un móvil argentino: no se toca.
    expect(normalizeRecipient("54911223344556")).toBe("54911223344556");
  });

  it("la identidad NO se toca: normalizar al enviar es asimétrico a propósito", () => {
    // Si la ingesta reescribiera `549…`, la identidad guardada dejaría de
    // coincidir con el `wa_id` de cada webhook y el contacto se partiría.
    expect(normalizeMx("5491122334455")).toBe("5491122334455");
  });
});

describe("MetaApiError.isAuthError", () => {
  it("status 401 es error de auth", () => {
    expect(new MetaApiError("x", { status: 401 }).isAuthError).toBe(true);
  });

  it("code 190 es error de auth (token vencido)", () => {
    expect(new MetaApiError("x", { status: 400, code: 190 }).isAuthError).toBe(
      true
    );
  });

  it("OAuthException solo NO basta (Meta la usa en errores transitorios)", () => {
    // Incidente 2026-08-03: un 500 con type OAuthException (código 2,
    // "service temporarily unavailable") marcaba el token como vencido y
    // bloqueaba TODO envío. El type por sí solo jamás decide.
    expect(
      new MetaApiError("x", { status: 400, type: "OAuthException" }).isAuthError
    ).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 2, type: "OAuthException" })
        .isAuthError
    ).toBe(false);
  });

  it("OAuthException con código 190 sí es error de auth", () => {
    expect(
      new MetaApiError("x", { status: 400, code: 190, type: "OAuthException" })
        .isAuthError
    ).toBe(true);
  });

  it("un 5xx JAMÁS es error de auth, ni con código 190", () => {
    expect(new MetaApiError("x", { status: 500 }).isAuthError).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 190 }).isAuthError
    ).toBe(false);
  });
});

describe("metaApiErrorFromResponse (027) — conserva la causa, no solo el genérico", () => {
  it("lee subcódigo, título, mensaje de usuario y error_data.details", () => {
    const err = metaApiErrorFromResponse(400, {
      error: {
        message: "(#100) Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: 2388299,
        error_user_title: "Variables cannot be at the start or end of the template",
        error_user_msg: "Please rewrite the body.",
        error_data: { messaging_product: "whatsapp", details: "Body text ends with a variable" },
      },
    });
    expect(err.code).toBe(100);
    expect(err.subcode).toBe(2388299);
    expect(err.userTitle).toMatch(/start or end/);
    expect(err.userMsg).toBe("Please rewrite the body.");
    expect(err.detail).toBe("Body text ends with a variable");
    expect(err.codeLabel).toBe("100/2388299");
    expect(err.explanation).toBe("Please rewrite the body.");
  });

  it("sin cuerpo JSON: el estado HTTP y el texto crudo", () => {
    const err = metaApiErrorFromResponse(502, null, "<html>Bad gateway</html>");
    expect(err.message).toBe("Meta respondió 502");
    expect(err.details).toBe("<html>Bad gateway</html>");
    expect(err.codeLabel).toBeNull();
    expect(err.explanation).toBe("Meta respondió 502");
  });
});
