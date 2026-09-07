import { describe, expect, it } from "vitest";
import {
  decidirAvisoInstalacion,
  esAndroid,
  esIOS,
  estaInstalada,
  type EntornoCliente,
} from "@/lib/platform";

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const UA_IPAD_COMO_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const UA_ESCRITORIO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const entorno = (parcial: Partial<EntornoCliente>): EntornoCliente => ({
  userAgent: UA_ESCRITORIO,
  maxTouchPoints: 0,
  displayStandalone: false,
  ...parcial,
});

describe("platform: dónde corre la app", () => {
  it("un iPhone es iOS", () => {
    expect(esIOS(entorno({ userAgent: UA_IPHONE, maxTouchPoints: 5 }))).toBe(true);
  });

  it("un iPad que se anuncia como Mac TAMBIÉN es iOS", () => {
    // Desde iPadOS 13 el iPad dice ser un Macintosh. Lo delata el táctil.
    expect(
      esIOS(entorno({ userAgent: UA_IPAD_COMO_MAC, maxTouchPoints: 5 }))
    ).toBe(true);
  });

  it("un Mac de verdad no es iOS", () => {
    expect(
      esIOS(entorno({ userAgent: UA_IPAD_COMO_MAC, maxTouchPoints: 0 }))
    ).toBe(false);
  });

  it("un Android es Android y no iOS", () => {
    const e = entorno({ userAgent: UA_ANDROID, maxTouchPoints: 5 });
    expect(esAndroid(e)).toBe(true);
    expect(esIOS(e)).toBe(false);
  });

  it("está instalada por display-mode", () => {
    expect(estaInstalada(entorno({ displayStandalone: true }))).toBe(true);
  });

  it("está instalada por navigator.standalone (el camino de iOS)", () => {
    expect(
      estaInstalada(
        entorno({ userAgent: UA_IPHONE, navigatorStandalone: true })
      )
    ).toBe(true);
  });
});

describe("platform: qué aviso de instalación toca", () => {
  it("Android con evento guardado → botón", () => {
    expect(
      decidirAvisoInstalacion({
        entorno: entorno({ userAgent: UA_ANDROID, maxTouchPoints: 5 }),
        hayEventoDeInstalacion: true,
        descartado: false,
      })
    ).toBe("boton");
  });

  it("iPhone → instrucciones (ahí nunca hay evento)", () => {
    expect(
      decidirAvisoInstalacion({
        entorno: entorno({ userAgent: UA_IPHONE, maxTouchPoints: 5 }),
        hayEventoDeInstalacion: false,
        descartado: false,
      })
    ).toBe("instrucciones");
  });

  it("ya instalada → nada, ni botón ni instrucciones", () => {
    expect(
      decidirAvisoInstalacion({
        entorno: entorno({
          userAgent: UA_IPHONE,
          maxTouchPoints: 5,
          navigatorStandalone: true,
        }),
        hayEventoDeInstalacion: true,
        descartado: false,
      })
    ).toBe("nada");
  });

  it("descartado por el operador → nada, aunque se pudiera instalar", () => {
    expect(
      decidirAvisoInstalacion({
        entorno: entorno({ userAgent: UA_ANDROID, maxTouchPoints: 5 }),
        hayEventoDeInstalacion: true,
        descartado: true,
      })
    ).toBe("nada");
  });

  it("escritorio sin evento → nada que decir", () => {
    expect(
      decidirAvisoInstalacion({
        entorno: entorno({}),
        hayEventoDeInstalacion: false,
        descartado: false,
      })
    ).toBe("nada");
  });
});
