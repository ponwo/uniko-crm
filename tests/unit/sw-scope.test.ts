import { describe, expect, it } from "vitest";
import {
  SW_RUTAS_EXCLUIDAS,
  serviceWorkerDebeIgnorar,
} from "@/lib/sw-scope";

const BASE = "https://uniko.lanco.cloud";

describe("sw-scope: qué NO toca el service worker", () => {
  describe("el canal SSE (el requisito duro de la 019)", () => {
    it("se ignora el canal de eventos", () => {
      expect(serviceWorkerDebeIgnorar(`${BASE}/api/events`)).toBe(true);
    });

    it("se ignora también con parámetros (el catch-up lleva `since=`)", () => {
      expect(
        serviceWorkerDebeIgnorar(`${BASE}/api/events?since=2026-09-07T00:00:00Z`)
      ).toBe(true);
    });

    it("una ruta que solo SE PARECE sí pasa por el service worker", () => {
      // `startsWith` pelado dejaría esto fuera de la vigilancia sin que nadie
      // se enterara. Se compara por segmento.
      expect(serviceWorkerDebeIgnorar(`${BASE}/api/eventsfalsos`)).toBe(false);
    });
  });

  describe("las superficies de máquina", () => {
    it("se ignoran los webhooks de Meta", () => {
      expect(
        serviceWorkerDebeIgnorar(`${BASE}/api/webhooks/wa/token-secreto`)
      ).toBe(true);
    });

    it("se ignora el cerebro externo", () => {
      expect(serviceWorkerDebeIgnorar(`${BASE}/api/bot/context`)).toBe(true);
    });
  });

  describe("lo que sí pasa", () => {
    it("una navegación normal", () => {
      expect(serviceWorkerDebeIgnorar(`${BASE}/inbox`)).toBe(false);
    });

    it("una API cualquiera de la app", () => {
      expect(serviceWorkerDebeIgnorar(`${BASE}/api/conversations`)).toBe(false);
    });

    it("un asset estático", () => {
      expect(serviceWorkerDebeIgnorar(`${BASE}/icon-512.png`)).toBe(false);
    });
  });

  it("la lista de exclusiones incluye las tres superficies del contrato", () => {
    expect([...SW_RUTAS_EXCLUIDAS]).toEqual([
      "/api/events",
      "/api/webhooks",
      "/api/bot",
    ]);
  });
});
