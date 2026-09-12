# Research — 026 Conector INVENTARIO

**Fecha**: 2026-09-12 · **Constitución**: 1.7.0 · Contrato fuente:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md)
y [`sso-token.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/sso-token.md)
(repo MS-Stock, feature 003, desplegada en `https://stock.lanco.cloud`).

## R1. Bandera `INVENTARIO`, calcada de `AGENDA`

- **Decisión**: `src/server/inventario/flag.ts` con `parseInventarioFlag(raw)` (los
  mismos `ON_VALUES` que la agenda), `inventarioEnabled()` leyendo `process.env`
  directo (nunca `getEnv()`: preguntar si la feature existe no puede depender de que
  todo el entorno valide) y `inventarioDisabledResponse()` → `404` sin cuerpo.
- **Rationale**: ADR-001 y Principio II.3.1; una bandera por módulo, apagada por
  defecto, superficie en `404`. Copiar el helper (y no generalizarlo) mantiene cada
  módulo legible por sí solo, como ya hacen `agenda`, `attribution` y `push`.

## R2. Variables: exigidas solo con la bandera encendida, validadas en `env.ts`

- **Decisión**: al `envSchema` se agregan `INVENTARIO` (opcional), `STOCK_BASE_URL`
  (URL; se le quita la `/` final), `STOCK_API_KEY` y `STOCK_SSO_SECRET` (opcionales,
  ≥ 32 caracteres cuando están) y un `superRefine`: con `INVENTARIO` encendida las
  tres son obligatorias. `getEnv()` es perezosa: el primer uso (`getDb()` en el boot,
  `/api/health`) lanza el error que nombra la variable → `/api/health` responde `503`
  → el despliegue queda **no saludable** y la plataforma conserva el contenedor
  anterior (FR-1102: "no arranca a medias"). Con la bandera apagada no se exigen ni
  se leen.
- **Rationale**: es exactamente cómo se comportan hoy `DATABASE_URL` o
  `ENCRYPTION_KEY` inválidas; no hay que inventar un mecanismo de arranque nuevo.
- **Alternativas**: leer `STOCK_*` en el conector y degradar si faltan — dejaría una
  instancia "encendida" que nunca funciona y solo se nota en logs. Rechazada.

## R3. Adaptador dedicado `src/server/inventario/client.ts` (Principio II.3.2, FR-1114)

- **Decisión**: un módulo que es el único que conoce HTTP de MS-Stock:
  `getProduct(sku)`, `searchProducts(query, limit=5)`, `health()`, y la composición
  `lookup(query)` (si `looksLikeSku(query)` → producto exacto; `not_found` → búsqueda).
  Cada llamada: `fetch` con `AbortController` a **3 000 ms**, header `X-API-Key`,
  sin reintentos; respuesta validada con Zod (`stockProductSchema`,
  `searchResultSchema`); resultado discriminado `{ ok: true, data } | { ok: false,
  error: "not_found" | "unauthorized" | "unavailable" | "timeout" | "invalid" |
  "network" }` — nunca lanza. `looksLikeSku`: sin espacios, ≤ 64, `[A-Za-z0-9][A-Za-z0-9._/-]*`.
- **Forma del producto** (contrato §4): `sku`, `name`, `description|null`, `stock`
  (número, ≤ 2 decimales), `unit`, `price|null`, `currency`, `available`.
- **Rationale**: mismo patrón que `src/lib/meta` y `src/lib/ai`: el dominio pide
  "busca esto" y recibe datos o un motivo de fallo tipado; la degradación se decide
  arriba con un `switch` exhaustivo, no con `try/catch` dispersos.

## R4. Acción `check_stock` y prompt, como `offer_slots`

- **Decisión**: en `actions.ts`, `inventarioActions = [z.object({ action:
  z.literal("check_stock"), query: z.string().min(2).max(100), reply:
  z.string().optional() })]`; `agentActionSchema({ agenda, inventario })` pasa a
  recibir un objeto de banderas (único llamador: `pipeline.ts`); `degradeAction`
  trata `check_stock` como `offer_slots`: `reply` si hay, `none` si no. En
  `prompts.ts`, `buildAgentSystemPrompt({ …, inventario })` añade la línea de la
  acción y las reglas: consultar **antes** de afirmar existencia o precio; no
  inventar; usar el SKU tal cual si el cliente lo da; el sistema pega los datos.
- **Rationale**: FR-1108/FR-1109; con la bandera apagada el esquema del turno no
  contiene la acción y el prompt no gasta un token (SC-004), igual que la agenda.

## R5. El sistema pega los datos: `src/server/inventario/agent.ts`

- **Decisión**: `checkStockTurn({ query, intro }) → { text, ok }` (misma forma que
  `AgendaTurn`). Con datos: `intro` (si viene) + una línea por producto, máximo 5:
  `Playera negra (PLY-NEG): 7 pieza — $199 MXN` · agotado: `…: agotado — $199 MXN`
  · sin precio: `…: 7 pieza — sin precio`; si `truncated`: `Hay más coincidencias,
  ¿me dices cuál te interesa?`. Sin coincidencias: `No encontré productos para
  «<query>».` (`ok: true`: es una respuesta válida). Cualquier `error` del adaptador
  ⇒ `ok: false` (el pipeline degrada). Precio con `Intl.NumberFormat("es-MX")` y la
  moneda que devuelve MS-Stock; cantidades hasta 2 decimales.
- **Rationale**: FR-1111; determinista y sin segunda llamada al modelo (una acción
  por turno, FR-021 de la 001); el mismo texto sirve en el Laboratorio.

## R6. Pipeline: ejecutar y degradar

- **Decisión**: en `pipeline.ts`, junto al bloque de agenda: si
  `action.action === "check_stock"`: sin bandera → `degradeAction`; con bandera →
  `checkStockTurn`; `ok` ⇒ `deliverReply(turn.text)` y `return`; `!ok` ⇒
  `console.error("[agente] inventario: <error>")` + `degradeAction` y sigue al
  `switch` habitual. Sin cambio en `deliverReply`, handoff ni SSE. Las
  conversaciones `isTest` (Laboratorio) consultan igual: es lectura (FR-1113).
- **Rationale**: FR-1112 y SC-003: el fallo cuesta como máximo 3 s y el cliente
  recibe la frase del modelo o nada, nunca un error.

## R7. Pase SSO con `jose` y ruta de servidor

- **Decisión**: dependencia directa `jose@^6` (ya presente vía Better Auth; se
  declara para no depender de un transitivo). `src/server/inventario/sso.ts`:
  `issueSsoUrl({ userId, name, next? })` → `SignJWT({ name, next? })` HS256 con
  `STOCK_SSO_SECRET`, `iss = APP_BASE_URL`, `aud = STOCK_BASE_URL`, `sub = userId`,
  `jti = randomUUID()`, `iat` ahora, `exp = +120 s` → `${STOCK_BASE_URL}/portal/sso?token=…`.
  Ruta `GET /api/inventario/sso` (`src/app/api/inventario/sso/route.ts`,
  `force-dynamic`): bandera apagada → `404`; sin sesión → `401` (`withAuth`); el
  nombre sale de la sesión de Better Auth (`session.user.name`, con `email` de
  respaldo); `?next=` solo si empieza por `/portal`; responde `302` a MS-Stock.
- **Botón**: `app-nav.tsx` gana `INVENTARIO_ITEM` (`href: "/api/inventario/sso"`,
  icono `Package`, `external: true` ⇒ `<a target="_blank" rel="noopener">` en vez
  de `<Link>`), insertado tras Pipeline y Citas; `layout.tsx` pasa
  `inventario={inventarioEnabled()}`.
- **Rationale**: contrato `sso-token.md` al pie de la letra; FR-1104–FR-1107. Un pase
  por clic, nada se guarda (no hay tabla).

## R8. Estado del conector en Ajustes

- **Decisión**: `GET /api/inventario/status` (`withAuth`; bandera apagada → `404`)
  responde `{ baseUrl, status: "connected" | "unauthorized" | "unavailable" }`
  probando en orden: `health()` (sin llave; `503`/red/timeout ⇒ `unavailable`) y
  luego `getProduct("UNIKO-STATUS-PROBE")` con la llave: `not_found` ⇒
  `connected` (la llave fue aceptada y la base respondió), `unauthorized` ⇒
  `unauthorized`, otro ⇒ `unavailable`. Pestaña "Inventario" en `SettingsNav`
  (después de "Agenda"), página `settings/inventario` (`notFound()` sin bandera) con
  `InventarioClient`: dirección, botón "Probar conexión", resultado en llano y una
  nota: "si la API conecta pero el botón Inventario dice *no válido*, los secretos
  de SSO no coinciden".
- **Rationale**: FR-1115, US3; no se persiste nada.

## R9. Mocks del self-test: `stock-mock` + regla en `ai-mock`

- **Decisión**: `src/app/api/dev/stock-mock/[...path]/route.ts` tras `mockGuard()`
  (y el middleware de la 024 ya cubre el prefijo) con estado en
  `src/server/dev/stock-mock-state.ts`: catálogo fijo (`PLY-NEG` "Playera negra"
  7 pieza $199 MXN; `PLY-BLA` "Playera blanca" 0 $199; `GOR-01` "Gorra" 3 pieza sin
  precio; `TAZ-01` "Taza" 12 pieza $89; `GOR-02` inactiva), `mode` ∈ `ok` |
  `unauthorized` | `down` | `slow` (4 s) | `garbage`, y rutas: `GET /health`,
  `GET /v1/agent/search?q&limit`, `GET /v1/agent/products/{sku}` (todas exigen
  `X-API-Key === STOCK_API_KEY` salvo `/health`; `sku` se compara en mayúsculas),
  `GET /portal/sso?token=` (verifica el JWT con `STOCK_SSO_SECRET` vía `jose`,
  guarda los claims en `lastSso` y devuelve HTML "Inventario de prueba — {name}
  desde Uniko" — o `400` con el motivo), `_state`, `_reset`, `_mode` (POST).
  En el self-test `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock`.
- **ai-mock**: nueva regla, **solo si el system prompt contiene `check_stock`**
  (si no, la bandera está apagada y el modelo real tampoco la conocería):
  `/(tienen|tienes|hay|cuánto cuesta|cuanto cuesta|precio de)\s+(.+?)\??$/i` →
  `{ action: "check_stock", query: <grupo 2>, reply: "Déjame revisar." }`.
- **Rationale**: Principio II.3.5 y FR-1116; el mock del portal permite verificar el
  SSO de punta a punta sin MS-Stock, y contra MS-Stock local o remoto se verifica
  además el contrato real (quickstart).

## R10. Pruebas y CI

- **Unit (Vitest)**: `inventario-flag`, `inventario-env` (refine con bandera
  on/off), `stock-client` (fetch falso: 200/401/404/503/timeout/JSON roto →
  resultado tipado; timeout < 3.5 s), `check-stock-turn` (formato de líneas, agotado,
  sin precio, vacío, truncado), `inventario-actions` (esquema con/sin bandera;
  `degradeAction`), `inventario-prompt` (líneas presentes solo con bandera),
  `inventario-sso` (claims del pase decodificados con `jose`: iss/aud/sub/name/jti/
  vida 120), `ai-mock-inventario` (regla solo con el marcador en el system prompt).
- **E2E** (`scripts/e2e-selftest.mjs` → `inventarioChecks()`; guion
  `tests/e2e/us-inventario.md`): bandera apagada → `404` en `/api/inventario/sso` y
  `/status`; encendida → pase válido (el stock-mock registra `lastSso` con el nombre
  de la sesión), `check_stock` feliz por wa-mock (la respuesta contiene "7 pieza" y
  "$199"), agotado, sin coincidencias, `_mode=down|unauthorized|slow` ⇒ el agente
  responde sin inventario en < 6 s y sin texto técnico, `status` ⇒ `connected` /
  `unauthorized` / `unavailable`. Además, comprobación literal de que ni la llave
  ni el secreto aparecen en el HTML de Ajustes ni en la respuesta de `status`.
- **CI**: la matriz gana `inventario: ""` / `"on"` con `STOCK_*` de mentira en la
  configuración `completo` (los tests unitarios no hacen red).
- **Rationale**: FR-1116/FR-1117, SC-002–SC-006.
