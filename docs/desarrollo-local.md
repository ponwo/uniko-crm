# Levantar Uniko en tu máquina

De carpeta clonada a app corriendo con el self-test E2E en verde. Pensado para
alguien que no estuvo en la conversación donde se escribió.

Esto es **desarrollo local**. Para desplegar instancias, ve a
[`despliegue-flota.md`](despliegue-flota.md); `.env.example` está escrito para
eso y sus valores **no sirven aquí** (su `DATABASE_URL` apunta a `postgres:5432`,
el hostname de un servicio de Docker Compose, no a tu máquina).

---

## 1. Qué instalar, una sola vez

### Node 22

Las instancias corren `node:22-alpine` y la CI lee la versión de
[`.nvmrc`](../.nvmrc). Tu máquina debe usar la misma: una mayor distinta compila
igual y luego se comporta distinto en producción, que es la peor forma de
enterarse.

`engine-strict=true` en [`.npmrc`](../.npmrc) hace que `pnpm install` **falle**
si tu Node no cuadra. Es a propósito: falla barato y dice exactamente qué pasa.

En Windows, lo más cómodo es [fnm](https://github.com/Schniz/fnm):

```powershell
winget install Schniz.fnm
fnm install 22
fnm use          # lee .nvmrc al entrar en la carpeta
```

### pnpm

La versión sale de `packageManager` en `package.json`, así que basta con
[Corepack](https://nodejs.org/api/corepack.html):

```bash
corepack enable
```

### PostgreSQL 16

**La 16, no la 17 ni la 18**: es la que corre en producción
(`postgres:16-alpine` en los dos compose del repo). Desarrollar contra otra
mayor es fabricarse un fantasma de entorno.

- **Windows**: instalador de [EDB](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads),
  fila 16.x. Deja el puerto en `5432`, apunta la contraseña de `postgres` y
  desmarca Stack Builder al final.
- **macOS**: `brew install postgresql@16 && brew services start postgresql@16`
- **Linux**: el paquete `postgresql-16` de tu distribución.
- **¿Tienes Docker?** Entonces no instales nada:
  `docker compose -f docker-compose.dev.yml up -d` levanta exactamente esa
  versión, aislada y con su propio volumen. Es la vía alternativa, igual de
  válida.

No hace falta crear la base a mano — lo hace `pnpm db:dev` en el paso 3.

---

## 2. El archivo `.env`

`.env` está gitignoreado (nunca se commitea) y **no hay plantilla de desarrollo
local**, así que créalo en la raíz del repo con esto:

```bash
# ── Obligatorias: sin estas cinco la app no arranca ──────────────────────────
APP_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:TU_PASSWORD@localhost:5432/uniko_dev
BETTER_AUTH_SECRET=desarrollo-local-secreto-de-al-menos-16
ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
META_WEBHOOK_VERIFY_TOKEN=desarrollo-local

# ── Para el self-test E2E (nivel 2) ─────────────────────────────────────────
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
BOT_API_KEY=desarrollo-local-bot-key

# El agente, contra el ai-mock local. El token es de mentira a propósito: lo
# único que hace es encender el agente, y las llamadas van al mock de arriba.
OPENROUTER_API_TOKEN=sk-or-mock-local
OPENROUTER_MODEL=mock/modelo
```

Tres avisos sobre esos valores:

- **Cambia `TU_PASSWORD`** por la que pusiste al instalar PostgreSQL.
- **`ENCRYPTION_KEY` debe ser 32 bytes en base64** y se valida al arrancar. El
  de arriba son 32 ceros y sirve **solo en local**. Para cualquier instancia
  real se genera con `openssl rand -base64 32`.
- **`WA_MOCK_ENABLED=true` jamás se pone en una instancia real.** Aun así no
  puede hacer daño ahí: el gate exige además `NODE_ENV !== "production"`, así
  que en producción los mocks dan 404 pase lo que pase.

Sobre el agente: la app funciona como CRM sin `OPENROUTER_API_TOKEN`, pero
**el arnés de la 020 lo necesita** — sin agente no hay escalaciones, y sin
escalaciones no hay nada que avisar. De ahí que esté en la plantilla.

Lo que **no** hace falta: `CHANNELS`, `AGENDA`, `ATRIBUCION` y `PUSH` (los
módulos opcionales van apagados y sus superficies responden 404). Todo lo demás
del esquema tiene valor por defecto.

---

## 3. Arrancar

```bash
pnpm install
pnpm db:dev      # crea la base uniko_dev y aplica las 13 migraciones
pnpm dev         # http://localhost:3000
```

`pnpm db:dev` es idempotente: correrlo dos veces no rompe nada. Y **se niega a
funcionar si `DATABASE_URL` no apunta a localhost** — crea bases y migra, y
apuntar eso a una instancia de un cliente sería tocar sus datos desde el ciclo
de desarrollo (Principio I).

Regístrate en `/register`: la primera cuenta se queda de propietaria y el
registro público se cierra solo después.

---

## 4. El self-test E2E (nivel 2 de la Definición de Hecho)

Con la app corriendo en una terminal, en otra:

```bash
pnpm test:e2e
```

Conduce la app real por las superficies de usuario con los mocks encendidos, y
sale distinto de cero si algo falla. Es lo que el Principio IX pide antes de
declarar "Hecho" cualquier feature con comportamiento observable.

Encadena cuatro guiones:

- `scripts/e2e-selftest.mjs` — por HTTP, sin navegador. Lo más rápido y lo más
  ancho: ingesta, bot API, agenda, atribución, adjuntos.
- `scripts/e2e-sse-reconexion.mjs` — con navegador (Playwright + Chromium), para
  lo que solo se ve mirando la pantalla: la muerte silenciosa del canal SSE, el
  aviso de conexión y el catch-up (feature 018). Tarda ~3 min a propósito: el
  margen de silencio son 60 s de reloj de verdad.
- `scripts/e2e-pwa.mjs` — también con navegador: el manifiesto con la marca de
  la instancia, el botón de instalar, las instrucciones de iOS, y la
  comprobación de que el service worker **no** se pone delante del canal SSE
  (feature 019).
- `scripts/e2e-push.mjs` — los avisos de escalación (feature 020): que el envío
  al servicio de push **va vacío**, que el Laboratorio no avisa a nadie, que un
  endpoint caducado se borra solo, y que la exclusión del SSE sigue en pie **con
  el manejador de push presente**.

La primera vez, Chromium hay que bajarlo: `pnpm exec playwright install chromium`.

**Los tres comparten sesión.** El login de la app limita los intentos —es su
defensa contra fuerza bruta y no se toca—, así que `scripts/e2e-sesion.mjs`
guarda la sesión en `.e2e-session.json` (gitignorado) y la reutiliza: una tanda
entera gasta un login en vez de uno por guion. Si aun así ves un 429, espera un
par de minutos; no aflojes el límite.

### El arnés de la 020 se corre dos veces

`scripts/e2e-push.mjs` mira la bandera `PUSH` y se adapta, así que las dos
configuraciones dicen cosas distintas y las dos hacen falta:

- **Sin `PUSH`** —lo que trae la plantilla de arriba— comprueba que la feature
  **no existe**: rutas en 404 y un service worker sin nada de push. Es la
  configuración de fábrica de toda la flota, y hay que verla apagada.
- **Con la bandera encendida** corre los cuatro escenarios. Añade al `.env`,
  **reinicia la app** (la bandera se lee en el servidor) y vuelve a correr:

```bash
PUSH=on
PUSH_SERVICE_BASE_URL=http://localhost:3000/api/dev/push-mock
```

`PUSH_SERVICE_BASE_URL` es lo que desvía los envíos al mock local en vez de a
Google o Apple. **En una instancia real va vacía**: el endpoint lo da el
navegador de cada teléfono.

Tarda más que los otros: el agente agrupa ráfagas 6 s antes de contestar, y el
guion espera al envío y luego al silencio en vez de dormir un rato fijo. Esa
espera fija fue justo el falso negativo que hubo que arreglar.

### Probar la instalación en un teléfono

Necesita HTTPS, y `localhost` no lo da. Levanta un túnel con certificado hacia el
puerto 3000 y arranca la app con `APP_BASE_URL` puesto a la URL del túnel: el
manifiesto y el registro del service worker tienen que salir del mismo origen que
visita el teléfono. El guion completo está en
[`tests/e2e/us-pwa.md`](../tests/e2e/us-pwa.md).

Los **avisos push no se pueden probar por el túnel**: hacen falta la app
instalada, el permiso concedido y una escalación real del agente. Su nivel 3 se
corre contra la instancia desplegada y está en
[`tests/e2e/us-push.md`](../tests/e2e/us-push.md), con la regla heredada de la
018: **una corrida en la que la notificación no llegó no cuenta**.

---

## Si algo falla

**`pnpm install` se queja de la versión de Node.** Es `engine-strict` haciendo
su trabajo. `fnm use` y reintenta.

**`pnpm db:dev` no conecta.** Comprueba que el servicio de PostgreSQL está
corriendo y que la contraseña del `DATABASE_URL` es la que pusiste al instalar.

**`pnpm db:dev` dice NEGADO.** Tu `DATABASE_URL` no apunta a localhost. Es el
guardarraíl, no un error: revisa el `.env`.

**El build falla con una ruta imposible tipo `./C:/…`.** Estás entrando al repo
por una unidad virtual (`subst`). Entra por su ruta real; hay un guion que te
corta en `predev`/`prebuild` y te dice cuál es. Detalle en
[`memory/build-rojo-desde-la-unidad-g.md`](../memory/build-rojo-desde-la-unidad-g.md).

---

## Lo que esto NO resuelve

**Probar una PWA instalada en un teléfono real necesita HTTPS.** `localhost`
cuenta como contexto seguro, así que los service workers se pueden desarrollar y
depurar aquí sin problema — pero instalar la app en un móvil y comprobar cómo se
comporta requiere un origen con certificado: un túnel (ngrok) o una instancia
desplegada. Es una necesidad aparte, y va a aparecer al final de la feature 019
igual que apareció la prueba en dispositivo al final de la 018.
