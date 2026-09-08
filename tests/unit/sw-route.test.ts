import { afterEach, describe, expect, it } from "vitest";
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

describe("el commit va DENTRO del cuerpo (es lo que dispara la actualización)", () => {
  /*
   * El navegador decide si hay versión nueva comparando los BYTES de este
   * archivo. Si el cuerpo no cambia entre despliegues, el worker instalado en
   * el móvil de un cliente se queda ahí con las reglas que registró el día que
   * se instaló.
   *
   * Pasó de verdad, y solo se vio en LanCo desplegada: la ruta leía la variable
   * congelada al construir —que Coolify no siempre inyecta como build-arg— y
   * salía vacía, mientras `/api/health` sí enseñaba el commit por su respaldo
   * de runtime. Los dos usan ahora el mismo resolutor.
   */
  const original = process.env.SOURCE_COMMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.SOURCE_COMMIT;
    else process.env.SOURCE_COMMIT = original;
  });

  it("incluye el commit cuando la plataforma lo publica en runtime", async () => {
    process.env.SOURCE_COMMIT = "abc1234def";
    expect(await cuerpo()).toContain("abc1234");
  });

  it("dos despliegues distintos producen cuerpos DISTINTOS", async () => {
    process.env.SOURCE_COMMIT = "1111111aaa";
    const antes = await cuerpo();
    process.env.SOURCE_COMMIT = "2222222bbb";
    const despues = await cuerpo();
    expect(antes).not.toBe(despues);
  });

  it("sin commit por ningún lado sigue sirviendo, solo con la versión", async () => {
    delete process.env.SOURCE_COMMIT;
    expect(await cuerpo()).toMatch(/Versión: \d+\.\d+\.\d+\s/);
  });
});

describe("el service worker servido: lo que NO hace", () => {
  /*
   * La bandera se apaga A PROPÓSITO en el segundo test, y eso es la mitad de
   * lo que dice.
   *
   * Escrito en la 019, cuando `PUSH` no existía, este bloque daba por hecho
   * que el entorno no la traía. En cuanto la 020 la metió en la matriz de CI
   * —configuración "completo", todas las banderas encendidas— el test se cayó:
   * el worker SÍ lleva push ahí, que es justo lo que la 020 promete. Lo que
   * hay que afirmar no es "nunca hay push", es "sin la bandera no hay push".
   */
  const original = process.env.PUSH;
  afterEach(() => {
    if (original === undefined) delete process.env.PUSH;
    else process.env.PUSH = original;
  });

  it("no cachea nada", async () => {
    const js = await cuerpo();
    expect(js).not.toContain("caches.open");
    expect(js).not.toContain("caches.match");
    expect(js).not.toContain("cache.put");
  });

  it("sin la bandera PUSH no registra nada de push (eso es la 020)", async () => {
    delete process.env.PUSH;
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
