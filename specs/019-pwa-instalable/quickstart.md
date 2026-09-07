# 019 — Quickstart: cómo ejercer y verificar

Los tres niveles, en orden de coste. Ninguno sustituye al siguiente.

> **Antes de nada**: trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el
> alias `G:\`, o `predev`/`prebuild` te cortan.

## Nivel 1 — Unidad

```bash
pnpm test
```

Cubre las cuatro funciones puras, que son donde vive todo lo que se puede
equivocar en silencio:

- **`sw-scope`** — `/api/events` fuera, el webhook fuera, `/api/bot/*` fuera, una
  navegación normal dentro. Este es el test que va a fallar el día que alguien
  toque el service worker sin leer el contrato.
- **`platform`** — iPhone, iPad que se anuncia como Mac, Android, escritorio, y
  el caso "ya instalada".
- **`png`** — dimensiones leídas del `IHDR`; archivo que no es PNG; PNG truncado.
- **`manifest`** — la marca de la instancia; el icono del dueño cuando sirve; los
  de fábrica cuando no.

## Nivel 2 — Local, en un navegador de verdad

`localhost` cuenta como contexto seguro, así que el service worker se registra y
se activa igual que en producción. Con la app viva y los mocks encendidos:

```bash
WA_MOCK_ENABLED=true pnpm dev
```

y en otra terminal:

```bash
pnpm test:e2e
```

Que ahora encadena tres guiones: el arnés HTTP (`e2e-selftest.mjs`), el de la 018
(`e2e-sse-reconexion.mjs`) y el de esta feature (`e2e-pwa.mjs`).

Lo que tiene que quedar verde:

1. el manifiesto responde, es JSON válido y lleva el nombre y el acento de la
   instancia;
2. el service worker se registra y **controla** la página;
3. `workerStart > 0` en una petición normal y `workerStart === 0` en
   `/api/events`, en la misma corrida — las dos mitades;
4. la app no pide permiso de notificaciones;
5. emulando un iPhone: instrucciones, no botón;
6. en `display-mode: standalone`: ni botón ni instrucciones;
7. sin icono raster, el manifiesto trae los dos PNG de fábrica; con uno válido,
   solo el del dueño;
8. **el arnés entero de la 018 corre otra vez, con el service worker activo.**

> El punto 8 no es una formalidad. Es la razón por la que esta feature se
> planificó con ciclo completo: el service worker se pone delante del canal que
> la 018 acaba de arreglar.

## Nivel 3 — Dispositivo real (OBLIGATORIO)

Instalar de verdad necesita HTTPS, y `localhost` no lo da. Dos pasadas, en este
orden:

### Pasada 1 — túnel HTTPS contra la app local

Es la barata, y es donde se van a descubrir las cosas que no se ven en un test:
el recorte del `short_name` bajo el icono, si el logo de fábrica se ve
deliberado o pobre, y si las instrucciones de iOS coinciden con lo que el
teléfono enseña de verdad.

- Levanta la app local y abre un túnel con certificado hacia el puerto 3000.
- Pon `APP_BASE_URL` con la URL del túnel antes de arrancar: el manifiesto y el
  registro del service worker tienen que salir del mismo origen que visita el
  teléfono.
- Abre esa URL en un Android y en un iPhone.

**No toca ninguna instancia de clientes.**

### Pasada 2 — LanCo desplegada

Después del merge a `main`, en `https://uniko.lanco.cloud`. Es la que estrena, y
la única donde se prueba con la marca de un negocio real.

### Qué anotar, en las dos plataformas

- versión de Android y de iOS;
- si apareció el **botón** (Android) o las **instrucciones** (iOS);
- si el icono y el nombre en la pantalla de inicio eran los del negocio o los de
  fábrica —y si el de fábrica se veía aceptable—;
- si abrió **sin barra de direcciones**;
- en iOS, si pidió **iniciar sesión otra vez** y si el texto de la pantalla se
  entendía sin sentirlo como un fallo;
- y el que cierra la no regresión del SSE: **entró un mensaje real con la app
  instalada y apareció solo, sin recargar**.

Ese último es el nivel 3 de la 018 repetido con el service worker de verdad
instalado. Si falla, la feature no está Hecha por muchos verdes que haya arriba.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Los cuatro, desde la ruta real. Es el piso, no el techo.
