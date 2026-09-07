# 019 — Research (Fase 0)

Lo que hubo que averiguar antes de diseñar, y cómo se averiguó. Todo se
comprobó el **2026-09-07**; donde hay una fuente, está enlazada.

## R0. Lo primero: ¿qué tienen cargado de verdad las instancias?

**Se verificó antes que nada porque podía cambiar el alcance, y lo cambió.**

Método: pedir la ruta pública `/api/branding/favicon` a cada instancia viva y
mirar qué devuelve. No es una suposición ni una lectura de la base de datos de un
cliente: es el icono que sirven ahora mismo, por la misma URL que ve cualquier
navegador.

| Instancia | `content-type` | Contenido | Lectura |
|---|---|---|---|
| `uniko.lanco.cloud` | `image/svg+xml` | SVG generado, letra **L**, acento `#3f6b66` | marca propia, sin archivo subido |
| `uniko.ilovetheuniverse.mx` | `image/svg+xml` | SVG generado, letra **I**, acento `#0d9ae0` | marca propia, sin archivo subido |
| `uniko.nuriaandrea.com` | `image/svg+xml` | logo de Uniko, acento por defecto `#0d5bff` | **sin marca configurada todavía** |

**Decisión**: ninguna instancia tiene icono raster, así que el manifiesto no
puede depender de que exista uno. La imagen lleva un par de PNG por defecto (192
y 512) que viajan en el build, y el icono del dueño manda solo cuando sirve.

**Alternativas descartadas**:

- *Pedir PNG y esperar*: con eso, hoy **ninguna de las tres instancias sería
  instalable** — no es que el icono se viera feo: no habría botón, que es la
  mitad de la feature.
- *Rasterizar el SVG en el servidor*: decisión del dueño de no hacerlo todavía, y
  coincide con el Principio II. Se reconsidera solo si el degradado se ve mal en
  el nivel 3, y entonces con el problema delante.

**Consecuencia para el plan**: `public/` **sí** viaja a producción — el
`Dockerfile` lo copia explícitamente al runner (línea `COPY … /app/public
./public`). Los PNG por defecto son, por tanto, un archivo estático y no
dependen del volumen de medios, que es justo el que se pierde cuando alguien
olvida montarlo.

## R1. ¿Sigue haciendo falta un handler de `fetch` para el botón de instalar?

**Sí, y solo eso.** Chrome quitó el requisito de service worker para instalar
**desde el menú** (108 en móvil, 112 en escritorio), pero el algoritmo que
dispara `beforeinstallprompt` sigue exigiendo que exista un handler de `fetch`.
La documentación lo dice con esas palabras y añade que es un área en la que
están trabajando para incorporar nuevas señales.

**Lo que se comprobó expresamente porque habría cambiado el diseño**: Chrome
**no** exige que el sitio funcione sin conexión. Hubo una línea de trabajo sobre
"detección de capacidad offline" antes de mostrar el prompt; lo que hay hoy es
que Chrome sirve una página de fallo propia para sitios que no implementan la
suya. Si exigiera funcionar offline, un handler que no cachea nada no valdría y
esta feature tendría que elegir entre cachear o quedarse sin botón. No es el
caso.

Fuente: [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria)

**Riesgo asumido y anotado**: el criterio está declaradamente en movimiento. Si
un Chrome futuro pide más, el degradado es conocido y no es una caída: la app
sigue instalándose desde el menú del navegador, y el nivel 3 lo detectaría.

## R2. Iconos: qué acepta cada plataforma

- Chrome quiere PNG de **192 y 512** px en el manifiesto. El soporte de SVG en la
  lista de iconos del manifiesto no es fiable entre plataformas; PNG lo es.
- iOS ignora el manifiesto para el icono de la pantalla de inicio: usa
  `apple-touch-icon`, y quiere **PNG**. Sin él, el sistema usa una captura de la
  página — el "roto" que la spec prohíbe.

**Decisión**: el manifiesto declara PNG y nada más. El SVG de marca se queda
donde ya funciona, que es el icono de la pestaña.

**Detalle que resuelve el caso del icono subido**: un mismo archivo puede
declararse para las dos medidas (`"sizes": "192x192 512x512"`), que es
exactamente para lo que existe ese campo con varios valores. Así, cuando el dueño
sube un PNG grande, **su icono es el único declarado** y no hay forma de que el
navegador elija el logo de Uniko para el hueco de 192.

Fuentes:
[What does it take to be installable?](https://web.dev/articles/install-criteria) ·
[Web app manifest (web.dev)](https://web.dev/learn/pwa/web-app-manifest)

## R3. ¿Se puede saber si el PNG del dueño sirve, sin librería de imagen?

**Sí.** Un PNG lleva su ancho y su alto en el primer chunk (`IHDR`), en los bytes
16–23, big-endian. Leerlos son diez líneas y cero dependencias — y el repo ya
hace algo del mismo estilo en `sniffFaviconMime`, que decide el tipo mirando los
primeros bytes en vez de fiarse del `content-type`.

Con eso, "este icono no sirve para instalar" deja de ser una corazonada y pasa a
ser una comprobación exacta: es PNG, es cuadrado, y mide 512 o más.

**Alternativa descartada**: pedirle al dueño que jure que su PNG es grande. Un
aviso que no puede comprobar lo que afirma acaba saliendo cuando no toca, y
entonces se ignora.

**Restricción que ya existe y no estorba**: el límite de subida es de 256 KB
(`MAX_FAVICON_BYTES`), de sobra para un PNG de 512×512.

## R4. Dónde vive el service worker

**En una ruta, `/sw.js`, no en `public/`.**

El ámbito de un service worker es la carpeta desde la que se sirve, así que tiene
que salir de la raíz para controlar toda la app. Eso lo cumplen las dos
opciones. La ruta gana por dos razones concretas:

1. **La 020 lo va a necesitar dinámico**. El handler de push tiene que existir
   solo con su bandera encendida (FR-411), y una bandera es de servidor. Con un
   archivo estático, la 020 tendría que mover el service worker de sitio; con una
   ruta, solo añade lo suyo.
2. **La actualización se vuelve observable**. El navegador se baja el archivo y
   compara bytes; si el contenido lleva la versión de la app, un despliegue nuevo
   cambia el archivo y dispara la actualización sin que nadie desinstale nada
   (FR-410).

**Alternativa descartada**: `public/sw.js`. Más simple hoy, pero mueve el
problema a la 020 y deja la actualización dependiendo de que el contenido cambie
por casualidad.

**Cabecera obligatoria**: `Content-Type: application/javascript` y
`Cache-Control: no-cache`. Un service worker cacheado por mucho tiempo es la
forma clásica de quedarse con una versión vieja que ya nadie puede desalojar.

**Corregido al implementar**: la ruta **no puede** ser `src/app/sw.js/route.ts`.
Un segmento del App Router terminado en `.js` hace que Next crea que la petición
es del Pages Router y devuelva **500 en toda la aplicación** (`ENOENT …
pages/_document.js`). El handler vive en `/api/sw` y se sirve como `/sw.js` con
una rewrite de `next.config.ts`; la URL pública, que es lo que fija el ámbito, no
cambia.

## R5. Cómo se demuestra que el canal de eventos NO pasa por el service worker

Es el requisito duro de la spec (FR-413, FR-414) y hacía falta una forma de
observarlo desde fuera, no de razonarlo.

> **Corregido al implementar (2026-09-07).** Lo que sigue era la decisión, y la
> primera mitad se mantiene; la segunda **resultó falsa y se cambió**. Se deja
> escrito el error porque explica por qué el service worker lleva un contador.

**Decisión original**: `PerformanceResourceTiming.workerStart`, dando por hecho
que el navegador lo pone distinto de cero **solo** cuando la petición pasó por el
service worker. Así, en la misma corrida y desde el navegador de verdad:

- una petición cualquiera de la app tiene `workerStart > 0` → el service worker
  está de verdad en el camino (si no, la prueba no probaría nada);
- la petición de `/api/events` tiene `workerStart === 0` → no pasó por él.

**Y no funcionó.** Medido en Chromium 149: `workerStart` se sella igual para
`/api/events` pase o no por el handler. Sirve para la primera mitad —la
navegación, que el service worker sí responde— y **no distingue nada** en la
segunda.

**Decisión final**, con las dos mitades de FR-414 intactas pero medidas distinto:

| Mitad | Cómo se mide |
|---|---|
| El service worker está en el camino | `workerStart > 0` en la **navegación** |
| El canal de eventos no pasó por él | el propio service worker reporta `excluidasVistas === 0` tras pedirlo varias veces |

Y la exclusión deja de depender del handler: se declara con **enrutado estático**
(`InstallEvent.addRoutes` con `source: "network"`), que hace que el navegador
mande esas rutas a la red sin consultar al worker. La salida temprana del handler
se queda como garantía para los navegadores sin esa API.

**El contador se comprobó falsificable**: desactivando el enrutado estático, pasa
de 0 a 3 y la corrida se pone roja. Un check que no puede fallar no es un check —
la lección de las dos suscripciones de la 018.

**Alternativas descartadas**:

- *Que el service worker cuente lo que intercepta y lo mande por `postMessage`*:
  mide lo que el service worker cree, no lo que el navegador hizo. Y obliga a
  meter código de instrumentación en el archivo que precisamente queremos
  trivial.
- *Mirar solo que la bandeja siga funcionando*: es el síntoma, no la causa, y
  pasaría igual con un service worker que envuelve el SSE y todavía no ha sido
  parado por inactividad. Ese es el fallo que aparece a los diez minutos, no a
  los diez segundos.

## R6. Detectar iOS y "ya instalada"

- **Instalada**: `display-mode: standalone` por media query, y en iOS además
  `navigator.standalone`. Con eso se apagan el botón y las instrucciones
  (FR-404).
- **iOS**: por `userAgent`, contando con que un iPad moderno se anuncia como Mac
  — se distingue por tener pantalla táctil. Se aísla en una función pura para
  poder probarla sin navegador (nivel 1).

**Alternativa descartada**: decidir por ancho de pantalla. Un Android en una
tablet ancha se llevaría las instrucciones de iPhone.

## R7. El re-login de iOS

Confirmado que el almacenamiento no se comparte entre Safari y la app instalada,
y —dato nuevo, que no estaba en la investigación previa— que **iOS descarta
almacenamiento y registro del service worker tras ~7 días sin usar la web**.

**Consecuencia de diseño**: el texto de la pantalla de login no puede estar
redactado como una bienvenida. La misma pantalla la ve quien acaba de instalar y
quien vuelve tras dos semanas, y para el segundo un "la primera vez hay que
entrar de nuevo" es peor que no decir nada: le hace buscar un fallo que no
existe.

Fuente: [PWA iOS limitations and Safari support](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)

## R8. Probar la instalación de verdad

`localhost` es contexto seguro: el service worker se registra y se depura ahí, y
el arnés del nivel 2 corre ahí. **Instalar** en un teléfono necesita HTTPS.

**Decisión** (ya en la spec, aquí con el cómo): túnel HTTPS contra la app local
para la primera pasada —es donde se van a descubrir el icono, el nombre y el
recorte del `short_name`—, y confirmación final en **LanCo** ya desplegada, que
es la que estrena y la única con marca de un negocio real. Ninguna prueba toca
las instancias de clientes.
