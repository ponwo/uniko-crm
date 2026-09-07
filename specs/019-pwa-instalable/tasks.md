---
description: "Tareas de la 019 — PWA instalable en Android e iOS"
---

# Tasks: 019 — PWA instalable en Android e iOS

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) ·
[quickstart.md](quickstart.md)

**Tests**: SÍ se generan tareas de prueba. La spec las exige explícitamente
(Principio IX y su sección "Verificación", en tres niveles), así que aquí no son
opcionales.

**Organización**: por historia de usuario, en orden de prioridad. Cada fase de
historia es un incremento entregable y probable por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1, US2, US3

---

## ✅ DECISIÓN TOMADA (era el bloqueo de la Fase 1)

**El dueño eligió la opción (a)**: guion de un solo uso con Playwright. Hecho en
`scripts/generate-default-icons.mjs`, con la documentación de cómo se regenera y
cuándo hace falta escrita en el propio guion. Los dos PNG están commiteados.

<details><summary>La decisión, tal como se planteó</summary>

## 🛑 DECISIÓN PENDIENTE antes de empezar la Fase 1

**De dónde salen los dos PNG de fábrica.** El plan dice "se generan una vez, a
mano, y se commitean", y al escribir las tareas resulta que eso no está
resuelto: el logo de Uniko existe **solo como SVG** (`src/lib/favicon.ts`), y
convertirlo a PNG necesita algo que rasterice. La spec descartó rasterizar **en
el runtime**; no dijo nada de cómo se fabrican dos archivos que se commitean una
sola vez.

Opciones:

- **(a) Guion de un solo uso con Playwright** — ya es `devDependency` del repo
  (lo usa el arnés). Un guion abre el SVG en Chromium, lo captura a 192 y 512, y
  se commitean los PNG resultantes. **Cero dependencias nuevas**, cero código en
  runtime, y el guion queda en `scripts/` por si algún día cambia el logo.
  *Recomendada.*
- **(b) Los pone el dueño**, exportados de su herramienta de diseño. Cero código,
  pero la feature queda esperando a un archivo.
- **(c) PNG escrito a mano en el repo** (base64 de una imagen mínima). Barato y
  malo: nadie sabría luego cómo regenerarlo.

**No se absorbe esta decisión**: T001 y T002 quedan bloqueadas hasta que el dueño
elija. Todo lo demás puede avanzar sin ellas — el resto de la feature no depende
de los bytes de esos dos archivos, solo de que existan en `public/`.

</details>

---

## ⛔ Lo que ordena esta lista: el service worker no se entrega solo

El riesgo de esta feature no es que la instalación falle, es que el service
worker se ponga delante del canal SSE y nadie se entere hasta que un operador
pierda un mensaje. Por eso:

**El service worker y la comprobación de que NO toca `/api/events` van en la
misma fase, y la fase no se cierra sin las dos.** No hay un estado intermedio
"ya registra, luego probamos": ese estado es exactamente el fallo de la 018
reintroducido, y esta vez por nosotros.

**La comprobación exige las DOS MITADES en la MISMA corrida** (T012):

1. `workerStart > 0` en la navegación → el service worker está de verdad en el
   camino;
2. `excluidasVistas === 0` según el propio service worker → y aun así el canal no
   pasó por él.

> La segunda mitad se planeó con `workerStart === 0` y **hubo que cambiarla al
> implementar**: Chromium sella ese tiempo igual pase o no la petición por el
> handler, así que no distinguía nada. Detalle en research R5.

Con una sola mitad, el arnés da verde sin probar nada: si el service worker no
llegó a controlar la página, el canal "no pasa por él" trivialmente. Es el mismo
error que costó una vuelta en la 018, cuando enmudecer una sola de las dos
suscripciones dejaba viva la conexión sana y el arnés pasaba por el camino bueno
creyendo que probaba el malo.

---

## Phase 1: Setup

**Purpose**: los dos archivos que hacen instalable a cualquier instancia.

- [x] T001 [P] Crear
      `scripts/generate-default-icons.mjs`: guion de un solo uso que rasteriza el
      logo de Uniko de `src/lib/favicon.ts` a PNG de 192 y 512 px con el Chromium
      de Playwright (devDependency ya presente; nada nuevo en runtime)
- [x] T002 Ejecutarlo y commitear `public/icon-192.png` y
      `public/icon-512.png`, verificando que son cuadrados y de la medida exacta

**Checkpoint**: existen los dos PNG de fábrica en `public/`, que el `Dockerfile`
ya copia al runner (research R0).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el service worker, y la prueba de que no toca lo que no debe.

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta que esta fase esté cerrada,
T012 incluida.

### Las funciones puras, con sus tests

- [x] T003 [P] Crear `src/lib/sw-scope.ts`: dada una URL y el modo de la
      petición, decidir si el service worker la toca. Fuera siempre `/api/events`,
      el webhook de Meta y `/api/bot/*` (FR-412, FR-415)
- [x] T004 [P] Tests en `tests/unit/sw-scope.test.ts`: los tres excluidos por
      separado, una navegación normal que sí pasa, y una URL con query y con
      barra final para que la coincidencia no dependa de la forma exacta
- [x] T005 [P] Crear `src/lib/platform.ts`: iOS / Android / escritorio y "ya
      instalada", como funciones puras sobre `userAgent`, puntero táctil y
      `display-mode` (research R6)
- [x] T006 [P] Tests en `tests/unit/platform.test.ts`: iPhone, **iPad que se
      anuncia como Mac**, Android, escritorio, y modo instalado
- [x] T007 [P] Crear `src/lib/png.ts`: leer ancho y alto del chunk `IHDR`
      (research R3), y decidir si un icono sirve para instalar (PNG, cuadrado,
      ≥512)
- [x] T008 [P] Tests en `tests/unit/png.test.ts`: PNG válido de medida conocida,
      PNG pequeño, PNG no cuadrado, archivo que no es PNG, y PNG truncado

### El service worker

- [x] T009 Crear `src/app/sw.js/route.ts`: devuelve el service worker como
      JavaScript, con `Content-Type: application/javascript` y
      `Cache-Control: no-cache`, incrustando la decisión de `sw-scope` y la
      versión de la app. `install` → `skipWaiting`, `activate` → `clients.claim`,
      `fetch` → **retorna sin `respondWith`** para lo excluido y deja pasar todo
      lo demás sin cachear (contrato
      [service-worker.md](contracts/service-worker.md))

      **La contingencia se activó**: Next NO admite un segmento terminado en
      `.js`; con `src/app/sw.js/` la aplicación ENTERA devuelve 500 (`ENOENT …
      pages/_document.js`). El handler vive en `src/app/api/sw/route.ts` y se
      publica como `/sw.js` con una rewrite en `next.config.ts`. La URL pública,
      que es lo que fija el ámbito, no cambia.

      **Y el handler no quedó vacío del todo**: responde la navegación yendo a la
      red. Un handler que nunca llama a `respondWith` es, para Chrome, un handler
      vacío: se salta el service worker entero y no habría prompt de instalación.

- [x] T010 Tests en `tests/unit/sw-route.test.ts`: el cuerpo servido **no
      contiene** `caches.open` ni nada de push, sí contiene la exclusión del canal
      de eventos, y las cabeceras son las del contrato
- [x] T011 Crear `src/components/pwa/register-sw.tsx` y montarlo en
      `src/app/layout.tsx`: registra `/sw.js` una vez, después de la carga, sin
      bloquear la interfaz

### La comprobación que da sentido a todo lo anterior

- [x] T012 Crear `scripts/e2e-pwa.mjs` con la comprobación de la exclusión
      **completa**: en la misma corrida y con el service worker ya controlando la
      página, `workerStart > 0` para una petición normal de la app y
      `workerStart === 0` para `/api/events` (FR-413, FR-414, SC-006). El guion
      debe **fallar** si falta cualquiera de las dos mitades, incluida la de que
      el service worker esté activo
- [x] T013 Encadenar `e2e-pwa.mjs` en `test:e2e` de `package.json`, detrás de los
      dos guiones que ya existen
- [x] T014 En `scripts/e2e-sse-reconexion.mjs` (arnés de la 018), afirmar al
      empezar que el service worker está registrado y controlando la página, para
      que esa corrida cuente como la no regresión que pide FR-421 y no como una
      corrida cualquiera que casualmente pasó

**Checkpoint**: el service worker existe, está activo, y está **probado** que el
canal de eventos no pasa por él. La 018 sigue verde con él delante.

---

## Phase 3: User Story 1 — Instalar en Android (Priority: P1) 🎯 MVP

**Goal**: que el operador instale la app desde un botón de la propia app y la
abra desde la pantalla de inicio con la marca de su negocio.

**Independent Test**: en Chromium con la app servida, el manifiesto responde con
el nombre y el acento de la instancia y declara iconos PNG que cumplen el mínimo;
el botón aparece cuando el navegador ofrece instalar y desaparece al descartarlo.

- [x] T015 [P] [US1] Crear `src/lib/manifest.ts`: construir el objeto del
      manifiesto a partir de la marca y del icono disponible, con `id` fijo no
      derivado del nombre (contrato [manifest.md](contracts/manifest.md))
- [x] T016 [P] [US1] Tests en `tests/unit/manifest.test.ts`: marca de la
      instancia; `short_name` recortado; **una sola entrada** de icono cuando el
      del dueño sirve; **dos entradas** de fábrica cuando no; y que el `id` NO
      cambia al cambiar el nombre
- [x] T017 [US1] Crear `src/app/api/branding/icon/route.ts`: sirve el PNG del
      dueño si cumple (usando `lib/png`), y si no el de fábrica de `public/`, con
      la misma regla de caché por `?v=` que el favicon
- [x] T018 [US1] Crear `src/app/api/branding/manifest/route.ts`: `force-dynamic`,
      público, `application/manifest+json`, marca por `getBrandingContext()`
- [x] T019 [US1] En `src/app/layout.tsx`, enlazar el manifiesto y el
      `apple-touch-icon` con el mismo `?v=` que ya usa el favicon
- [x] T020 [P] [US1] Crear `src/components/pwa/install-prompt.tsx`: guarda el
      evento `beforeinstallprompt`, muestra el botón, lo dispara al pulsar, y
      recuerda el descarte en `localStorage` (FR-402, FR-405)
- [x] T021 [US1] Montarlo como aviso descartable en la bandeja, bajo la barra de
      navegación, en `src/components/inbox/inbox-client.tsx`

      *Supuesto declarado*: la spec pide el botón "dentro de la interfaz" sin
      decir dónde. Va en la bandeja porque es la pantalla que el operador tiene
      abierta, y descartable porque un aviso permanente se vuelve decorado.

- [x] T022 [US1] Añadir a `scripts/e2e-pwa.mjs`: el manifiesto responde, es JSON
      válido, lleva el nombre y el acento de la instancia, y declara iconos que
      cumplen el mínimo de 192 y 512
- [x] T023 [US1] Añadir a `scripts/e2e-pwa.mjs`: en modo instalado
      (`display-mode: standalone` emulado) no aparece ni el botón ni nada más
      (FR-404, SC-008)

**Checkpoint**: US1 completa. La app se instala en Android con la marca correcta.

---

## Phase 4: User Story 2 — iOS: instrucciones y volver a entrar (Priority: P2)

**Goal**: que en iPhone el operador sepa cómo instalar sin ayuda, y que volver a
iniciar sesión no parezca un fallo — ni la primera vez ni la quinta.

**Independent Test**: con Playwright emulando un iPhone salen las instrucciones y
no el botón; y con la app en modo instalado y sin sesión, el login muestra la
explicación.

- [x] T024 [US2] En `src/components/pwa/install-prompt.tsx`, añadir el estado de
      iOS: instrucciones con la secuencia real (Compartir → Añadir a pantalla de
      inicio), elegidas por `lib/platform` y no por ancho de pantalla (FR-403)
- [x] T025 [US2] Añadir la línea del re-login en la pantalla de login
      (`src/app/(auth)/login/…`), visible solo si corre instalada y sin sesión,
      con un componente de cliente mínimo para detectar el modo (FR-422, FR-424)
- [x] T026 [US2] Redactar ese texto para que sirva **la quinta vez igual que la
      primera** (FR-423): explica que la app instalada tiene su propia sesión, sin
      "bienvenido", sin "la primera vez", y sin dar por hecho que acaba de
      instalar — porque la misma pantalla la ve quien vuelve tras una semana, por
      el descarte de los ~7 días de iOS
- [x] T027 [US2] Añadir a `scripts/e2e-pwa.mjs`: emulando iPhone salen las
      instrucciones y **no** el botón; y el texto del re-login aparece en modo
      instalado sin sesión. Se comprueba además que el texto dice qué tocar y
      dónde, sin jerga, y que ninguno de los dos textos da por hecho que es la
      primera vez

      **Chromium no emula `display-mode: standalone`** (medido:
      `Emulation.setEmulatedMedia` no cambia `matchMedia`). Con esa emulación
      que no emulaba, el escenario "ya instalada" pasaba **por el motivo
      equivocado**: el aviso no salía porque estaba descartado de antes. Ahora se
      inyecta `navigator.standalone` —la señal real de iOS, la que lee
      `lib/platform`— y se comprueba con las dos mitades: en el mismo contexto
      limpio, sin la señal el aviso SÍ aparece.

**Checkpoint**: US1 y US2 funcionan por separado.

---

## Phase 5: User Story 3 — La marca, y el icono cuando no sirve (Priority: P3)

**Goal**: que el dueño vea su marca en la app instalada, y que cuando su icono no
sirva para instalar lo sepa y sepa qué hacer — con la app instalable igualmente.

**Independent Test**: una instancia sin icono raster (las tres de la flota, hoy)
se instala con el logo de fábrica y su pantalla de marca lo dice; subir un PNG de
512 quita el aviso y cambia el icono sin reinstalar.

- [x] T028 [P] [US3] En `src/server/branding.ts`, derivar "¿el icono actual sirve
      para instalar?" con `lib/png`, sin guardarlo (data-model: es derivado)
- [x] T029 [US3] Exponer ese dato en el GET de la marca que ya existe
      (`src/app/api/settings/branding/route.ts`)
- [x] T030 [US3] En `src/components/settings/branding-client.tsx`, mostrar el
      aviso con la instrucción exacta —*sube un PNG cuadrado de 512×512 o más*—,
      que no bloquea nada y desaparece solo cuando el icono cumple (FR-427,
      FR-428)
- [x] T031 [US3] Añadir a `scripts/e2e-pwa.mjs`: sin icono raster el manifiesto
      trae los dos PNG de fábrica y el aviso está; subiendo un PNG de 512 el
      manifiesto pasa a traer una sola entrada, la del dueño, y el aviso
      desaparece (FR-425, FR-426, FR-429, SC-011)

**Checkpoint**: las tres historias funcionan por separado.

---

## Phase 6: Polish, guion y nivel 3

- [x] T032 [P] Escribir el guion de la historia en `tests/e2e/us-pwa.md`, con los
      tres niveles y el hueco para registrar las corridas en dispositivo, al
      estilo de `tests/e2e/us-reconexion-sse.md`
- [x] T033 [P] Actualizar `docs/desarrollo-local.md`: `pnpm test:e2e` encadena
      ahora **tres** guiones, y cómo levantar el túnel HTTPS para probar la
      instalación
- [x] T034 Gate técnico completo desde la ruta real:
      `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [x] T035 **Nivel 3, pasada 1 (túnel)** — VERDE en Android e iOS el 2026-09-07: instalar en un Android y en un iPhone
      reales contra la app local por HTTPS. Anotar en `tests/e2e/us-pwa.md`:
      versión del sistema, botón/instrucciones, icono y nombre, si abrió sin barra
      de direcciones, el recorte del `short_name`, y si el logo de fábrica se ve
      aceptable
- [ ] T036 **Nivel 3, pasada 2 (LanCo)**, tras el merge a `main`: repetir en
      `https://uniko.lanco.cloud` y —lo que cierra la no regresión del SSE—
      comprobar que **entra un mensaje real con la app instalada y aparece solo**
      (SC-007)
- [ ] T037 Actualizar `memory/pwa-en-movil-necesita-https.md` con lo que se
      aprendió de verdad al probarlo, y añadir memoria del hallazgo de los iconos
      de la flota si sigue vigente al terminar

---

## Dependencies

```
Fase 1 (PNG de fábrica) ──┐
                          ├──> Fase 3 (US1) ──> Fase 4 (US2)
Fase 2 (SW + T012) ───────┘                └──> Fase 5 (US3)
                                                     │
                          Fase 6 (polish + nivel 3) <┘
```

- **T012 bloquea todo lo demás de la Fase 2 en el sentido que importa**: la fase
  no se cierra sin ella, aunque T009-T011 ya "funcionen".
- **US1 depende de la Fase 1** solo por los archivos de icono; el resto del
  trabajo de US1 puede escribirse antes de que la decisión se tome.
- **US2 y US3 son independientes entre sí** y solo dependen de US1 por el
  componente y la ruta de icono.
- **T036 depende del merge a `main`**, no de las demás tareas.

## Parallel opportunities

- Fase 2: T003-T008 son cuatro funciones puras con sus tests, en archivos
  distintos → los cuatro pares en paralelo.
- Fase 3: T015/T016 (manifiesto puro) en paralelo con T020 (componente).
- Fase 6: T032 y T033 en paralelo.

## MVP

**US1** (Fase 1 + Fase 2 + Fase 3). Con eso la app ya se instala en Android con
la marca del negocio, que es lo que la feature existe para dar. US2 la hace
utilizable en iPhone y US3 cierra el caso del icono.

Ninguna de las tres se puede entregar sin la Fase 2 completa, T012 incluida.
