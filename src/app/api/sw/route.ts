import { SW_RUTAS_EXCLUIDAS } from "@/lib/sw-scope";

export const dynamic = "force-dynamic";

/**
 * El service worker de Uniko. **Se sirve como `/sw.js`**, por una rewrite
 * declarada en `next.config.ts`; este handler vive en `/api/sw`.
 *
 * Se sirve por ruta y no como archivo en `public/` por dos razones (research
 * R4): la 020 necesitará meter el handler de push **solo cuando su bandera esté
 * encendida**, y una bandera es de servidor; y llevar la versión dentro hace que
 * un despliegue cambie los bytes, que es lo que dispara la actualización sin que
 * nadie tenga que desinstalar nada.
 *
 * **Por qué la rewrite y no una carpeta `src/app/sw.js/`**: se intentó, y un
 * segmento del App Router terminado en `.js` hace que Next crea que la petición
 * es del Pages Router — devuelve 500 con `ENOENT … pages/_document.js` **en toda
 * la aplicación**, no solo en esa ruta. Comprobado al implementar. La rewrite
 * conserva la URL `/sw.js`, que es lo único innegociable: el ámbito de un
 * service worker es la carpeta desde la que se sirve, y hace falta la raíz.
 *
 * Contrato:
 * [contracts/service-worker.md](../../../specs/019-pwa-instalable/contracts/service-worker.md)
 */

/**
 * Qué hace el handler de `fetch`, y por qué no es "nada de nada".
 *
 * La intención sigue siendo la de la spec: **no cachear absolutamente nada** y
 * no ponerse delante del canal SSE. Pero un handler que no llama nunca a
 * `respondWith` es, para Chrome, un handler vacío: lo detecta y **se salta el
 * service worker entero** por rendimiento. Con eso no habría service worker en
 * el camino — ni prompt de instalación, que es justo lo que la feature necesita.
 *
 * Así que el handler responde exactamente a UNA cosa, la navegación, y la
 * responde yendo a la red sin tocar nada. Todo lo demás —assets, APIs— se deja
 * pasar sin `respondWith`, y las rutas excluidas ni se miran.
 *
 * El arnés comprueba las dos mitades de esto: que el service worker está de
 * verdad en el camino (`workerStart > 0` en la navegación) y que aun así el
 * canal de eventos no pasa por él (`workerStart === 0`).
 */
function cuerpoDelServiceWorker(version: string): string {
  return `/*
 * Uniko — service worker. Generado por src/app/api/sw/route.ts.
 * Versión: ${version}
 *
 * NO CACHEA NADA, a propósito: el valor de este producto es el tiempo real, y
 * una bandeja que enseña mensajes viejos con confianza es peor que una que no
 * carga. Existe para que el navegador ofrezca instalar la app.
 */
const RUTAS_EXCLUIDAS = ${JSON.stringify([...SW_RUTAS_EXCLUIDAS])};

/** Copia exacta de lib/sw-scope: comparar por segmento, no por prefijo suelto. */
function debeIgnorar(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return true;
  }
  return RUTAS_EXCLUIDAS.some(
    (ruta) => pathname === ruta || pathname.startsWith(ruta + "/")
  );
}

self.addEventListener("install", (event) => {
  // Enrutado estático: se le DECLARA al navegador que estas rutas van a la red
  // sin pasar por aquí. Es más fuerte que salir del handler: con esto el worker
  // ni siquiera se consulta, así que da igual lo que el handler haga o deje de
  // hacer en el futuro. Donde no exista (Safari, Firefox), la salida temprana
  // del handler de abajo sigue siendo la garantía.
  if (typeof event.addRoutes === "function") {
    try {
      const reglas = [];
      for (const ruta of RUTAS_EXCLUIDAS) {
        reglas.push({
          condition: { urlPattern: { pathname: ruta } },
          source: "network",
        });
        reglas.push({
          condition: { urlPattern: { pathname: ruta + "/*" } },
          source: "network",
        });
      }
      const resultado = event.addRoutes(reglas);
      if (resultado && typeof resultado.then === "function") {
        event.waitUntil(resultado);
      }
    } catch {
      // Navegador que anuncia la API pero no traga estas reglas: queda la
      // salida temprana del handler, que protege igual.
    }
  }

  // Sin caché que precalentar: la versión nueva puede tomar el control ya.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * Cuántas peticiones EXCLUIDAS ha llegado a ver este handler.
 *
 * Con el enrutado estático de arriba debe ser siempre 0: el navegador las manda
 * a la red sin consultar al worker. Se cuenta —y se puede preguntar por
 * mensaje— porque es la única forma de comprobarlo DESDE FUERA: el
 * workerStart del timing se sella igual pase o no por el handler, así que no
 * sirve para distinguirlo (comprobado en Chromium 149).
 */
let excluidasVistas = 0;

self.addEventListener("message", (event) => {
  if (event.data === "uniko:diagnostico") {
    event.source && event.source.postMessage({
      tipo: "uniko:diagnostico",
      excluidasVistas,
    });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 1. El canal SSE, los webhooks y la API del bot: ni se miran. Envolver una
  //    respuesta en streaming la ata al ciclo de vida de este worker, y el
  //    navegador puede pararlo por inactividad con la conexión aparentemente
  //    viva. Es el fallo que arregló la 018, causado por nosotros.
  if (debeIgnorar(request.url)) {
    excluidasVistas++;
    return;
  }

  // 2. La navegación se responde yendo a la red, sin caché y sin tocar nada.
  //    Es lo mínimo para que el navegador no considere vacío este handler.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Todo lo demás se deja pasar tal cual.
});
`;
}

export function GET() {
  const version =
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.npm_package_version ??
    "dev";
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "";

  return new Response(cuerpoDelServiceWorker(commit ? `${version}+${commit}` : version), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Un service worker cacheado con fuerza es una versión vieja que ya nadie
      // puede desalojar.
      "cache-control": "no-cache",
    },
  });
}
