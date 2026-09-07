# Implementation Plan: 019 — PWA instalable en Android e iOS

**Branch**: `019-pwa-instalable` · **Date**: 2026-09-07 · **Spec**:
[spec.md](./spec.md) · **Research**: [research.md](./research.md)

**Input**: spec de la feature, constitución 1.5.0, y la comprobación en vivo de
las tres instancias (research R0)

## Summary

Hacer Uniko instalable en Android e iOS sirviendo un manifiesto con la marca de
la instancia, registrando un service worker cuyo **único** trabajo es existir
—handler de `fetch` que no cachea nada, para que Chrome ofrezca el prompt—, y
poniendo delante un botón en Android e instrucciones en iOS.

Lo que gobierna el diseño no es instalar, que es fácil, sino **lo que ese
service worker se pone por delante**: toda la red de la app, incluido el canal
SSE que la 018 acaba de endurecer. Por eso el handler es trivial a propósito, la
exclusión de `/api/events` es explícita, y se comprueba desde el navegador con
`workerStart` en la misma corrida en que se comprueba que el service worker está
activo.

**Lo que cambió el alcance**: ninguna de las tres instancias vivas tiene icono
raster (R0). Sin PNG por defecto en la imagen, hoy no habría botón de instalar en
ninguna. Entran en alcance el par de PNG de fábrica y el aviso en Ajustes.

## Technical Context

**Language/Version**: TypeScript estricto sobre Node 22 · Next 15 (App Router) +
React 19

**Primary Dependencies**: ninguna nueva. El service worker es JavaScript plano
servido por una ruta; el manifiesto es JSON servido por otra; los PNG por
defecto son dos archivos en `public/`

**Storage**: sin cambios de esquema. Se reutiliza `organization.metadata`
(marca) y el volumen de medios (icono subido, que ya existe)

**Testing**: Vitest (nivel 1) · arnés E2E en navegador con Playwright, el que se
montó para la 018 (nivel 2) · dispositivo real por túnel HTTPS y LanCo (nivel 3)

**Target Platform**: Chrome en Android, Safari en iOS 16.4+, y navegadores de
escritorio para el trabajo diario

**Project Type**: monolito web (Next App Router)

**Performance Goals**: el service worker no debe añadir latencia observable
(FR-409). El manifiesto es una lectura por instalación, no por navegación

**Constraints**: HTTPS para instalar (localhost cuenta para desarrollar) · el
handler de `fetch` no cachea nada · `/api/events` no pasa por el service worker

**Scale/Scope**: tres instancias en producción, un operador por instancia hoy

## Constitution Check

Evaluado antes del diseño y de nuevo después. Sin violaciones que justificar.

| Principio | Estado |
|---|---|
| **I. Seguridad** | El service worker no guarda nada: no hay dato de cliente en una caché del navegador que sobreviva al cierre de sesión. El manifiesto expone nombre y color, lo mismo que ya expone el favicon público |
| **II. Soberanía** | Cero dependencias nuevas, cero terceros, cero CDN. Se descarta expresamente la librería de rasterizado (R0) y se pospone hasta tener el problema delante |
| **III. Multi-tenancy** | La marca sale por `getBrandingContext()`, el camino que ya existe. El manifiesto es público como el favicon, y por la misma razón: se pide sin sesión |
| **IV. Idempotencia** | Sin escrituras. Registrar un service worker es idempotente por definición del navegador |
| **VI. Specs antes de código** | Ciclo completo declarado; esta es su fase de plan |
| **IX. Definición de Hecho** | Tres niveles, con el nivel 3 planificado desde la spec y no descubierto al final |
| **X. Irreversibilidad** | No toca `drizzle/`. No hay migración ni ensayo que hacer. `/uniko-promote` no activará su condición 4 |
| **Módulos opcionales** | No aplica: ser instalable no es un módulo. Lo que sí se respeta es el gancho para la bandera de la 020 (D2) |

**Complexity Tracking**: nada que declarar. La única complejidad añadida —leer
las dimensiones de un PNG a mano en vez de usar una librería— existe para NO
añadir una dependencia, que es la dirección correcta según el Principio II.

## Diseño

### D1. El manifiesto: una ruta, calcando el favicon

`GET /api/branding/manifest` — `force-dynamic`, público, mismo patrón que
`/api/branding/favicon`:

- `name`: `<marca> — CRM de WhatsApp`; `short_name`: la marca, recortada a lo que
  cabe bajo un icono.
- `theme_color`: el acento de la instancia. `background_color`: el fondo del
  tema claro.
- `display: "standalone"`, `start_url: "/inbox"`, `scope: "/"`.
- `id` **fijo y no derivado de la marca**: si el identificador cambiara al
  cambiar el nombre, el navegador trataría la app renombrada como otra distinta y
  el operador acabaría con dos iconos.
- `icons`: ver D3.
- Cabecera de caché: fuerte solo con `?v=` (que cambia con la marca), corta sin
  él. Es la regla que el favicon ya usa.

Se enlaza desde `generateMetadata` en `src/app/layout.tsx`, junto al `icon` que
ya está, con el mismo sufijo de versión.

### D2. El service worker: `/sw.js`, y nada más

Ruta dinámica que devuelve JavaScript con `Cache-Control: no-cache`. El handler
vive en `/api/sw` y se publica como `/sw.js` con una rewrite: una carpeta
`src/app/sw.js/` rompe el enrutado de Next entero (research R4). Contenido
completo, en esencia:

- `install` → `skipWaiting()`; `activate` → `clients.claim()`. Una versión nueva
  toma el control sin pedir permiso, que es lo que hace innecesario desinstalar
  (FR-410). Es seguro **porque no hay caché**: no hay estado viejo que pueda
  quedarse a medias entre dos versiones.
- `install` declara además el **enrutado estático** (`addRoutes`, `source:
  "network"`) de las rutas excluidas: el navegador las manda a la red sin
  consultar al worker, con lo que la exclusión deja de depender de lo que haga el
  handler.
- `fetch` → decide con una función pura (D5) y, si la petición está excluida,
  **retorna sin llamar a `respondWith`** (la garantía donde no hay enrutado
  estático). Responde **solo la navegación**, yendo a la red: un handler que no
  responde nada es, para Chrome, un handler vacío, y se salta el service worker
  entero — sin él no habría prompt de instalación. Nada se cachea (R1).
- La versión de la app va escrita dentro, para que un despliegue cambie los bytes
  y el navegador detecte la actualización.
- **Gancho para la 020**: el archivo se genera en servidor, así que cuando exista
  la bandera de push bastará con añadir el bloque `push`/`notificationclick`
  cuando esté encendida. Hoy no se registra nada de push ni se pide permiso
  (FR-411, SC-009).

El registro se hace desde el cliente, una vez, tras la carga — nunca antes de que
la app sea usable.

### D3. Iconos: PNG siempre, del dueño cuando sirva

`GET /api/branding/icon?size=192|512` sirve:

1. el archivo subido, **si es PNG, cuadrado y de 512 px o más** (dimensiones
   leídas del `IHDR`, R3); o
2. el PNG de fábrica de esa medida, desde `public/`.

En el manifiesto:

- Con icono válido del dueño: **una sola entrada**, la suya, con
  `"sizes": "192x192 512x512"`. Una sola entrada evita que el navegador escoja el
  logo de Uniko para el hueco pequeño y el del negocio para el grande.
- Sin él: dos entradas, 192 y 512, con el logo de Uniko.
- `apple-touch-icon` en el `<head>` apunta a la misma ruta, siempre PNG, porque
  iOS ignora el manifiesto para esto (R2).

Los PNG de fábrica se generan **una vez, a mano, y se commitean** en `public/`.
No se generan en build: sería meter una herramienta de imagen en el pipeline para
dos archivos que no cambian nunca.

### D4. El aviso en Ajustes → Marca

Cuando el icono actual no sirve para instalar, la pantalla de marca lo dice con
lo que hay que hacer: *subir un PNG cuadrado de 512×512 o más*. No es un error,
no bloquea nada, y desaparece solo cuando el icono subido cumple (FR-427,
FR-428). El dato ("¿sirve el icono actual?") lo calcula el servidor con la misma
función de D3 y viaja en el GET de la marca que ya existe.

### D5. La decisión de qué se excluye: función pura

`src/lib/sw-scope.ts` — dada una petición (URL y modo), decide si el service
worker la toca. Fuera, siempre: `/api/events`, el webhook de Meta y `/api/bot/*`
(FR-412, FR-415).

Vive fuera del service worker por la misma razón por la que el vigilante de la
018 vive fuera de `use-events.ts`: es la parte que hay que poder probar con
tests, y metida dentro del archivo que el navegador ejecuta sería exactamente lo
que nadie mira. El service worker la incrusta al generarse.

### D6. Botón e instrucciones

Un componente que decide entre tres estados con una función pura
(`src/lib/platform.ts`, R6): botón (hay `beforeinstallprompt` guardado),
instrucciones (iOS y no instalada), o nada (ya instalada, o descartado). El
descarte se recuerda en `localStorage` — es una preferencia de un dispositivo, no
un dato del negocio, y no merece ni una columna ni un viaje al servidor.

### D7. El texto del re-login en iOS

En la pantalla de login, cuando se corre instalada y no hay sesión, una línea que
explica que la app instalada tiene su propia sesión. Redactada para servir la
quinta vez igual que la primera (FR-423): sin "bienvenido", sin "la primera vez",
sin dar por hecho que acaba de instalar.

## Project Structure

### Documentation (this feature)

```
specs/019-pwa-instalable/
├── spec.md
├── plan.md              ← este archivo
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── manifest.md
    └── service-worker.md
```

### Source Code (repository root)

```
src/
├── app/
│   ├── layout.tsx                        (M) enlaza manifiesto y apple-touch-icon
│   ├── sw.js/route.ts                    (N) el service worker, generado en servidor
│   └── api/branding/
│       ├── manifest/route.ts             (N) el manifiesto con la marca
│       └── icon/route.ts                 (N) los PNG 192/512
├── components/
│   ├── pwa/install-prompt.tsx            (N) botón / instrucciones / nada
│   ├── pwa/register-sw.tsx               (N) registro del service worker
│   ├── auth/…                            (M) la línea del re-login en iOS
│   └── settings/branding-client.tsx      (M) aviso de icono no instalable
├── lib/
│   ├── sw-scope.ts                       (N) qué toca el service worker (pura)
│   ├── platform.ts                       (N) iOS / Android / instalada (pura)
│   ├── png.ts                            (N) dimensiones desde el IHDR (pura)
│   └── manifest.ts                       (N) construir el manifiesto (pura)
└── server/branding.ts                    (M) ¿sirve el icono para instalar?

public/
├── icon-192.png                          (N) logo de Uniko de fábrica
└── icon-512.png                          (N)

tests/unit/                               (N) sw-scope · platform · png · manifest
scripts/e2e-pwa.mjs                       (N) nivel 2, encadenado en pnpm test:e2e
```

## Verificación

### Nivel 1 — Unidad

`sw-scope` (con `/api/events`, webhook y `/api/bot/*` entre los excluidos, y una
navegación normal entre los que sí pasan) · `platform` (iPhone, iPad que se
anuncia como Mac, Android, escritorio, instalada) · `png` (dimensiones correctas,
archivo que no es PNG, PNG truncado) · `manifest` (marca de la instancia, icono
del dueño cuando sirve, de fábrica cuando no).

### Nivel 2 — Local, con el arnés de la 018

`scripts/e2e-pwa.mjs`, encadenado en `pnpm test:e2e` junto a los dos que ya hay:

1. el manifiesto responde, es JSON válido y lleva el nombre y el acento de la
   instancia;
2. el service worker se registra y **controla** la página;
3. las **dos mitades** en la misma corrida (FR-413, FR-414): `workerStart > 0` en
   la navegación —el service worker está en el camino— y `excluidasVistas === 0`
   reportado por el propio service worker —nunca vio el canal—. `workerStart` no
   sirve para la segunda mitad: se sella igual pase o no por el handler
   (medido, research R5);
4. la app no pide permiso de notificaciones (SC-009);
5. con la plataforma emulada como iPhone: instrucciones, no botón;
6. en modo instalado (`display-mode: standalone`): ni botón ni instrucciones;
7. sin icono raster, el manifiesto trae los dos PNG de fábrica; con uno válido,
   trae solo el del dueño;
8. **y el arnés completo de la 018 vuelve a correr con el service worker
   registrado y activo** (FR-421, SC-005). Esto es lo que decide si la feature
   sigue viva.

### Nivel 3 — Dispositivo real (OBLIGATORIO)

Túnel HTTPS contra la app local para la primera pasada; **LanCo** desplegada para
la confirmación, tras el merge a `main`. En las dos plataformas se anota: versión
del sistema, si el icono y el nombre eran los del negocio, si abrió sin barra de
direcciones, si iOS pidió entrar de nuevo, y —el que cierra la no regresión del
SSE— si entró un mensaje real con la app instalada y apareció solo.

### Gate técnico

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, desde
`C:\G\gApps\LanCo\Uniko-CRM`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Chrome endurece el criterio del prompt (su propia documentación dice que está en movimiento) | El degradado es conocido: se sigue instalando desde el menú del navegador. El nivel 3 lo detecta |
| Alguien envuelve el SSE en el service worker en el futuro (la 020 va a tocar ese archivo) | La comprobación de `workerStart` falla y el arnés se pone rojo. Es justo para eso |
| `skipWaiting()` deja una versión a medias | No hay caché ni estado que quede a medias. Es seguro **porque** el handler es trivial |
| Los clientes se instalan con el logo de Uniko | Definido y visible: aviso en Ajustes con la instrucción exacta. Si al dueño no le vale, la salida es pedir el PNG a cada negocio antes de promover, no rasterizar a la carrera |
| El `short_name` se recorta feo | Se ve en el túnel del nivel 3, antes de tocar ninguna instancia |

## Fuera de alcance

Lo de la spec, sin cambios: caché offline, push (020), cola de envíos sin
conexión, tiendas de aplicaciones, y arreglar el re-login de iOS (no tiene
arreglo; se explica).

## Contradicciones con la spec

Ninguna. El plan **cierra** la pregunta que la spec dejaba abierta sobre formatos
de icono, en la dirección que la spec ya recomendaba, y con el dato de las tres
instancias que el primer borrador no tenía.
