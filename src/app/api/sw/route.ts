import { SW_RUTAS_EXCLUIDAS } from "@/lib/sw-scope";
import { APP_VERSION, resolveBuildCommit } from "@/lib/version";
import { pushEnabled } from "@/server/push/flag";

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
function cuerpoDelServiceWorker(version: string, conPush: boolean): string {
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
${conPush ? BLOQUE_PUSH : ""}`;
}

/**
 * 020 — El manejador de push, que solo se emite con la bandera encendida.
 *
 * **No toca nada de lo de arriba, y no puede tocarlo**: `push` y `fetch` son
 * eventos distintos del mismo worker, así que un manejador de push no
 * intercepta peticiones. El enrutado estático del `install` y la salida temprana
 * del `fetch` siguen intactos, y el arnés lo comprueba con la bandera
 * ENCENDIDA — porque el riesgo aquí no es técnico sino humano: alguien que abra
 * este archivo para añadir push y reescriba el `fetch` de paso.
 *
 * El aviso llega VACÍO (FR-505): el detalle se le pide a la propia instancia. Si
 * esa petición falla —sin red, sesión caducada— se muestra el texto degradado,
 * que sirve sin decir de quién es y no parece un error (FR-507).
 */
const BLOQUE_PUSH = `
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // Por defecto, lo único que se puede decir sin saber nada.
      //
      // Escrito para la vigésima vez, no para la primera (mismo filtro que
      // FR-423): quien lo lee ya sabe qué es esta app. No se le explica el
      // mecanismo —"el agente derivó la conversación"— porque a la vigésima eso
      // es ruido; se le dice qué hacer. Y no dice de quién es porque en este
      // caso no se pudo saber: fingirlo sería peor.
      let titulo = "Alguien necesita atención";
      let cuerpo = "Abre la bandeja para ver quién.";
      let conversationId = null;

      try {
        const res = await fetch("/api/push/pendiente", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data && data.pendiente) {
            titulo = data.pendiente.titulo;
            cuerpo = data.pendiente.cuerpo;
            conversationId = data.pendiente.conversationId;
          }
        }
      } catch (e) {
        // Sin red: se queda el texto degradado. Mostrar algo es obligatorio.
      }

      await self.registration.showNotification(titulo, {
        body: cuerpo,
        // Una conversación, una notificación: donde el sistema lo respete, la
        // nueva REEMPLAZA a la anterior. iOS lo ignora y apila; funciona igual.
        tag: conversationId ? "uniko:conv:" + conversationId : "uniko:escalacion",
        data: { conversationId },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.conversationId;
  const destino = id ? "/inbox?conversation=" + id : "/inbox";

  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Si ya hay una ventana abierta se enfoca y se la lleva al hilo: abrir una
      // segunda pestaña de la misma app es la forma más rápida de que el
      // operador pierda lo que tenía a medias.
      for (const cliente of clientes) {
        if ("focus" in cliente) {
          await cliente.focus();
          if ("navigate" in cliente) await cliente.navigate(destino);
          return;
        }
      }
      await self.clients.openWindow(destino);
    })()
  );
});
`;

export function GET() {
  /*
   * La versión se resuelve por el MISMO camino que `/api/health`, no leyendo
   * `NEXT_PUBLIC_BUILD_COMMIT` a mano.
   *
   * Leerla a mano tenía una consecuencia que solo se vio en LanCo desplegada:
   * Coolify publica `SOURCE_COMMIT` en el contenedor pero no siempre lo inyecta
   * como build-arg, así que la variable congelada al construir venía vacía. El
   * health sí enseñaba el commit —usa el respaldo de runtime— y este archivo
   * no. Resultado: **el cuerpo del service worker salía idéntico entre
   * despliegues**.
   *
   * Y eso importa más de lo que parece: el navegador decide si hay versión
   * nueva **comparando los bytes** de este archivo. Con un cuerpo constante, el
   * worker instalado en el teléfono de un cliente se queda ahí con las reglas
   * de enrutado estático que registró el día que se instaló — y el día que esa
   * lista cambie (la 020 va a tocarla), nadie se enteraría de que no cambió.
   * Un worker pegado en un móvil ajeno es de lo más difícil de diagnosticar.
   */
  const commit = resolveBuildCommit();

  return new Response(
    cuerpoDelServiceWorker(
      commit ? `${APP_VERSION}+${commit}` : APP_VERSION,
      pushEnabled()
    ),
    {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        // Un service worker cacheado con fuerza es una versión vieja que ya
        // nadie puede desalojar.
        "cache-control": "no-cache",
      },
    }
  );
}
