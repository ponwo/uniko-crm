import { describe, expect, it } from "vitest";
import { MetaApiError, metaApiErrorFromResponse } from "@/lib/meta/client";
import {
  describeTemplateError,
  esFaltaDePermiso,
  esNombreDuplicado,
  esWabaDesconocido,
} from "@/lib/meta/template-errors";

/** Un 400 de Graph con la forma real: `message` genérico, causa aparte. */
function graph400(error: Record<string, unknown>): MetaApiError {
  return metaApiErrorFromResponse(400, {
    error: { message: "(#100) Invalid parameter", type: "OAuthException", code: 100, ...error },
  });
}

describe("describeTemplateError (027, FR-1210)", () => {
  it("2388299 → variables al inicio/final, con el código para rastrearlo", () => {
    const msg = describeTemplateError(
      graph400({
        error_subcode: 2388299,
        error_user_title: "Variables cannot be at the start or end of the template",
      })
    );
    expect(msg).toMatch(/inicio ni al final/);
    expect(msg).toMatch(/\(Meta 100\/2388299\)$/);
  });

  it("2388293 → demasiadas variables para el texto", () => {
    expect(describeTemplateError(graph400({ error_subcode: 2388293 }))).toMatch(
      /demasiadas variables/
    );
  });

  it("2388019 → cuenta llena (250)", () => {
    expect(describeTemplateError(graph400({ error_subcode: 2388019 }))).toMatch(/250/);
  });

  it("sin subcódigo conocido → lo que Meta dijo de verdad, no el genérico", () => {
    const msg = describeTemplateError(
      graph400({
        error_user_msg: "The example values you provided do not match the variables.",
      })
    );
    expect(msg).toBe(
      "The example values you provided do not match the variables. (Meta 100)"
    );
  });

  it("prefiere error_user_msg › error_data.details › error_user_title › message", () => {
    expect(
      graph400({ error_data: { details: "Detalle" }, error_user_title: "Título" }).explanation
    ).toBe("Detalle");
    expect(graph400({ error_user_title: "Título" }).explanation).toBe("Título");
    expect(graph400({}).explanation).toBe("(#100) Invalid parameter");
    // Cadenas vacías no cuentan: Meta a veces las manda.
    expect(graph400({ error_user_msg: "  ", error_user_title: "Título" }).explanation).toBe(
      "Título"
    );
  });

  it("permisos (10, 200, 3, o HTTP 403) → el token necesita whatsapp_business_management", () => {
    for (const code of [10, 200, 3]) {
      const err = new MetaApiError("(#10) Permission denied", { status: 400, code });
      expect(esFaltaDePermiso(err)).toBe(true);
      expect(describeTemplateError(err)).toMatch(/whatsapp_business_management/);
    }
    expect(esFaltaDePermiso(new MetaApiError("x", { status: 403 }))).toBe(true);
    expect(esFaltaDePermiso(graph400({}))).toBe(false);
  });

  it("100/33 → el WABA ID no es el de la cuenta de WhatsApp Business", () => {
    const err = graph400({ error_subcode: 33 });
    expect(esWabaDesconocido(err)).toBe(true);
    expect(describeTemplateError(err)).toMatch(/WABA ID/);
  });

  it("límite de tasa (4, 17, 32, 613, 80007) → esperar unos minutos", () => {
    expect(
      describeTemplateError(new MetaApiError("x", { status: 400, code: 80007 }))
    ).toMatch(/unos minutos/);
  });
});

describe("esNombreDuplicado (027, FR-1211)", () => {
  it("lo detecta en el título o el mensaje de usuario, sin depender de un subcódigo", () => {
    expect(
      esNombreDuplicado(
        graph400({
          error_user_title: "Message Template Name Already Exists",
          error_user_msg: "Message template with the same name and language already exists.",
        })
      )
    ).toBe(true);
    expect(esNombreDuplicado(graph400({ error_user_msg: "already exists" }))).toBe(true);
  });

  it("no confunde otros 100", () => {
    expect(esNombreDuplicado(graph400({ error_subcode: 2388299 }))).toBe(false);
  });
});
