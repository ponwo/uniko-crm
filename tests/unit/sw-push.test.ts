import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/sw/route";
import { SW_RUTAS_EXCLUIDAS } from "@/lib/sw-scope";

async function cuerpo() {
  return await GET().text();
}

const original = process.env.PUSH;
afterEach(() => {
  if (original === undefined) delete process.env.PUSH;
  else process.env.PUSH = original;
});

describe("el service worker con la bandera PUSH apagada", () => {
  it("no lleva NADA de push", async () => {
    delete process.env.PUSH;
    const js = await cuerpo();
    expect(js).not.toContain('addEventListener("push"');
    expect(js).not.toContain("notificationclick");
    expect(js).not.toContain("showNotification");
  });

  it("y por tanto no puede pedir permiso ni registrar nada", async () => {
    delete process.env.PUSH;
    expect(await cuerpo()).not.toContain("/api/push/pendiente");
  });
});

describe("el service worker con la bandera PUSH encendida", () => {
  it("añade push y notificationclick, y solo eso", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    expect(js).toContain('addEventListener("push"');
    expect(js).toContain('addEventListener("notificationclick"');
  });

  it("pide el detalle a la propia instancia: el aviso llega vacío", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    expect(js).toContain("/api/push/pendiente");
    expect(js).toContain("showNotification");
  });

  it("lleva el texto degradado para cuando no hay red", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    expect(js).toContain("Alguien necesita atención");
    expect(js).toContain("Ábrela para ver cuál");
  });

  it("marca la notificación con su conversación, para poder reemplazarla", async () => {
    process.env.PUSH = "on";
    expect(await cuerpo()).toContain("uniko:conv:");
  });
});

describe("añadir push NO desplaza lo que protegió la 019", () => {
  /*
   * Esto es lo que de verdad se está vigilando. Técnicamente un manejador de
   * `push` no puede interceptar peticiones —son eventos distintos—, así que el
   * riesgo no es del lenguaje: es de la persona que abra este archivo para
   * añadir push y reescriba el `fetch` de paso. Estos tests, y el arnés con la
   * bandera encendida, son el único sitio donde eso se atrapa.
   */
  it("con push encendido siguen estando las tres rutas excluidas", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    for (const ruta of SW_RUTAS_EXCLUIDAS) expect(js).toContain(ruta);
  });

  it("con push encendido sigue el enrutado estático a la red", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    expect(js).toContain("addRoutes");
    expect(js).toContain('source: "network"');
  });

  it("con push encendido sigue la salida temprana ANTES de responder nada", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    const posIgnorar = js.indexOf("if (debeIgnorar(request.url))");
    const posResponder = js.indexOf("event.respondWith");
    expect(posIgnorar).toBeGreaterThan(-1);
    expect(posResponder).toBeGreaterThan(posIgnorar);
  });

  it("y sigue sin cachear nada", async () => {
    process.env.PUSH = "on";
    const js = await cuerpo();
    expect(js).not.toContain("caches.open");
    expect(js).not.toContain("caches.match");
  });

  it("el contador de excluidas sigue ahí: es lo que el arnés pregunta", async () => {
    process.env.PUSH = "on";
    expect(await cuerpo()).toContain("excluidasVistas");
  });

  it("encender la bandera CAMBIA los bytes del archivo", async () => {
    // Si no cambiaran, el worker ya instalado en un teléfono se quedaría sin
    // el manejador de push para siempre: el navegador decide si hay versión
    // nueva comparando bytes.
    delete process.env.PUSH;
    const apagada = await cuerpo();
    process.env.PUSH = "on";
    const encendida = await cuerpo();
    expect(apagada).not.toBe(encendida);
  });
});
