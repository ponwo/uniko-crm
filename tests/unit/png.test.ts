import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconoSirveParaInstalar, medidasPng } from "@/lib/png";

/** Un PNG mínimo pero real: firma + IHDR con las medidas pedidas. */
function pngFalso(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const escribirU32 = (offset: number, valor: number) => {
    bytes[offset] = (valor >>> 24) & 0xff;
    bytes[offset + 1] = (valor >>> 16) & 0xff;
    bytes[offset + 2] = (valor >>> 8) & 0xff;
    bytes[offset + 3] = valor & 0xff;
  };
  escribirU32(16, width);
  escribirU32(20, height);
  return bytes;
}

describe("png: medidas desde el IHDR", () => {
  it("lee las medidas de un PNG de verdad (el icono de fábrica)", () => {
    // No es un fixture inventado: es el archivo que va en la imagen.
    const real = new Uint8Array(readFileSync("public/icon-512.png"));
    expect(medidasPng(real)).toEqual({ width: 512, height: 512 });
  });

  it("lee las medidas del icono pequeño de fábrica", () => {
    const real = new Uint8Array(readFileSync("public/icon-192.png"));
    expect(medidasPng(real)).toEqual({ width: 192, height: 192 });
  });

  it("lee medidas arbitrarias", () => {
    expect(medidasPng(pngFalso(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("un archivo que no es PNG no tiene medidas", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(medidasPng(svg)).toBeNull();
  });

  it("un PNG truncado antes de la cabecera dice que no sabe", () => {
    expect(medidasPng(pngFalso(512, 512).slice(0, 20))).toBeNull();
  });
});

describe("png: ¿sirve el icono para instalar?", () => {
  it("el PNG de fábrica de 512 sirve", () => {
    const real = new Uint8Array(readFileSync("public/icon-512.png"));
    expect(iconoSirveParaInstalar("image/png", real)).toBe(true);
  });

  it("el de 192 NO sirve: es más pequeño que el mínimo", () => {
    const real = new Uint8Array(readFileSync("public/icon-192.png"));
    expect(iconoSirveParaInstalar("image/png", real)).toBe(false);
  });

  it("un PNG rectangular no sirve: se recortaría o se deformaría", () => {
    expect(iconoSirveParaInstalar("image/png", pngFalso(1024, 512))).toBe(false);
  });

  it("un SVG no sirve, por grande que sea", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(iconoSirveParaInstalar("image/svg+xml", svg)).toBe(false);
  });

  it("sin mime declarado, no sirve", () => {
    expect(iconoSirveParaInstalar(null, pngFalso(512, 512))).toBe(false);
  });

  it("un PNG grande y cuadrado sirve", () => {
    expect(iconoSirveParaInstalar("image/png", pngFalso(1024, 1024))).toBe(true);
  });
});
