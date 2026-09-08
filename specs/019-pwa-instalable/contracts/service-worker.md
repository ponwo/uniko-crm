# Contrato — El service worker de Uniko

Lo que el service worker hace, lo que no hace nunca, y cómo se comprueba. Este
documento manda sobre el archivo: si alguien cambia el archivo, cambia esto
primero.

## Dónde vive

`GET /sw.js` — ruta del servidor, no archivo estático. El handler vive en
`/api/sw` y se sirve como `/sw.js` mediante una rewrite declarada en
`next.config.ts`.

> **Por qué la rewrite** (descubierto al implementar): una carpeta
> `src/app/sw.js/` hace que Next crea que la petición es del Pages Router y
> devuelva **500 en toda la aplicación** (`ENOENT … pages/_document.js`), no solo
> en esa ruta. La URL pública sigue siendo `/sw.js`, que es lo innegociable: el
> ámbito de un service worker es la carpeta desde la que se sirve.

| Cabecera | Valor | Por qué |
|---|---|---|
| `Content-Type` | `application/javascript` | Sin esto el navegador rechaza el registro |
| `Cache-Control` | `no-cache` | Un service worker cacheado es una versión vieja que ya nadie puede desalojar |

Ámbito: `/`. Lo da la ruta al servirse desde la raíz; no hace falta
`Service-Worker-Allowed`.

### Cómo se actualiza (y por qué el commit va DENTRO del cuerpo)

El navegador decide si hay versión nueva **comparando los bytes** de este
archivo. Por eso el cuerpo lleva `Versión: <semver>+<commit>`, resuelto con
`resolveBuildCommit()` — **el mismo camino que `/api/health`**, no la variable
congelada al construir.

La diferencia no es cosmética: Coolify publica `SOURCE_COMMIT` en el contenedor
pero no siempre lo inyecta como build-arg. Leyendo solo la variable de build, el
cuerpo salía **idéntico entre despliegues** — comprobado en LanCo, donde el
health mostraba el commit y el service worker no—, y un worker instalado en el
teléfono de un cliente se habría quedado ahí con las reglas de enrutado estático
que registró el día de su instalación. El día que esa lista cambie (la 020 va a
tocarla) nadie se enteraría de que no cambió, y diagnosticarlo en un móvil ajeno
es de lo más caro que hay.

Fijado por tests: dos commits distintos producen cuerpos distintos, y sin commit
por ningún lado la ruta sigue sirviendo con la versión sola.

## Lo que hace

| Evento | Qué hace | Por qué |
|---|---|---|
| `install` | Declara el **enrutado estático** de las rutas excluidas (`addRoutes`, ver abajo) y `skipWaiting()` | Una versión nueva no debe esperar a que se cierren todas las pestañas. Es seguro **porque no hay caché**: no hay estado a medio migrar entre versiones |
| `activate` | `clients.claim()` | Que controle la página que ya estaba abierta, en vez de esperar a la siguiente navegación |
| `fetch` | Consulta `sw-scope`; si la petición está excluida, **retorna sin tocarla**. Si es una **navegación**, la responde yendo a la red (`respondWith(fetch(request))`). Cualquier otra cosa se deja pasar sin responder | El handler existe **solo** para que Chrome ofrezca el prompt de instalación |
| `message` | Responde `{ excluidasVistas }` a `"uniko:diagnostico"` | Es lo que permite comprobar la exclusión desde fuera; ver abajo |

> **Por qué la navegación sí se responde** (descubierto al implementar): un
> handler que no llama nunca a `respondWith` es, para Chrome, un handler vacío.
> Lo detecta y **se salta el service worker entero**, con lo que no habría
> service worker en el camino ni prompt de instalación — justo lo que la feature
> necesita. Responder la navegación yendo a la red es el mínimo que lo evita, y
> no cachea nada.

## Lo que NO hace, nunca

- **No cachea.** Ni app shell, ni assets, ni respuestas de API. No hay
  `caches.open` en este archivo.
- **No responde nada que no sea la navegación**, y esa la responde yendo a la
  red. No hay página de fallo propia; Chrome ya sirve la suya.
- **No toca `/api/events`.** Ver abajo.
- **No registra nada de push.** Eso es la 020, detrás de su bandera.
- **No pide permisos.** Ninguno.

## La exclusión (requisito duro de la spec)

`sw-scope` deja fuera, siempre:

| Ruta | Por qué |
|---|---|
| `/api/events` | Es el canal SSE. Una respuesta en streaming que pasa por el service worker queda atada a su ciclo de vida, y el navegador puede pararlo por inactividad con la conexión aparentemente viva. Es la silueta exacta del fallo de la 018, causada por nosotros |
| El webhook de Meta | Tráfico de máquina que entra al servidor; no es navegación de usuario y no tiene nada que ganar pasando por aquí |
| `/api/bot/*` | Igual: superficie de máquina, autenticada por API key |

**Se excluye por partida doble.**

1. **Enrutado estático** (`InstallEvent.addRoutes` con `source: "network"`, una
   regla por ruta excluida). El navegador manda esas peticiones a la red **sin
   consultar al worker**: da igual lo que el handler haga o deje de hacer en el
   futuro. Es la garantía fuerte, y está donde no la puede romper un descuido.
2. **Salida temprana del handler**, para los navegadores que no tienen enrutado
   estático (Safari, Firefox): se retorna sin llamar a `respondWith`.

Nunca se envuelve. Una respuesta en streaming que pasa por el service worker
queda atada a su ciclo de vida, y el navegador puede pararlo por inactividad con
la conexión aparentemente viva.

## Cómo se comprueba que la exclusión se cumple

En la **misma** corrida, desde un navegador de verdad:

| Medida | Valor esperado | Qué demuestra |
|---|---|---|
| `workerStart` de la **navegación** | `> 0` | Que el service worker está de verdad en el camino. Sin esta mitad, la otra no prueba nada |
| `excluidasVistas` que reporta el propio service worker tras pedir `/api/events` varias veces | `=== 0` | Que el handler **nunca llegó a ver** esas peticiones |

> **Por qué no se usa `workerStart` para la segunda mitad** (medido en Chromium
> 149): el navegador lo sella igual pase o no la petición por el handler, así que
> no distingue lo que hay que distinguir. Se deja en el registro de la corrida
> como dato informativo, nunca como afirmación.
>
> El contador vive en el service worker por eso: es el único punto que puede
> decir, desde dentro y sin instrumentar la app, si el handler llegó a ver la
> petición. Cuesta una variable y un `message`, no cachea nada, y **el arnés
> comprueba que puede fallar**: desactivando el enrutado estático, el contador
> pasa de 0 a 3 y la corrida se pone roja.

Y, además de esta medida directa, **el arnés completo de la 018 vuelve a correr
con el service worker activo**: la muerte silenciosa se sigue detectando, el
aviso sigue apareciendo, y el catch-up sigue trayendo el hueco sin duplicados.

## Al añadir push (020)

Se añade `push` y `notificationclick` **solo cuando la bandera está encendida**,
en el mismo archivo generado. Lo que no se puede tocar al hacerlo:

- la exclusión de `/api/events`;
- la ausencia de caché;
- y la comprobación de `workerStart`, que es lo que va a avisar si algo de esto
  se rompe.
