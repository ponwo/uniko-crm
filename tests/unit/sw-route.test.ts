import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/sw/route";
import { SW_RUTAS_EXCLUIDAS } from "@/lib/sw-scope";

async function cuerpo() {
  return await GET().text();
}

describe("la ruta del service worker (/sw.js por rewrite)", () => {
  it("se sirve como JavaScript", async () => {
    expect(GET().headers.get("content-type")).toContain("application/javascript");
  });

  it("no se cachea con fuerza: un service worker viejo no se puede desalojar", async () => {
    expect(GET().headers.get("cache-control")).toBe("no-cache");
  });

  it("lleva la versión dentro, para que un despliegue cambie los bytes", async () => {
    expect(await cuerpo()).toMatch(/Versión: .+/);
  });
});

describe("el service worker servido: lo que NO hace", () => {
  it("no cachea nada", async () => {
    const js = await cuerpo();
    expect(js).not.toContain("caches.open");
    expect(js).not.toContain("caches.match");
    expect(js).not.toContain("cache.put");
  });

  it("no registra nada de push (eso es la 020, tras su bandera)", async () => {
    const js = await cuerpo();
    expect(js).not.toContain('"push"');
    expect(js).not.toContain("notificationclick");
    expect(js).not.toContain("showNotification");
  });
});

describe("el service worker servido: la exclusión del canal de eventos", () => {
  it("lleva incrustadas las tres rutas excluidas del contrato", async () => {
    const js = await cuerpo();
    for (const ruta of SW_RUTAS_EXCLUIDAS) {
      expect(js).toContain(ruta);
    }
  });

  it("sale del handler ANTES de responder cuando la ruta está excluida", async () => {
    const js = await cuerpo();
    const posIgnorar = js.indexOf("if (debeIgnorar(request.url))");
    const posResponder = js.indexOf("event.respondWith");
    expect(posIgnorar).toBeGreaterThan(-1);
    expect(posResponder).toBeGreaterThan(posIgnorar);
  });

  it("declara enrutado estático a la red para cada ruta excluida", async () => {
    // Es la garantía fuerte: con esto el navegador ni consulta al worker, así
    // que la exclusión no depende de lo que el handler haga en el futuro.
    const js = await cuerpo();
    expect(js).toContain("addRoutes");
    expect(js).toContain('source: "network"');
    expect(js).toContain("urlPattern");
  });

  it("sabe decir cuántas peticiones excluidas ha visto", async () => {
    // Sin esto la exclusión no se puede comprobar desde fuera: el workerStart
    // del timing se sella igual pase o no la petición por el handler.
    const js = await cuerpo();
    expect(js).toContain("excluidasVistas");
    expect(js).toContain("uniko:diagnostico");
  });

  it("solo responde la navegación, y yendo a la red", async () => {
    const js = await cuerpo();
    // Una sola llamada a respondWith en todo el archivo, y es la de navegación.
    expect(js.match(/respondWith/g)?.length).toBe(1);
    expect(js).toContain('request.mode === "navigate"');
    expect(js).toContain("event.respondWith(fetch(request))");
  });

  it("la copia embebida decide igual que lib/sw-scope", async () => {
    // El service worker no puede importar el módulo: lleva una copia. Este test
    // es lo que impide que las dos versiones se separen sin que nadie lo note.
    const js = await cuerpo();
    const debeIgnorar = new Function(
      "url",
      `${js.slice(js.indexOf("const RUTAS_EXCLUIDAS"), js.indexOf('self.addEventListener("install"'))}
       return debeIgnorar(url);`
    ) as (url: string) => boolean;

    const casos: Array<[string, boolean]> = [
      ["https://x.test/api/events", true],
      ["https://x.test/api/events?since=1", true],
      ["https://x.test/api/eventsfalsos", false],
      ["https://x.test/api/webhooks/wa/tok", true],
      ["https://x.test/api/bot/context", true],
      ["https://x.test/inbox", false],
      ["https://x.test/api/conversations", false],
    ];
    for (const [url, esperado] of casos) {
      expect(debeIgnorar(url), url).toBe(esperado);
    }
  });
});
