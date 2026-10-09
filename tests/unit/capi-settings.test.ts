import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 — De dónde sale el ID del dataset.
 *
 * El caso real (ILTU, 2026-10-09): se pegaron el ID de la cuenta de WhatsApp,
 * el del número y una cadena cualquiera; los tres se guardaron y cada venta
 * falló después en Meta. Como cada evento se intenta una sola vez, esas
 * conversiones se perdieron. El camino bueno es no teclearlo («Obtener de
 * Meta»); la validación al guardar es la red para quien lo pega a mano.
 */

const graphRequest = vi.fn();
const getCredentialsByOrg = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg }));

const { MetaApiError } = await import("@/lib/meta/client");
const { obtainWabaDataset } = await import("@/lib/meta/capi");
const { datasetFromMeta, datasetIdProblem } = await import(
  "@/server/attribution/settings"
);

const whatsapp = { wabaId: "1055429640418662", phoneNumberId: "1359545413898863" };

beforeEach(() => {
  graphRequest.mockReset();
  getCredentialsByOrg.mockReset();
});

describe("datasetIdProblem", () => {
  it("acepta un ID de dataset numérico distinto de los de WhatsApp", () => {
    expect(datasetIdProblem("1079757714868238", whatsapp)).toBeNull();
  });

  it("rechaza el ID de la cuenta de WhatsApp", () => {
    expect(datasetIdProblem("1055429640418662", whatsapp)).toMatch(
      /cuenta de WhatsApp/
    );
  });

  it("rechaza el ID del número de teléfono", () => {
    expect(datasetIdProblem("1359545413898863", whatsapp)).toMatch(/número/);
  });

  it("rechaza lo que no es un número", () => {
    expect(datasetIdProblem("AErb_b9y6jgDlm8Xb7PBCYF", whatsapp)).toMatch(
      /solo números/
    );
    expect(datasetIdProblem("1079 7577", whatsapp)).not.toBeNull();
  });

  it("sin conexión de WhatsApp solo puede exigir que sea numérico", () => {
    // Con un token propio pegado no hay cuenta contra la cual comparar.
    expect(datasetIdProblem("1055429640418662", null)).toBeNull();
    expect(datasetIdProblem("abc", null)).not.toBeNull();
  });
});

describe("obtainWabaDataset", () => {
  it("le pide a Meta el dataset de la cuenta con POST {waba}/dataset", async () => {
    // POST y no GET: con una cuenta sin dataset, GET responde una lista
    // vacía; POST lo crea, y si ya existe devuelve el mismo.
    graphRequest.mockResolvedValue({ id: "1079757714868238" });
    await expect(
      obtainWabaDataset({ wabaId: "1055429640418662", token: "tok" })
    ).resolves.toBe("1079757714868238");
    expect(graphRequest).toHaveBeenCalledWith(
      "1055429640418662/dataset",
      expect.objectContaining({ method: "POST", token: "tok" })
    );
  });

  it("un id numérico (no texto) también sirve", async () => {
    graphRequest.mockResolvedValue({ id: 1079757714868238 });
    await expect(
      obtainWabaDataset({ wabaId: "W", token: "tok" })
    ).resolves.toBe("1079757714868238");
  });

  it("una respuesta sin id útil es un fallo, no un ID vacío", async () => {
    graphRequest.mockResolvedValue({ data: [] });
    await expect(obtainWabaDataset({ wabaId: "W", token: "tok" })).rejects.toThrow(
      /no devolvió el ID del dataset/
    );
    graphRequest.mockResolvedValue({ id: "ds-raro" });
    await expect(obtainWabaDataset({ wabaId: "W", token: "tok" })).rejects.toThrow(
      /no devolvió el ID del dataset/
    );
  });
});

describe("datasetFromMeta", () => {
  const credentials = {
    wabaId: "1055429640418662",
    phoneNumberId: "1359545413898863",
    displayPhoneNumber: "+52 1 33 1470 3151",
    token: "tok-del-negocio",
  };

  it("usa la cuenta y el token de WhatsApp ya conectados, y no guarda nada", async () => {
    getCredentialsByOrg.mockResolvedValue(credentials);
    graphRequest.mockResolvedValue({ id: "1079757714868238" });
    await expect(datasetFromMeta("org_1")).resolves.toEqual({
      ok: true,
      datasetId: "1079757714868238",
      displayPhoneNumber: "+52 1 33 1470 3151",
    });
    expect(graphRequest).toHaveBeenCalledWith(
      "1055429640418662/dataset",
      expect.objectContaining({ token: "tok-del-negocio" })
    );
  });

  it("sin WhatsApp conectado no hay a quién preguntarle: 409 sin_whatsapp", async () => {
    getCredentialsByOrg.mockResolvedValue(null);
    await expect(datasetFromMeta("org_1")).resolves.toMatchObject({
      ok: false,
      status: 409,
      code: "sin_whatsapp",
    });
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("si Meta lo niega, el motivo viaja tal cual (p. ej. falta de permiso)", async () => {
    getCredentialsByOrg.mockResolvedValue(credentials);
    graphRequest.mockRejectedValue(
      new MetaApiError("(#200) Requires whatsapp_business_management permission", {
        status: 403,
        code: 200,
      })
    );
    const r = await datasetFromMeta("org_1");
    expect(r).toMatchObject({ ok: false, status: 422, code: "meta_rechazo" });
    expect(r.ok ? "" : r.message).toMatch(/whatsapp_business_management/);
  });

  it("Meta caído o sin respuesta es otra cosa: 503, intentar de nuevo", async () => {
    getCredentialsByOrg.mockResolvedValue(credentials);
    graphRequest.mockRejectedValue(
      new MetaApiError("Meta no respondió a tiempo", { status: 0 })
    );
    await expect(datasetFromMeta("org_1")).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: "meta_no_disponible",
    });
  });

  it("una respuesta sin ID útil se reporta como inesperada, no como un ID", async () => {
    getCredentialsByOrg.mockResolvedValue(credentials);
    graphRequest.mockResolvedValue({});
    await expect(datasetFromMeta("org_1")).resolves.toMatchObject({
      ok: false,
      status: 502,
      code: "meta_respuesta_inesperada",
    });
  });
});
