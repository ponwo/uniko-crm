import { describe, expect, it } from "vitest";
import {
  countVariables,
  renderBody,
  validateBodyVariables,
} from "@/server/whatsapp/templates";
import {
  analizarComponentes,
  bloqueoDeMeta,
  esEnviable,
  normalizeBody,
} from "@/lib/templates";

describe("countVariables / validateBodyVariables (FR-050)", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("varias variables numeradas en orden → válido", () => {
    const body = "Hola {{1}}, te confirmo el {{2}} a las {{3}}.";
    expect(countVariables(body)).toBe(3);
    expect(validateBodyVariables(body)).toBeNull();
  });

  it("la variable repetida cuenta una sola vez", () => {
    expect(countVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBeNull();
  });

  it("numeración con salto → inválida", () => {
    expect(validateBodyVariables("Hola {{1}}, tu pedido {{3}} llegó")).toMatch(
      /sin saltos/
    );
  });

  it("variable {{2}} sola → inválida (debe empezar en {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(/\{\{1\}\}/);
  });

  it("más de 10 variables → inválida", () => {
    const body = Array.from({ length: 11 }, (_, i) => `x {{${i + 1}}}`).join(" ");
    expect(validateBodyVariables(body)).toMatch(/hasta 10/);
  });
});

describe("renderBody", () => {
  it("sustituye la variable por el valor", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", ["María"])).toBe(
      "Hola María, ¿retomamos?"
    );
  });

  it("sustituye cada variable por su posición", () => {
    expect(
      renderBody("Hola {{1}}, te espero el {{2}} a las {{3}}.", [
        "María",
        "12 de agosto",
        "5 pm",
      ])
    ).toBe("Hola María, te espero el 12 de agosto a las 5 pm.");
  });

  it("sin valores → variables vacías", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
    expect(renderBody("Hola {{1}} el {{2}}", ["María"])).toBe("Hola María el ");
  });
});

/* ============================================================
 * 027 — Lo que Meta valida al crear, validado antes
 * ============================================================ */

describe("normalizeBody (027, FR-1208)", () => {
  it("pega las llaves: Meta no reconoce {{ 1 }} como variable", () => {
    expect(normalizeBody("Hola {{ 1 }}, tu cita es el {{2 }}.")).toBe(
      "Hola {{1}}, tu cita es el {{2}}."
    );
  });

  it("recorta espacios y saltos de línea alrededor", () => {
    expect(normalizeBody("  Hola {{1}}, ¿retomamos?\n\n")).toBe("Hola {{1}}, ¿retomamos?");
  });
});

describe("validateBodyVariables — reglas síncronas de Meta (2388299)", () => {
  it("variable al FINAL → inválida, y dice qué hacer", () => {
    expect(validateBodyVariables("Hola {{1}}")).toMatch(/TERMINE/);
    // Con espacios detrás también: Meta recorta antes de mirar.
    expect(validateBodyVariables("Hola {{1}}   ")).toMatch(/TERMINE/);
  });

  it("variable al INICIO → inválida", () => {
    expect(validateBodyVariables("{{1}}, tu pedido llegó.")).toMatch(/EMPIECE/);
  });

  it("dos variables pegadas (solo espacios entre ellas) → inválida", () => {
    expect(validateBodyVariables("Hola {{1}} {{2}}, ¿retomamos?")).toMatch(/pegadas/);
    expect(validateBodyVariables("Hola {{1}}{{2}}, ¿retomamos?")).toMatch(/pegadas/);
  });

  it("puntuación después de la última variable basta", () => {
    expect(validateBodyVariables("Hola {{1}}.")).toBeNull();
    expect(validateBodyVariables("¿Retomamos, {{1}}?")).toBeNull();
    expect(validateBodyVariables("Hola {{1}} el {{2}} a las {{3}}.")).toBeNull();
  });

  it("la regla de saltos sigue mandando antes que la de posición", () => {
    expect(validateBodyVariables("Hola {{1}}, {{3}}")).toMatch(/sin saltos/);
  });
});

describe("esEnviable (027, FR-1207)", () => {
  const base = {
    status: "approved",
    missingSince: null,
    metaStatus: "APPROVED",
    body: "Hola {{1}}, ¿retomamos?",
    components: null,
  };

  it("aprobada + presente + APPROVED + solo cuerpo → enviable", () => {
    expect(esEnviable(base)).toBe(true);
  });

  it("pendiente o rechazada → no", () => {
    expect(esEnviable({ ...base, status: "pending" })).toBe(false);
    expect(esEnviable({ ...base, status: "rejected" })).toBe(false);
  });

  it("ausente en Meta → no, aunque siga approved", () => {
    expect(esEnviable({ ...base, missingSince: "2026-09-14T00:00:00Z" })).toBe(false);
  });

  it("el estado crudo manda EN POSITIVO: PAUSED, desconocido y null bloquean", () => {
    expect(esEnviable({ ...base, metaStatus: "PAUSED" })).toBe(false);
    expect(esEnviable({ ...base, metaStatus: "ALGO_QUE_META_INVENTE" })).toBe(false);
    expect(esEnviable({ ...base, metaStatus: null })).toBe(false);
  });

  it("una importada con encabezado de imagen no se ofrece", () => {
    expect(
      esEnviable({
        ...base,
        components: [
          { type: "HEADER", format: "IMAGE" },
          { type: "BODY", text: base.body },
        ],
      })
    ).toBe(false);
  });

  it("una importada con encabezado de texto fijo, pie y botones estáticos sí", () => {
    expect(
      esEnviable({
        ...base,
        components: [
          { type: "HEADER", format: "TEXT", text: "Recordatorio" },
          { type: "BODY", text: base.body },
          { type: "FOOTER", text: "Responde STOP para no recibir más" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Sí" },
              { type: "PHONE_NUMBER", text: "Llamar", phone_number: "+525500000000" },
              { type: "URL", text: "Ver", url: "https://ejemplo.mx/citas" },
            ],
          },
        ],
      })
    ).toBe(true);
  });
});

describe("bloqueoDeMeta (027)", () => {
  it("sin bloqueo cuando Meta dice APPROVED o el ciclo no terminó", () => {
    expect(bloqueoDeMeta({ status: "approved", metaStatus: "APPROVED" })).toBeNull();
    expect(bloqueoDeMeta({ status: "pending", metaStatus: null })).toBeNull();
    expect(bloqueoDeMeta({ status: "rejected", metaStatus: "REJECTED" })).toBeNull();
  });

  it("PAUSED, DISABLED y LIMIT_EXCEEDED tienen etiqueta y salida propias", () => {
    expect(bloqueoDeMeta({ status: "approved", metaStatus: "PAUSED" })?.etiqueta).toBe(
      "Pausada por Meta"
    );
    expect(bloqueoDeMeta({ status: "approved", metaStatus: "DISABLED" })?.explicacion).toMatch(
      /crea una plantilla nueva/i
    );
    expect(
      bloqueoDeMeta({ status: "approved", metaStatus: "LIMIT_EXCEEDED" })?.explicacion
    ).toMatch(/Borra/);
  });

  it("un estado desconocido se nombra LITERAL y bloquea", () => {
    const b = bloqueoDeMeta({ status: "approved", metaStatus: "NUEVO_DE_2027" });
    expect(b?.etiqueta).toContain("NUEVO_DE_2027");
  });

  it("null (sin noticias de Meta) también bloquea, con la salida: Sincronizar", () => {
    expect(bloqueoDeMeta({ status: "approved", metaStatus: null })?.explicacion).toMatch(
      /Sincronizar/
    );
  });

  it("una PAUSED importada como pending también se dice: la insignia no puede decir 'Pendiente'", () => {
    expect(bloqueoDeMeta({ status: "pending", metaStatus: "PAUSED" })?.etiqueta).toBe(
      "Pausada por Meta"
    );
    // Pendiente de verdad (Meta lo confirma) o sin noticias: sin bloqueo.
    expect(bloqueoDeMeta({ status: "pending", metaStatus: "IN_REVIEW" })).toBeNull();
    expect(bloqueoDeMeta({ status: "pending", metaStatus: null })).toBeNull();
  });
});

describe("analizarComponentes (027) — lo que el CRM no sabe rellenar", () => {
  it("solo cuerpo posicional → sin extras ni requisito", () => {
    expect(analizarComponentes([{ type: "BODY", text: "Hola {{1}}." }], "Hola {{1}}.")).toEqual({
      extras: null,
      requisito: null,
    });
    expect(analizarComponentes(null, "Hola {{1}}.")).toEqual({ extras: null, requisito: null });
  });

  it("encabezado multimedia → se nombra y bloquea", () => {
    const a = analizarComponentes(
      [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola." }],
      "Hola."
    );
    expect(a.extras).toBe("Encabezado: imagen");
    expect(a.requisito).toMatch(/encabezado es imagen/);
  });

  it("encabezado de texto con variable → bloquea; sin variable → pasa", () => {
    expect(
      analizarComponentes([{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }], "x")
        .requisito
    ).toMatch(/encabezado lleva una variable/);
    expect(
      analizarComponentes([{ type: "HEADER", format: "TEXT", text: "Aviso" }], "x").requisito
    ).toBeNull();
  });

  it("botón URL con variable o COPY_CODE → bloquea; quick reply y teléfono → pasan", () => {
    const conVariable = analizarComponentes(
      [
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", text: "Pagar", url: "https://pagos.mx/{{1}}" }],
        },
      ],
      "x"
    );
    expect(conVariable.extras).toBe("1 botón");
    expect(conVariable.requisito).toMatch(/«Pagar» lleva un enlace con variable/);
    expect(
      analizarComponentes(
        [{ type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "Copiar" }] }],
        "x"
      ).requisito
    ).toMatch(/COPY_CODE/);
    expect(
      analizarComponentes(
        [
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Sí" },
              { type: "PHONE_NUMBER", text: "Llamar", phone_number: "+52" },
            ],
          },
        ],
        "x"
      ).requisito
    ).toBeNull();
  });

  it("variables con nombre en el cuerpo → bloquea y las lista", () => {
    const a = analizarComponentes(null, "Hola {{nombre}}, tu cita es el {{fecha}}.");
    expect(a.requisito).toMatch(/\{\{nombre\}\}, \{\{fecha\}\}/);
  });

  it("un componente que el CRM no conoce (CAROUSEL) → bloquea nombrándolo", () => {
    const a = analizarComponentes([{ type: "CAROUSEL" }], "x");
    expect(a.extras).toBe("carousel");
    expect(a.requisito).toMatch(/CAROUSEL/);
  });
});
