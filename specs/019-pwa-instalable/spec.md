# 019 — PWA instalable en Android e iOS

**Feature Branch**: `019-pwa-instalable`

**Created**: 2026-09-07

**Status**: Draft

**Carril**: ciclo completo. No toca el modelo de datos —no hay migración—, pero
sí un **contrato publicado**: un service worker con handler de `fetch` se
interpone delante de **toda** la red de la app, y ahí dentro están el SSE
(`specs/001-uniko-core/contracts/sse.md`), `/api/bot/*` y el webhook de Meta. El
handler puede cambiar el comportamiento observable de esos contratos sin tocar
una línea de su código, que es exactamente la clase de cambio que el Principio VI
manda planificar antes.

**Escrito antes del código.**

## Problema

Uniko se usa desde el teléfono. Hoy vive en una pestaña del navegador: se pierde
entre otras diez, no tiene icono en la pantalla de inicio, y la barra de
direcciones se come una franja de la pantalla en la vista donde más falta hace
—la bandeja—. Abrirla es acordarse de que existe y buscarla.

Instalarla como aplicación resuelve eso y desbloquea lo siguiente: en iOS, el
Push API **solo existe si la app está instalada en standalone**. La 020
(notificaciones) no puede empezar hasta que esta termine.

Lo caro no es instalar. Lo caro es lo que hay que poner para tener **botón
propio** de instalar: un service worker con handler de `fetch`, es decir, código
nuestro delante de cada petición de red que hace la app. Incluida
`/api/events`, el canal que la 018 acaba de endurecer.

Un handler de `fetch` mal escrito delante del SSE reproduce el fallo de la 018 en
una versión peor: allí la conexión moría y no nos enterábamos; aquí la conexión
ni siquiera llegaría al servidor, y el operador vería la misma bandeja quieta con
la misma cara de estar al día. **Esta feature vale lo que vale su capacidad de no
romper eso**, y por eso la exclusión del SSE está escrita abajo como
comportamiento observable con criterio propio, no como detalle de
implementación.

## La investigación previa, y qué se comprobó hoy

La investigación de instalabilidad se hizo antes de la 018. **No está escrita en
este repositorio**: solo sobrevivieron sus consecuencias —
[`memory/pwa-en-movil-necesita-https.md`](../../memory/pwa-en-movil-necesita-https.md)
y la nota de "Fuera de alcance" de la
[spec de la 018](../018-reconexion-sse-resiliente/spec.md). Se recogen aquí sus
cuatro conclusiones para que dejen de vivir en la cabeza de una persona, y se
dejan **verificadas con fecha 2026-09-07**.

| Conclusión previa | Estado hoy |
|---|---|
| Ningún navegador exige service worker para *poder* instalar | **Vigente.** Chrome quitó ese requisito para la instalación desde el menú (108 en móvil, 112 en escritorio) |
| El algoritmo que dispara `beforeinstallprompt` **sí** exige handler de `fetch` | **Vigente.** Sigue siendo el requisito para el prompt, no para el menú |
| En iOS no existe `beforeinstallprompt` | **Vigente.** La instalación es Compartir → Añadir a pantalla de inicio, a mano |
| En iOS el almacenamiento **no se comparte** entre Safari y la app instalada | **Vigente.** Son contextos separados |

**Nada de la investigación previa resultó desactualizado.** Aparecieron tres
datos que no estaban en ella y que sí cambian lo que hay que escribir:

1. **iOS descarta el almacenamiento y el registro del service worker tras ~7 días
   sin usar la web.** Se suma al punto 4: no solo hay que iniciar sesión otra vez
   al instalar, también después de una semana larga sin abrir la app.
2. **Borrar el historial de Safari borra las cachés de la PWA.** Irrelevante para
   esta feature justamente porque no vamos a cachear nada — y es una razón más
   para no hacerlo.
3. **Push en iOS 16.4+ funciona, pero solo con la app instalada.** Confirma la
   dependencia 020 → 019 en la dirección que suponíamos.

Fuentes consultadas hoy:
[Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria) ·
[What does it take to be installable? (web.dev)](https://web.dev/articles/install-criteria) ·
[PWA iOS limitations and Safari support](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)

## Escenarios

1. **Instalar en Android**: el operador abre Uniko en Chrome, ve un botón de
   instalar **dentro de la app** (no escondido en el menú del navegador), lo
   pulsa, acepta, y la app queda en la pantalla de inicio con el icono y el
   nombre de **su negocio**. Al abrirla no hay barra de direcciones.
2. **Instalar en iOS**: el operador abre Uniko en Safari en un iPhone. No hay
   botón —el sistema no lo permite—, así que la app le enseña las instrucciones
   exactas de su plataforma: Compartir → Añadir a pantalla de inicio.
3. **Iniciar sesión otra vez, sin creer que es un fallo**: en iOS el operador
   aparece deslogueado en la app instalada aunque en Safari siguiera dentro. Le
   pasa **la primera vez** —Safari y la app instalada no comparten
   almacenamiento— y le vuelve a pasar **cada vez que deja la app más de una
   semana sin abrir**, porque iOS descarta el almacenamiento y el registro del
   service worker tras ~7 días de inactividad. La pantalla de login se lo
   explica sin dar por hecho que es su primera vez.
4. **La bandeja sigue viva dentro de la app instalada**: con la app abierta desde
   la pantalla de inicio entra un mensaje de un cliente y aparece **solo**, igual
   que en el navegador. Todo lo que la 018 arregló sigue arreglado.
5. **Ya instalada, no se insiste**: quien ya tiene la app instalada no vuelve a
   ver el botón ni las instrucciones. Un aviso que sale cuando ya hiciste lo que
   pide es ruido, y enseña a ignorar el siguiente.
6. **El dueño cambia su marca**: cambia el nombre o el color de acento en Ajustes
   y la app instalada refleja la marca nueva sin reconstruir ni redesplegar la
   imagen.

## Requisitos

### Instalar

- **FR-401** La aplicación DEBE ser instalable en Android (Chrome) y en iOS
  (Safari), sirviendo un manifiesto válido con nombre, icono, color de tema y
  modo de presentación sin barra de navegador.
- **FR-402** En Android, la app DEBE ofrecer **su propio botón** de instalar,
  visible dentro de la interfaz, disparado por el evento que el navegador emite
  cuando la instalación es posible.
- **FR-403** En iOS, donde ese evento no existe, la app DEBE mostrar
  **instrucciones** con la secuencia real de esa plataforma, elegidas por
  detección de plataforma y no por adivinanza del tamaño de pantalla.
- **FR-404** Ni el botón ni las instrucciones DEBEN aparecer cuando la app ya
  está corriendo instalada.
- **FR-405** El operador DEBE poder descartar el aviso de instalación, y la app
  DEBE respetar ese descarte en visitas siguientes.
- **FR-406** Abierta desde la pantalla de inicio, la app DEBE presentarse sin
  barra de direcciones, con el color de marca en la barra de estado.

### El service worker: qué hace, y sobre todo qué no

- **FR-407** La app DEBE registrar un service worker, cuyo **único** propósito es
  satisfacer el requisito del prompt de instalación.
- **FR-408** El handler de `fetch` **NO DEBE cachear nada**: toda petición va a
  la red tal cual. No hay caché de app shell, ni de assets, ni de API.
- **FR-409** Con el service worker activo, el comportamiento observable de la app
  DEBE ser **indistinguible** del que tiene sin él, salvo por poder instalarse.
  Misma latencia percibida, mismos errores, mismos datos.
- **FR-410** El service worker DEBE poder actualizarse solo: una versión nueva
  desplegada NO DEBE requerir que el operador desinstale ni borre datos del
  sitio.
- **FR-411** El service worker DEBE estar escrito de forma que la 020 pueda
  añadirle el manejo de push **detrás de su bandera**, sin que esta feature pida
  hoy permiso de notificaciones ni registre nada de push.

### La exclusión del canal de eventos (requisito duro)

- **FR-412** El service worker **NO DEBE interponerse en `/api/events`**. La
  petición del canal SSE DEBE llegar a la red sin pasar por el handler: no se
  responde, no se envuelve, no se reintenta desde ahí.
- **FR-413** Esa exclusión DEBE ser **deliberada y verificable**, no un efecto
  colateral de "no cachear". Debe existir una comprobación automática que falle
  si alguien, en el futuro, hace que el canal de eventos empiece a pasar por el
  service worker.
- **FR-414** La comprobación DEBE demostrar las **dos** mitades: que el service
  worker está activo y controlando la página (si no, no prueba nada), y que aun
  así el canal de eventos no pasó por él.
- **FR-415** El mismo trato DEBEN recibir las superficies de larga duración o de
  máquina que hoy existen: el webhook de Meta y `/api/bot/*` no son navegación de
  usuario y no tienen nada que ganar pasando por el service worker.

### Volver a entrar en iOS, sin parecer un fallo

- **FR-422** En iOS, cuando la app corre instalada y no hay sesión, la pantalla
  de login DEBE explicar por qué se pide entrar de nuevo: la app instalada tiene
  su propia sesión, separada de la del navegador.
- **FR-423** Ese texto DEBE servir igual la quinta vez que la primera. **NO DEBE**
  redactarse como un mensaje de bienvenida ni dar por hecho que el operador acaba
  de instalar: la misma pantalla la va a ver quien vuelve tras una semana sin
  abrir la app, y decirle "bienvenido, la primera vez hay que entrar de nuevo" le
  hace pensar que algo se rompió.
- **FR-424** El mensaje NO DEBE aparecer fuera de ese caso: en el navegador, o
  con sesión válida, la pantalla de login es la de siempre.

### La marca de la instancia

- **FR-416** El manifiesto DEBE llevar el nombre y el color de acento **de la
  organización de la instancia**, no los valores por defecto de Uniko cuando el
  dueño ha configurado los suyos.
- **FR-417** Un cambio de marca en Ajustes DEBE reflejarse en la app instalada
  sin reconstruir la imagen ni redesplegar.
- **FR-418** El icono de la app instalada DEBE ser el de la marca de la
  instancia **cuando el dueño ha subido uno que sirva**; si no, el degradado
  está definido abajo (FR-425 a FR-429) y es deliberado, no un fallo.
- **FR-419** El manifiesto DEBE ser una ruta **pública**: se pide antes de haber
  iniciado sesión, igual que ya pasa con el favicon.

### No romper la 018

- **FR-420** Con el service worker instalado y activo, la detección de muerte
  silenciosa, el aviso de conexión y el catch-up de la 018 DEBEN seguir
  comportándose igual.
- **FR-421** Esa no regresión DEBE probarse **ejecutando el arnés de la 018 con
  el service worker activo**, no razonando que debería funcionar.

## Decisión: el manifiesto se sirve por ruta dinámica, no como archivo estático

**Se sirve como ruta dinámica**, con el mismo patrón que ya resolvió
`/api/branding/favicon`: `force-dynamic`, marca leída de
`organization.metadata`, cacheable fuerte solo cuando la URL lleva `?v=` que
cambia con la marca.

Un `public/manifest.json` fijo se congela en el build. Como una imagen sirve a
las tres instancias de la flota (LanCo, ILTU, NuriaAndrea), el nombre y el color
de la app instalada serían los de Uniko en todas, o habría que construir una
imagen por cliente — que es exactamente lo que el white-label existe para evitar.
El patrón dinámico ya está probado en producción para el favicon, incluida la
parte incómoda: la invalidación de caché con `?v=`.

Coste asumido: el manifiesto pega a la base de datos. Es una lectura por
instalación, no por navegación, y ya se paga una igual por el favicon en cada
carga.

## Decisión: el handler de `fetch` no cachea nada

El handler existe **solo** porque el algoritmo del prompt de instalación exige
que exista. Cachear sería aprovechar que ya está ahí, y es justo lo que no hay
que hacer en una app cuyo valor es el tiempo real: una bandeja que enseña
mensajes viejos con confianza es peor que una que no carga. La segunda se ve rota
y el operador recarga; la primera se ve bien y el operador no contesta a un
cliente que sí escribió.

Que el handler sea trivial es una decisión de producto, no pereza. Y hace que la
exclusión del SSE sea comprobable de verdad: un handler que no hace nada más solo
puede fallar de una forma.

## Decisión: cómo se excluye el canal de eventos

**Salida temprana**: el handler mira la petición y, si es el canal de eventos,
**no la toca** —no la responde— y el navegador la resuelve como si el service
worker no existiera.

La alternativa aparente —envolverla y devolver la respuesta de red tal cual— es
peor de una forma que no se ve en una prueba corta: una respuesta en streaming
que pasa por el service worker queda atada al ciclo de vida de ese worker, y el
navegador puede pararlo por inactividad mientras la conexión sigue "abierta". Es
la misma silueta del fallo de la 018 —una conexión que parece viva y no
entrega—, ahora causada por nosotros. Se rechaza.

Y se rechaza también **confiar en que "no cachear" basta**. Basta hoy, con el
handler que vamos a escribir. La 020 va a tocar este archivo para añadir push, y
alguien con prisa puede envolver todas las peticiones sin pensar en el SSE. Por
eso FR-413: la exclusión tiene su propia comprobación, y esa comprobación se
rompe si el descuido llega.

## Constitution Check

- **Soberanía (II)**: no entra ningún tercero. El manifiesto, el service worker y
  los iconos se sirven desde la propia instancia. Sin CDN, sin librería de PWA,
  sin servicio de push (eso es la 020, con su propio ADR).
- **Seguridad (I)**: el service worker no guarda nada, así que no hay dato de
  cliente en una caché del navegador que sobreviva al cierre de sesión. El
  manifiesto es público y expone lo mismo que ya expone el favicon: nombre y
  color del negocio, que en una instancia de un solo negocio no son secreto.
- **Multi-tenancy (III)**: la marca sale de la organización de la instancia por
  el camino que ya existe (`getBrandingContext`).
- **Idempotencia (IV)**: no hay escritura. El registro del service worker es
  idempotente por definición del navegador.
- **Módulos opcionales (015, 016)**: esta feature **no va detrás de bandera** —
  ser instalable no es un módulo opcional, es la app. Lo que sí respeta el patrón
  es el gancho que la 020 necesitará (FR-411).
- **Irreversibilidad ante datos (X)**: no toca `drizzle/`. No hay migración.
- **Definición de Hecho (IX)**: el nivel 3 en dispositivo real es obligatorio y
  está planificado desde ahora, no descubierto al final.

## Verificación

Tres niveles, como en la 018. Ninguno sustituye al siguiente.

### Nivel 1 — Unidad

La decisión de qué intercepta el service worker se extrae a una **función pura**
—dada una petición, ¿se toca o no?— y se prueba sin navegador, con el canal de
eventos, el webhook y `/api/bot/*` entre los casos que DEBEN quedar fuera. Igual
que la 018 extrajo el vigilante a `lib/sse-watchdog`, y por la misma razón: es la
parte que no puede depender de que alguien se acuerde de mirarla.

También por unidad: el manifiesto lleva la marca de la organización, su
`content-type` es el correcto, y la detección de plataforma distingue iOS de
Android de escritorio.

### Nivel 2 — Local, con el arnés que montamos para la 018

`localhost` cuenta como contexto seguro, así que el service worker se registra,
se activa y se depura ahí. Se extiende el arnés (`pnpm test:e2e`) con:

- el service worker se registra y **controla** la página;
- el manifiesto responde, es válido, y lleva el nombre y el acento de la
  instancia;
- con el service worker activo, **la petición del canal de eventos no pasó por
  él** (FR-413, FR-414) — las dos mitades en la misma corrida;
- el botón de instalar aparece cuando el navegador dice que se puede, y NO
  aparece en modo instalado;
- con la plataforma emulada como iPhone, salen las instrucciones y no el botón;
- **y el arnés completo de la 018 vuelve a correr, entero, con el service worker
  instalado** (FR-421). Si la muerte silenciosa deja de detectarse con el service
  worker delante, esta feature no está hecha.

### Nivel 3 — Dispositivo real (OBLIGATORIO)

Instalar de verdad necesita **HTTPS**, y `localhost` no lo da. Está anotado desde
antes de empezar en
[`memory/pwa-en-movil-necesita-https.md`](../../memory/pwa-en-movil-necesita-https.md),
y aquí se decide **cómo**, no se deja para el final como pasó con el nivel 3 de
la 018:

1. **Primera pasada: túnel HTTPS** contra la app local. Es el camino barato y no
   toca ninguna instancia con datos de clientes. Sirve para lo que más se va a
   equivocar —icono, nombre, color, standalone, instrucciones de iOS— y permite
   iterar en minutos.
2. **Confirmación final: LanCo**, ya desplegada y con HTTPS propio, después del
   merge a `main` y antes de dar la feature por Hecha. LanCo es la que estrena
   (`memory` de la flota), y es el único sitio donde se prueba con la marca real
   de un negocio real.

Qué hay que registrar en el guion de la historia, en las dos plataformas:
versión de iOS y de Android, si el icono y el nombre eran los del negocio, si
abrió sin barra de direcciones, si hubo que iniciar sesión otra vez en iOS
—confirmando el comportamiento del sistema, no un fallo nuestro—, y **si entró
un mensaje real estando la app instalada y apareció solo**.

Ese último punto es el nivel 3 de la no regresión del SSE: con el service worker
de verdad instalado en un teléfono de verdad.

### Gate técnico

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, desde la ruta real
`C:\G\gApps\LanCo\Uniko-CRM`. Es el piso, no el techo.

## Criterios de éxito

- **SC-001** En un Android real, el operador instala la app desde un botón de la
  propia app —sin abrir el menú del navegador— y la abre desde la pantalla de
  inicio.
- **SC-002** En un iPhone real, el operador instala la app siguiendo las
  instrucciones que la app le muestra, sin ayuda externa.
- **SC-003** La app instalada muestra el nombre y el icono **del negocio**, no
  los de Uniko, en una instancia con marca configurada.
- **SC-004** Un cambio de marca se ve reflejado sin redesplegar.
- **SC-005** Con el service worker activo, el arnés completo de la 018 pasa
  entero. Un fallo aquí bloquea la feature.
- **SC-006** Existe una comprobación automática que falla si el canal de eventos
  empieza a pasar por el service worker, y que a la vez demuestra que el service
  worker estaba activo.
- **SC-007** Con la app instalada en un teléfono real, entra un mensaje y aparece
  solo, sin recargar.
- **SC-008** Quien ya tiene la app instalada no ve el botón ni las instrucciones.
- **SC-009** La app nunca pide permiso de notificaciones en esta feature.
- **SC-010** Las tres instancias de la flota son instalables **hoy**, con lo que
  tienen cargado, sin que sus dueños suban nada.
- **SC-011** Una instancia sin icono raster se instala con el logo de Uniko y el
  nombre del negocio — nunca con una captura de pantalla ni un icono ausente— y
  su pantalla de marca dice qué subir para cambiarlo.
- **SC-012** El texto que explica el re-login de iOS se lee igual de bien la
  quinta vez que la primera: no supone que el operador acaba de instalar.

## Fuera de alcance

- **Caché offline de contenido.** Es lo que más promete y peor envejece en una
  app cuyo valor es el tiempo real: una bandeja que muestra mensajes viejos con
  confianza es peor que una que no carga. Se rechaza a propósito, no por falta de
  tiempo.
- **Notificaciones push.** Son la **020**, con su propio ADR por el Principio II.
  Esta feature solo deja el gancho para que aquella pueda registrar su handler
  detrás de su bandera (FR-411). En iOS, push solo existe con la app instalada:
  la 020 depende de esta.
- **Cola de envíos sin conexión.** Guardar mensajes salientes para mandarlos
  luego es un problema de entrega y de duplicados, no de instalación.
- **Empaquetado para tiendas** (TWA, App Store). Otro producto y otro
  calendario.
- **Arreglar que iOS pida iniciar sesión otra vez.** No tiene arreglo: es
  comportamiento del sistema. Se documenta como comportamiento observable
  (escenario 3) para que nadie lo reporte como bug.
- **Rediseñar vistas para standalone.** La app ya es responsive; ganar la franja
  de la barra de direcciones no cambia el diseño.

## Lo que encontramos en el código

Hallazgos de la lectura previa, que la spec da por ciertos y el plan debe
confirmar:

- **El patrón de marca dinámica ya está resuelto y probado.**
  `src/app/api/branding/favicon/route.ts` es `force-dynamic`, lee la marca con
  `getBrandingContext()`, y decide la cabecera de caché según venga o no el
  `?v=`. El manifiesto puede calcarlo.
- **La marca ya viaja al HTML.** `src/app/layout.tsx` es `force-dynamic` y su
  `generateMetadata` ya inyecta el favicon con `?v=`. Es el sitio natural para
  enlazar el manifiesto.
- **No hay nada de PWA todavía.** `public/` solo tiene `robots.txt`. No hay
  manifiesto, ni iconos, ni service worker.
- **El service worker necesita ámbito raíz** para controlar toda la app, así que
  tiene que servirse desde la raíz del sitio. Con App Router eso es una ruta, no
  un archivo suelto en `public/`, si además queremos decidir su contenido en
  servidor.
- **La página tiene DOS suscripciones SSE vivas** —la bandeja y el contador de la
  barra de navegación—, cosa que descubrimos automatizando el nivel 2 de la 018.
  Cualquier comprobación de "el canal no pasa por el service worker" tiene que
  contar con las dos.
- **La ruta del favicon ya manda CSP y `nosniff`** para un SVG subido por el
  dueño. Los iconos del manifiesto salen por ese mismo camino y heredan esa
  decisión.
- **La subida de icono ya acepta PNG** (`FAVICON_MIMES` en `src/lib/favicon.ts`
  lista `image/png`), así que la opción (a) de la pregunta abierta no necesita
  código nuevo: solo decirlo donde el dueño sube el icono.

## Decisión: los iconos son PNG, y siempre hay uno

Esto estaba planteado como pregunta abierta. Se cierra aquí porque **lo que hay
cargado hoy en la flota cambia el alcance**, y descubrirlo en el plan habría sido
tarde.

### Qué tienen de verdad las tres instancias (comprobado el 2026-09-07)

Se consultó la ruta pública `/api/branding/favicon` de cada instancia viva. No es
una suposición ni una lectura de base de datos: es el icono que sirven ahora
mismo.

| Instancia | Qué sirve hoy | Lectura |
|---|---|---|
| `uniko.lanco.cloud` | SVG generado, letra **L** sobre acento propio (`#3f6b66`) | marca configurada, **sin archivo subido** |
| `uniko.ilovetheuniverse.mx` | SVG generado, letra **I** sobre acento propio (`#0d9ae0`) | marca configurada, **sin archivo subido** |
| `uniko.nuriaandrea.com` | SVG del logo de Uniko, acento por defecto (`#0d5bff`) | **sin marca configurada todavía** |

**Ninguna de las tres tiene un icono raster.** Las tres sirven SVG generado por
nosotros. Y NuriaAndrea, además, todavía no tiene marca propia — dato que también
conviene tener presente antes de promover nada.

### Por qué eso cambia el alcance

Chrome no declara instalable un sitio cuyo manifiesto no ofrezca iconos PNG de
192 y 512 px, y el soporte de SVG en la lista de iconos del manifiesto no es
fiable entre plataformas. Es decir: con la opción "pedir PNG al dueño" a secas,
**hoy no habría botón de instalar en ninguna de las tres instancias** — no un
icono feo: ningún botón, que es la mitad de esta feature. Y en iOS, un
`apple-touch-icon` ausente hace que el sistema use una captura de la página como
icono, que es exactamente el "roto" que hay que evitar.

### Lo que se hace

- **Se descarta rasterizar en el servidor** (decisión del dueño, y coincide con
  el Principio II): traería una dependencia de imagen al runtime por un problema
  que quizá no tengamos. Si el degradado se ve mal en el túnel, se rasteriza
  entonces y sabiendo por qué.
- **La imagen lleva siempre un par de PNG por defecto** (192 y 512) con el logo
  de Uniko. No dependen de la base de datos ni del volumen de medios: son parte
  del build, así que **toda instancia es instalable desde el primer arranque**,
  incluida una recién desplegada sin marca.
- **Cuando el dueño ha subido un icono raster, ese manda** en el manifiesto y en
  el `apple-touch-icon`. La subida ya acepta PNG (`FAVICON_MIMES`), así que no
  hace falta código nuevo para permitirlo.
- **El SVG de marca se queda donde ya funciona**: el icono de la pestaña. No
  entra en el manifiesto, porque ahí es donde no es fiable.

### El comportamiento observable cuando no hay PNG

- **FR-425** El manifiesto DEBE ofrecer siempre iconos PNG de 192 y 512 px, haya
  o no marca configurada, de modo que la app sea instalable en cualquier
  instancia.
- **FR-426** Sin icono raster subido, la app instalada DEBE mostrar el **logo de
  Uniko** con el **nombre del negocio** y su color de tema. Nunca un icono
  ausente, ni una captura de la página, ni un cuadro roto.
- **FR-427** La pantalla de marca en Ajustes DEBE avisar, cuando el icono actual
  no sirve para instalar, de que la app instalada usará el logo de Uniko, y DEBE
  decir exactamente qué hace falta para arreglarlo: subir un PNG cuadrado de al
  menos 512×512.
- **FR-428** Ese aviso DEBE desaparecer en cuanto el icono subido sirva. No es un
  error ni bloquea nada: es una instancia que funciona con el icono de fábrica.
- **FR-429** Subir un PNG DEBE cambiar el icono de la app **ya instalada** sin
  reinstalarla, por el mismo mecanismo de versión (`?v=`) que ya usa el favicon.

Con esto, el criterio de FR-418 se cumple en cuanto el dueño sube su icono, y
mientras no lo suba la app se instala igual y se ve deliberada, no rota.

## Supuestos

- La flota corre detrás de HTTPS (Coolify/Caddy), así que el requisito de
  contexto seguro está cubierto en las instancias reales.
- El operador usa Chrome en Android y Safari en iOS. Otros navegadores instalan o
  no según lo que soporten; no se les dedica trabajo específico.
- El nombre corto de la app cabe bajo un icono sin recortarse de forma fea. Si la
  marca de algún negocio es larga, se recorta y se ve en el nivel 3.
- La 018 está cerrada y en producción: su arnés es la referencia contra la que se
  mide la no regresión.
- Que la app instalada de un cliente lleve el logo de Uniko mientras no suba el
  suyo es aceptable como estado transitorio. Si el dueño decide que no lo es, la
  salida NO es rasterizar a la carrera: es pedirle el PNG a cada negocio antes de
  promover.
