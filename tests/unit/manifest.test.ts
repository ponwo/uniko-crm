import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";
import {
  MANIFEST_ID,
  construirManifiesto,
  iconosManifiesto,
  shortName,
} from "@/lib/manifest";

const marca = (parcial: Partial<Branding>): Branding => ({
  ...DEFAULT_BRANDING,
  ...parcial,
});

describe("manifest: la marca de la instancia", () => {
  it("lleva el nombre del negocio, no el de Uniko", () => {
    const m = construirManifiesto({
      branding: marca({ name: "I Love The Universe", accent: "#0d9ae0" }),
      iconoDelNegocioSirve: false,
      version: "g1",
    });
    expect(m.name).toBe("I Love The Universe — CRM de WhatsApp");
    expect(m.theme_color).toBe("#0d9ae0");
  });

  it("se abre en la bandeja y sin barra de direcciones", () => {
    const m = construirManifiesto({
      branding: DEFAULT_BRANDING,
      iconoDelNegocioSirve: false,
      version: "g1",
    });
    expect(m.start_url).toBe("/inbox");
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe("/");
  });

  it("el id NO cambia al renombrar el negocio", () => {
    // Si cambiara, el navegador trataría la app renombrada como otra distinta y
    // el operador acabaría con dos iconos.
    const antes = construirManifiesto({
      branding: marca({ name: "Antes" }),
      iconoDelNegocioSirve: false,
      version: "g1",
    });
    const despues = construirManifiesto({
      branding: marca({ name: "Después", accent: "#3f6b66" }),
      iconoDelNegocioSirve: false,
      version: "g2",
    });
    expect(antes.id).toBe(MANIFEST_ID);
    expect(despues.id).toBe(MANIFEST_ID);
  });
});

describe("manifest: short_name", () => {
  it("deja los nombres cortos como están", () => {
    expect(shortName("LanCo")).toBe("LanCo");
  });

  it("recorta por palabra los largos", () => {
    expect(shortName("Clínica Dental Norte")).toBe("Clínica");
  });

  it("corta a lo bruto si ni la primera palabra cabe", () => {
    expect(shortName("Superhipermegatienda")).toHaveLength(12);
  });
});

describe("manifest: iconos", () => {
  it("sin icono del negocio, declara los DOS de fábrica", () => {
    // Es el estado de las tres instancias de la flota hoy: sin esto, no habría
    // botón de instalar en ninguna.
    const iconos = iconosManifiesto({ iconoDelNegocioSirve: false, version: "g1" });
    expect(iconos).toHaveLength(2);
    expect(iconos.map((i) => i.src)).toEqual(["/icon-192.png", "/icon-512.png"]);
    expect(iconos.every((i) => i.type === "image/png")).toBe(true);
  });

  it("con icono del negocio, declara UNA sola entrada para las dos medidas", () => {
    // Con dos entradas, el navegador podría mezclar: logo de Uniko en el hueco
    // pequeño y el del negocio en el grande.
    const iconos = iconosManifiesto({ iconoDelNegocioSirve: true, version: "u42" });
    expect(iconos).toHaveLength(1);
    expect(iconos[0]?.sizes).toBe("192x192 512x512");
    expect(iconos[0]?.src).toContain("/api/branding/icon");
    expect(iconos[0]?.src).toContain("v=u42");
  });

  it("cubre siempre 192 y 512, que es lo que pide la instalabilidad", () => {
    for (const sirve of [true, false]) {
      const declarado = iconosManifiesto({
        iconoDelNegocioSirve: sirve,
        version: "g1",
      })
        .flatMap((i) => i.sizes.split(" "))
        .map((s) => Number(s.split("x")[0]));
      expect(Math.max(...declarado)).toBeGreaterThanOrEqual(512);
      expect(declarado).toContain(192);
    }
  });
});
