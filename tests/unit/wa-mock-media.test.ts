import { beforeEach, describe, expect, it } from "vitest";
import { getWaMockState, mediaModeFor, resetWaMockState } from "@/server/dev/wa-mock-state";

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
