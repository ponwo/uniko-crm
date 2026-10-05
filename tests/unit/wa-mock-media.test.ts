import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWaMockState, mediaModeFor, resetWaMockState } from "@/server/dev/wa-mock-state";

const scheduleSentStatus = vi.fn();
vi.mock("@/server/dev/wa-mock-inbound", () => ({
  scheduleSentStatus: (id: string) => scheduleSentStatus(id),
}));

const { POST } = await import("@/app/api/dev/wa-mock/graph/[...path]/route");

/**
 * 028 — El wa-mock puede fallar UNA imagen concreta de un turno de varias
 * (`mediaLink`): es lo que permite verificar que la línea de esa foto sale como
 * texto, las demás con foto y el orden se conserva (US4, FR-1306).
 */
describe("028 — wa-mock: modo de imagen por link", () => {
  beforeEach(() => resetWaMockState());

  it("sin link, el modo aplica a todas las imágenes (como en la 026)", () => {
    getWaMockState().mediaMode = "reject";
    expect(mediaModeFor("http://localhost:3000/icon-512.png?m=grs")).toBe("reject");
    expect(mediaModeFor("http://localhost:3000/icon-192.png")).toBe("reject");
  });

  it("con link, solo la imagen cuyo link lo contiene recibe el modo; las demás salen ok", () => {
    const state = getWaMockState();
    state.mediaMode = "reject";
    state.mediaLink = "m=grs";
    expect(mediaModeFor("http://localhost:3000/icon-512.png?m=grs")).toBe("reject");
    expect(mediaModeFor("http://localhost:3000/icon-192.png")).toBe("ok");
    state.mediaMode = "slow";
    state.mediaLink = "m=vrd";
    expect(mediaModeFor("http://localhost:3000/icon-192.png?m=vrd")).toBe("slow");
    expect(mediaModeFor("http://localhost:3000/icon-512.png?m=grs")).toBe("ok");
  });

  it("reset deja ok y sin link", () => {
    const state = getWaMockState();
    state.mediaMode = "reject";
    state.mediaLink = "m=grs";
    resetWaMockState();
    expect(getWaMockState().mediaMode).toBe("ok");
    expect(getWaMockState().mediaLink).toBeUndefined();
    expect(mediaModeFor("cualquiera")).toBe("ok");
  });
});

/**
 * 032 — El catálogo PDF sale como documento por link (FR-1703). El mock lo recibe
 * como Meta —al outbox, y luego `sent`— y le aplica el mismo modo de medios que a
 * la imagen, para poder ejercitar el respaldo a texto (FR-1706).
 */
describe("032 — wa-mock: documento por link", () => {
  const LINK = "http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=1";
  const DOCUMENTO = {
    messaging_product: "whatsapp",
    to: "5214627032001",
    type: "document",
    document: { link: LINK, filename: "Catálogo de prueba.pdf", caption: "¡Claro!" },
  };

  function enviar(body: unknown) {
    const req = new Request("http://localhost:3000/api/dev/wa-mock/graph/v21.0/PN_1/messages", {
      method: "POST",
      headers: { authorization: "Bearer tok-ok", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req, { params: Promise.resolve({ path: ["v21.0", "PN_1", "messages"] }) });
  }

  beforeEach(() => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    resetWaMockState();
    scheduleSentStatus.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("acepta el documento: al outbox con link, nombre y pie, y pasa a `sent` como Meta", async () => {
    const r = await enviar(DOCUMENTO);
    expect(r.status).toBe(200);
    const wamid = (await r.json()).messages[0].id as string;
    const entrada = getWaMockState().outbox.at(-1);
    expect(entrada).toMatchObject({ type: "document", to: "5214627032001", waMessageId: wamid });
    expect(entrada?.body).toMatchObject({ document: DOCUMENTO.document });
    expect(scheduleSentStatus).toHaveBeenCalledWith(wamid);
  });

  it("reject: 400 como Meta y nada en el outbox; con link, solo el documento que coincide", async () => {
    getWaMockState().mediaMode = "reject";
    const r = await enviar(DOCUMENTO);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatchObject({ type: "OAuthException", code: 100 });
    expect(getWaMockState().outbox).toHaveLength(0);
    expect(scheduleSentStatus).not.toHaveBeenCalled();

    getWaMockState().mediaLink = "catalogo.pdf";
    expect((await enviar(DOCUMENTO)).status).toBe(400);
    const foto = await enviar({
      messaging_product: "whatsapp",
      to: "5214627032001",
      type: "image",
      image: { link: "http://localhost:3000/icon-192.png" },
    });
    expect(foto.status).toBe(200);
  });

  it("slow: el documento tarda más que el tope del motor (5 s) y aun así queda registrado", async () => {
    vi.useFakeTimers();
    getWaMockState().mediaMode = "slow";
    let listo = false;
    const pendiente = enviar(DOCUMENTO).then((r) => {
      listo = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(5_500);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await pendiente).status).toBe(200);
    expect(getWaMockState().outbox.at(-1)?.type).toBe("document");
  });
});
