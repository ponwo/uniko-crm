# Quickstart — 026 Conector INVENTARIO

Guía de **verificación en vivo** (Principio IX) del conector: botón "Inventario",
`check_stock` del agente y Ajustes, con los mocks primero, contra MS-Stock local
después y contra la instancia de pruebas al final. Contratos:
[conector-inventario.md](contracts/conector-inventario.md) ·
[stock-mock.md](contracts/stock-mock.md) · MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md).

## 0. Prerrequisitos

- Lo de [docs/desarrollo-local.md](../../docs/desarrollo-local.md) (Node 22, Postgres
  16, `.env` con los mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
  `OPENROUTER_BASE_URL` → ai-mock, `OPENROUTER_API_TOKEN` de mentira, `BOT_API_KEY`).
- En `.env` (gitignored), el conector apuntando al mock:

```bash
INVENTARIO=on
STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock
STOCK_API_KEY=desarrollo-local-stock-key-0123456789abcdef
STOCK_SSO_SECRET=desarrollo-local-sso-secret-0123456789abcdef
```

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Los tests unitarios nuevos corren con la bandera en cualquier estado (la CI ejercita
`default` e `inventario=on`).

## 2. App viva y self-test automatizado

```bash
pnpm dev            # http://localhost:3000
pnpm test:e2e       # incluye inventarioChecks() de scripts/e2e-selftest.mjs
```

`inventarioChecks()` con la bandera **encendida**: `/api/inventario/sso` sin sesión →
`401`; con sesión → `302` a `…/stock-mock/portal/sso?token=` y el mock registra
`lastSso` con `sub` y `name` de la sesión; wa-mock inbound "¿tienen playera negra?"
→ la respuesta del agente contiene "Playera negra (PLY-NEG): 7 pieza — $199 MXN";
"¿tienen gorra?" → "Gorra (GOR-01): 3 pieza — sin precio"; "¿tienen playera blanca?"
→ "agotado"; "¿tienen zapatos?" → "No encontré productos"; `_mode=down`,
`unauthorized`, `slow`, `garbage` → el agente responde "Déjame revisar." (la frase
del modelo) en < 6 s, sin texto técnico, y el servidor registra `[agente]
inventario:`; `/api/inventario/status` → `connected` / `unauthorized` /
`unavailable` según el modo; ni la llave ni el secreto aparecen en la respuesta ni en
el HTML de `/settings/inventario`. Con la bandera **apagada** (reiniciar la app sin
`INVENTARIO`): las dos rutas → `404`, "¿tienen playera negra?" → respuesta de eco
normal (el ai-mock no propone `check_stock` porque el prompt no lo menciona).

Tallas (extensión 2026-09-14): el stock-mock trae el modelo `PLY-ROJ` "Playera roja"
con CH 4, M 0, G 7, XG 1; "¿tienen playera roja?" → `Playera roja (PLY-ROJ) — $219 MXN.
Tallas: CH 4, M agotada, G 7, XG 1`; "… en G" → `talla G: 7 pieza`; "… en M" →
`talla M: agotada … Con existencia: CH 4, G 7, XG 1`; "… en XXG" → `no viene en
talla XXG`; "¿cuánto cuesta la PLY-ROJ-G?" → `(PLY-ROJ-G) talla G`.

## 3. Self-test manual en navegador (Playwright o a mano)

1. Iniciar sesión; en la barra lateral aparece **Inventario** tras Pipeline (y Citas
   si `AGENDA=on`); en móvil (375 px) dentro del cajón.
2. Pulsar → pestaña nueva con "Inventario de prueba — <tu nombre> desde Uniko" (el
   mock). Cerrar y pulsar de nuevo → otro pase (`_state.lastSso.jti` distinto).
3. Ajustes → Inventario: se ve `http://localhost:3000/api/dev/stock-mock` y "Probar
   conexión" → "Conectado". `POST _mode {"mode":"unauthorized"}` → "Llave
   rechazada"; `down` → "Servicio no disponible"; `_reset`.
4. Laboratorio: crear una conversación de prueba y escribir "¿cuánto cuesta la
   PLY-NEG?" → el agente responde con "$199 MXN"; en el transcript no hay texto de
   error.
5. Ver el código fuente de Ajustes y la respuesta de `status`: sin llave ni secreto.

## 4. Contra MS-Stock real en local (contrato de verdad)

Con el repo hermano corriendo (`uv run uvicorn app.main:create_app --factory --port
8000` en `../MS-Sotck`, con `UNIKO_SSO_SECRET` igual a `STOCK_SSO_SECRET` de aquí):

```bash
STOCK_BASE_URL=http://127.0.0.1:8000
STOCK_API_KEY=<STOCK_API_KEY del .env de MS-Stock>
```

Repetir 3.1–3.2 (aterriza en el portal real con "<nombre> desde Uniko" y "Volver a
Uniko" → `http://localhost:3000`) y 3.4 con un producto real (`PLY-NEG`).

## 5. Despliegue e instancia de pruebas

1. Merge a `main` → deploy automático de `uniko-lanco` (las variables `STOCK_*` ya
   están cargadas desde 2026-09-12). Poner **`INVENTARIO=on`** en Coolify por MCP y
   redesplegar; `GET /api/health` → `ok` (si faltara una variable, `503` y el
   contenedor anterior sigue: FR-1102).
2. En `https://uniko.lanco.cloud`: botón → `https://stock.lanco.cloud/portal` con
   "<nombre> desde Uniko"; Ajustes → Inventario → "Conectado"; en el Laboratorio,
   "¿tienen PLY-NEG?" responde con los datos reales (SC-007). Registrar resultados
   al final de este archivo.
3. **No** promover a `production` en esta feature (puerta de promoción: señal
   explícita del dueño).
4. **Foto del producto (extensión 2026-09-13)**: en la instancia de pruebas, por
   WhatsApp real, pedir "FOTO-TEST" (producto con foto en `stock.lanco.cloud`) ⇒
   texto + imagen en el mismo turno; un producto sin foto ⇒ solo texto; con el envío
   de la imagen fallando ⇒ solo texto y ningún error visible. Registrar abajo.

## Criterio de "Hecho"

Gate verde (matriz apagada/encendida), `pnpm test:e2e` verde con
`inventarioChecks()`, self-test manual §3, contrato real §4 y verificación en la
instancia de pruebas §5.2 registrados aquí.

## Resultados del self-test local — 2026-09-12 (T021, T027, T031, T034)

- **Gate**: `pnpm typecheck` ✓ · `eslint src tests` ✓ · `pnpm build` ✓ (rutas
  `/api/inventario/sso`, `/api/inventario/status`, `/settings/inventario`) ·
  `pnpm test` **657/657** con `INVENTARIO` vacía y con `on` (18 tests nuevos en 8
  archivos). Nota local: Node 24 en la máquina (el repo pide 22; `pnpm` solo avisa);
  `pnpm lint` a secas arrastra ruido de `.claude/worktrees/` (worktrees viejos,
  ignorados por git, no por ESLint) — la CI corre sobre un checkout limpio.
- **`pnpm test:e2e` con la bandera encendida**: **133/133**. Sección 026: los 5
  casos felices de `check_stock` (línea exacta por producto, agotado, sin precio,
  sin coincidencias, SKU exacto), la gorra inactiva nunca aparece, la frase del
  modelo precede a los datos; degradación en `down`/`unauthorized`/`slow`/`garbage`
  → solo "Déjame revisar." en 6.4 s / 6.5 s / 9.6 s / 6.4 s (6 s son la coalescencia
  del agente; el `slow` suma el timeout de 3 s); botón: 401 sin sesión, 302 con
  pase, el mock saluda por nombre, claims exactos (`sub`, `name`, `iss`, `aud`,
  vida 120), `jti` nuevo por clic, `next` interno sí / externo no; estado:
  `connected` / `unauthorized` / `unavailable`, sin llave ni secreto en `status` ni
  en el HTML de Ajustes.
- **Con la bandera apagada** (misma app, `INVENTARIO=`): **112/112**; las rutas y
  la página → 404 y "¿tienen playera negra?" recibe el eco normal (el ai-mock no
  propone `check_stock` porque el prompt no lo menciona).
- **Hallazgo del arnés**: 26 fallos de la primera corrida eran estado viejo de la
  base local (ids de mensaje ya ingeridos ⇒ ventana de 24 h cerrada), no producto:
  con la base recreada (`DROP/CREATE` + `pnpm db:dev`) todo verde. Y el CRM
  normaliza `521…` → `52…`: el outbox se filtra con el número "al cable".
- **Navegador (Chromium 1280×800 y 375×812 @2x)**: renglón "Inventario" tras
  Pipeline (`Bandeja · Pipeline · Inventario · Contactos · Agente · Laboratorio`),
  `target=_blank`; en móvil dentro del cajón; clic ⇒ pestaña nueva "Inventario de
  prueba — Operador E2E desde Uniko"; Ajustes → Inventario "Conectado"; sin
  desbordamiento horizontal.
- **§4 MS-Stock real en local** (`STOCK_BASE_URL=http://127.0.0.1:8000`, mismo
  secreto): botón ⇒ **portal real** en 0.72 s con "Operador E2E desde Uniko" y
  "Volver a Uniko" → `http://localhost:3000` (MS-Stock: `sso login ok`); Ajustes
  "Conectado"; "¿cuánto cuesta la PLY-NEG?" ⇒ "Déjame revisar.\nPlayera negra
  (PLY-NEG): 17 pieza — $199 MXN" (17 = existencia real de esa base, no la del
  mock). Un intento previo falló porque en el puerto 8000 seguía viva una instancia
  vieja de MS-Stock con otro secreto: el rechazo fue el esperado (`bad_signature`).

## Resultados del despliegue en la instancia de pruebas — 2026-09-12 (T035–T036)

- `main` = `e143555` → deploy por webhook de `uniko-lanco`; `INVENTARIO=on` creada por
  MCP en Coolify (runtime) junto a las `STOCK_*` ya cargadas; el contenedor nuevo
  arrancó con `[migrate] migraciones aplicadas` y `Ready` (sin error de entorno:
  las tres variables validaron); `GET /api/health` → `{"ok":true,"commit":"e143555"}`.
- Sin sesión: `GET /api/inventario/sso` → **401** y `GET /api/inventario/status` →
  **401** (la superficie existe: bandera encendida); `/settings/inventario` → 307 al
  login. `https://stock.lanco.cloud/health` → ok y su `/portal/sso` responde (400 sin
  token): el destino del botón está vivo y con SSO encendido (feature 003).
- **Pendiente de verificación humana** (Principio IX: lo que las herramientas no
  pueden hacer sin credenciales del dueño — el registro está cerrado y una sesión
  no se puede iniciar sin contraseña): entrar en `https://uniko.lanco.cloud`, pulsar
  **Inventario** (debe abrir `https://stock.lanco.cloud/portal` con "<nombre> desde
  Uniko"), Ajustes → Inventario → "Probar conexión" (debe decir "Conectado") y, en el
  Laboratorio, preguntar "¿tienen PLY-NEG?" (debe responder con existencia y $199
  MXN reales). El mismo flujo quedó verificado en local contra MS-Stock real (§4) y
  en la instancia de pruebas de MS-Stock (feature 003, §8.3 de su quickstart).
- No se promueve a `production` (puerta de promoción: señal explícita del dueño).
- **Verificación humana hecha (2026-09-12, el dueño)**: en `uniko.lanco.cloud`, el
  agente confirmó existencia y precio de "Playera negra" y, de "Playera blanca",
  solo el precio con la marca de **agotado** (existencia 0 en `stock.lanco.cloud`).
  Es el comportamiento especificado en FR-1111 (`Playera blanca (PLY-BLA): agotado —
  $199 MXN`): el precio es un dato del producto, no de la existencia. (028: con dos o
  más productos resueltos, los agotados ya no se mencionan; con uno, sigue igual.) Con esto la
  026 está **Hecha** de punta a punta en la instancia de pruebas.

## Resultados de la foto del producto — 2026-09-13 (T038–T047, extensión)

- Gate verde (`typecheck`, `lint`, `build`, 671 tests). `e2e-selftest.mjs`: **147/147**
  con `INVENTARIO=on` (14 checks nuevos de la foto) y **112/112** con la bandera vacía;
  `e2e-lab.mjs`: **36/36** encendida (escenario propio "¿tienen playera negra?" corre
  en el sandbox: el mensaje queda `type: image` con `payload.url` y el pie como texto,
  el outbox del wa-mock no crece) y 32/32 apagada. Bases desechables
  `uniko_dev_026f` / `uniko_dev_026off`.
- Evidencia del camino infeliz en el log del servidor: `[agente] foto: no se pudo
  enviar la imagen ((#100) Param image['link'] is not a valid URL); sale solo el
  texto` (rechazo) y `(... Meta no está disponible ahora)` (espera cortada a los 5 s:
  el texto salió en 11.4 s = 6 s de coalescencia + 5 s de límite).
- Hilo revisado en el navegador (1440 px y 375 px): imagen + pie marcado IA; en el
  caso `failed` tardío, la foto con "No se entregó. Media upload error (Meta 131053)"
  y el texto de respaldo después.
- CI de la PR #28 verde en `default` y `completo`.
- La consulta directa a `stock.lanco.cloud/v1/agent/products/FOTO-TEST` con la
  llave no se pudo hacer desde la sesión (el modo automático bloquea usar la llave
  en `curl`); la forma de `image_url` la valida el adaptador en el turno.

## Resultados del despliegue de la foto en la instancia de pruebas — 2026-09-14 (T048)

- El dueño hizo el merge de la PR #28 (`2fa5714`) y el deploy de `uniko-lanco`;
  `GET /api/health` → `{"ok":true,"commit":"2fa5714"}` **10/10** seguidos. Después
  entró también la PR #29 (tallas, `3c38120`), que es el commit que corre ahora
  (`/api/health` lo confirma; el contenedor arrancó con `[migrate] migraciones
  aplicadas` y `Ready` el 2026-09-14 13:47 UTC).
- **Verificación humana (2026-09-14, el dueño)**: por WhatsApp real preguntó por la
  playera negra y confirmó que "se recibió todo en orden"; después pidió
  **`FOTO-TEST`** (el producto con foto en `stock.lanco.cloud`) y **llegó la foto**:
  texto + imagen en el mismo turno, por la API real de Meta, con la imagen servida
  desde la URL pública de MS-Stock (SC-008 en vivo).
- Evidencia del lado servidor: el log del contenedor **no** tiene ninguna línea
  `[agente] inventario:` ni `[agente] foto:` — el camino feliz no escribe nada; si
  MS-Stock hubiera fallado o Meta hubiera rechazado o retrasado la imagen, el motivo
  habría quedado ahí (como se vio en local con el wa-mock en `reject`/`slow`).
- No se promueve a `production` (puerta de promoción: señal explícita del dueño).

## Resultados de las tallas — 2026-09-14 (T049–T056, extensión)

- Gate verde (`typecheck`, `lint`, `build`, 686 tests: 15 nuevos). `e2e-selftest.mjs`:
  **153/153** con `INVENTARIO=on` (6 checks nuevos de tallas: modelo sin talla pedida,
  talla con existencia, talla agotada con las que sí hay, talla inexistente, SKU
  exacto de una talla, y "ninguna cifra la redactó el modelo") y **112/112** con la
  bandera vacía. Bases desechables `uniko_dev_026t` / `uniko_dev_026toff2`.
- Gotcha del entorno: en Windows `pkill` no mata `next dev`; un segundo `pnpm dev`
  arranca en 3001 y el arnés le pega al viejo en 3000 (falsos rojos). Matar con
  `taskkill //F //PID <pid> //T` (o `//IM node.exe`) antes de relanzar.
- Los cinco casos previos de US2 y los de la foto no cambian de texto (el modelo
  `PLY-ROJ` va al final del catálogo del mock para no mover el orden).
- Pendiente (T057): merge a `main` = señal del dueño; tras el deploy de `uniko-lanco`,
  preguntar por un modelo real de `stock.lanco.cloud` en el Laboratorio o por WhatsApp.


## Promoción a `production` — 2026-09-14 (22:12 hora local; 2026-09-15 04:12 UTC)

- Señal explícita del dueño ("aplica la promoción pero deja apagado INVENTARIO").
  Puerta (`promote-gate.sh`): CI verde para `8d91b78` en `default` y `completo`;
  LanCo corriendo `8d91b78` 10/10; 18 commits (toda la 026); no toca `drizzle/`.
  Declaradas por el dueño en la misma conversación: uso real por WhatsApp
  ("playera negra" y "FOTO-TEST" con foto). Self-test IX contra LanCo desplegada:
  `e2e-mocks-404.mjs --base=https://uniko.lanco.cloud` **22/22** (la ruta nueva
  `wa-mock/media-mode` también en 404). Plan de reversión: redesplegar `88c9bc1`
  (sin migración ni variable nueva; en clientes la bandera apagada no produce datos).
- `git checkout production && git merge --ff-only main && git push`:
  `88c9bc1..8d91b78`. Coolify redesplegó `uniko-iltu` y `uniko-nuriaandrea`
  (~5 min de relevo cada una); `verify-fleet.sh` **3/3** en `8d91b78` y 10/10 en
  cada instancia.
- `INVENTARIO` **apagada en los clientes** (verificado en Coolify: ninguna de las dos
  apps tiene `INVENTARIO` ni `STOCK_*`): sin sesión `/api/inventario/*` → 401 (igual
  que toda ruta autenticada) y con sesión → 404, como la agenda; `/api/dev/*` → 404.
  Solo `uniko-lanco` tiene el conector encendido.
