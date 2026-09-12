---
description: "Tareas de la 026 — Conector INVENTARIO: botón Inventario (SSO a MS-Stock) y check_stock del agente"
---

# Tasks: 026 — Conector INVENTARIO

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) · [quickstart.md](quickstart.md)
· contrato de MS-Stock: [`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md)

**Tests**: SÍ. La constitución (V, IX) y la spec (FR-1116, FR-1117) los exigen: unit
por módulo, `stock-mock` con camino infeliz, `inventarioChecks()` en el arnés E2E y
matriz de CI apagada/encendida. Los tests de cada historia se escriben primero y
deben fallar antes de implementar.

**Organización**: por historia de usuario, en orden de prioridad (US2 antes que US1:
el adaptador y la acción son el valor de negocio y no dependen del botón).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1 (botón + pase SSO), US2 (`check_stock`), US3 (Ajustes → estado)
- Rutas exactas desde la raíz del repositorio

---

## ⛔ Dos reglas de orden que no son recomendaciones

### 1. El ai-mock solo propone `check_stock` si el prompt la menciona

Con la bandera apagada, `chatJson(agentActionSchema(...))` no conoce la acción: si
el mock la devolviera igual, el turno fallaría el parseo y **escalaría a humano**
("fallo del proveedor"). Un self-test con la bandera apagada se pondría rojo por una
regla del mock, no por el producto. Por eso la regla del ai-mock (T024) condiciona
por `system.includes("check_stock")` y tiene su propio test. No es una
optimización: es lo que mantiene válida la corrida `default` de la matriz.

### 2. Bandera apagada = cero cambio, y se comprueba ANTES de cerrar

Toda superficie nueva pasa primero por `inventarioEnabled()` (404 / `notFound()` /
sin renglón). La última tarea de cada fase corre la suite con `INVENTARIO` vacía
además de encendida (SC-004). Una prueba que solo pase con la bandera encendida
está probando la mitad que no corre en ninguna instancia por defecto.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencia, bandera, variables y estructura vacía

- [X] T001 Declarar `jose` como dependencia directa: `pnpm add jose@^6` (ya está en el lockfile vía Better Auth; solo se hace explícita) y commitear `package.json` + `pnpm-lock.yaml`
- [X] T002 [P] Crear `src/server/inventario/flag.ts` con `parseInventarioFlag(raw)` (mismos `ON_VALUES` que `src/server/agenda/flag.ts`), `inventarioEnabled()` (lee `process.env.INVENTARIO` directo) e `inventarioDisabledResponse()` (`404` sin cuerpo), con el comentario de por qué no pasa por `getEnv()`; test `tests/unit/inventario-flag.test.ts` calcado de `agenda-flag.test.ts`
- [X] T003 [P] Extender `src/lib/env.ts`: `INVENTARIO` (opcional), `STOCK_BASE_URL` (`z.string().url()` + `transform` que quita la `/` final), `STOCK_API_KEY` y `STOCK_SSO_SECRET` (`z.string().min(32).optional()`), y un `superRefine` que, con `parseInventarioFlag(INVENTARIO)` verdadero, exija las tres con mensaje `"<VAR>: obligatoria con INVENTARIO encendida (ver .env.example)"`; test `tests/unit/inventario-env.test.ts` (apagada: no exige; encendida sin una: `getEnv()` lanza nombrando la variable; encendida completa: normaliza la barra final)
- [X] T004 [P] Documentar en `.env.example` el bloque `# 026 — Conector de inventario (MS-Stock)` con las cuatro variables comentadas y guía inline (origen público sin `/` final; llave = `STOCK_API_KEY` de esa instancia; secreto = `UNIKO_SSO_SECRET` de esa instancia, `openssl rand -hex 32`), y en `.env` local los valores del mock del quickstart §0 (`INVENTARIO=on`, `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock`, llave y secreto de desarrollo ≥ 32) — `.env` está gitignored
- [X] T005 [P] Crear vacíos con docstring: `src/server/inventario/client.ts`, `src/server/inventario/agent.ts`, `src/server/inventario/sso.ts`, `src/server/dev/stock-mock-state.ts`, `src/app/api/dev/stock-mock/[...path]/route.ts`, `tests/e2e/us-inventario.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el adaptador tipado y el `stock-mock`: sin ellos ninguna historia se prueba de punta a punta.

**⚠️ CRITICAL**: ninguna historia empieza hasta cerrar esta fase

- [X] T006 Escribir `tests/unit/stock-client.test.ts` con `fetch` falso (`vi.stubGlobal`): `getProduct` → `200` producto válido; `404` ⇒ `not_found`; `401` ⇒ `unauthorized`; `503` ⇒ `unavailable`; JSON roto o forma inválida (falta `stock`) ⇒ `invalid`; `fetch` que rechaza ⇒ `network`; una promesa que no resuelve ⇒ `timeout` en < 3.5 s (`vi.useFakeTimers`); `searchProducts` → `{ results, truncated }` y `422` ⇒ `invalid`; `lookup("PLY-NEG")` llama primero al exacto y, con `404`, a la búsqueda; `lookup("playera negra")` va directo a la búsqueda; `looksLikeSku` (`"PLY-NEG"` sí, `"playera negra"` no, 65 caracteres no); el header `X-API-Key` viaja con `STOCK_API_KEY` y la llave no aparece en ningún `console.error`
- [X] T007 Implementar `src/server/inventario/client.ts` según [contracts/conector-inventario.md](contracts/conector-inventario.md) y research R3: `stockProductSchema`/`searchResultSchema` (Zod), `StockResult<T>`, `request(path, { auth })` con `AbortController` a 3 000 ms, mapeo de status → error, `getProduct`, `searchProducts(query, limit = 5)`, `lookup`, `health`, `looksLikeSku`; nunca lanza; `console.error("[inventario] …")` sin la llave
- [X] T008 [P] Implementar `src/server/dev/stock-mock-state.ts` (catálogo fijo de [contracts/stock-mock.md](contracts/stock-mock.md), `mode`, `lastSso`, `calls`, `resetStockMock()`, `stockMockSnapshot()`, `setStockMockMode()`, búsqueda sin acentos/mayúsculas con `normalize("NFD")`) y `src/app/api/dev/stock-mock/[...path]/route.ts` (`mockGuard()` primero; `GET`: `health`, `v1/agent/search`, `v1/agent/products/<sku>`, `portal/sso` (verifica con `jose.jwtVerify` usando `STOCK_SSO_SECRET`, `audience = STOCK_BASE_URL`, guarda `lastSso`, HTML `<h1>Inventario de prueba</h1><p>{name} desde Uniko</p>` o `400` con el motivo), `_state`; `POST`: `_mode`, `_reset`; los modos `unauthorized`/`down`/`slow` (4 s)/`garbage` aplican a `/v1/*` y `/health`); comprobar que `tests/unit/mocks-404-incondicional.test.ts` sigue verde (la ruta vive bajo el prefijo del middleware)
- [X] T009 [P] Escribir `tests/unit/stock-mock.test.ts` llamando al handler directamente con `WA_MOCK_ENABLED=true` y `NODE_ENV=test`: llave incorrecta ⇒ `401`; `q` corto ⇒ `422`; `playera` ⇒ 2 resultados; `GOR-02` inactiva ⇒ `404`; `ply-neg` ⇒ `200` (mayúsculas); `_mode down` ⇒ `503` en `/health`; `NODE_ENV=production` ⇒ `404`
- [X] T010 Gate parcial: `pnpm typecheck && pnpm lint && pnpm test` en verde con `INVENTARIO` vacía y con `INVENTARIO=on`

**Checkpoint**: adaptador y mock listos y probados; nada visible aún para el usuario.

---

## Phase 3: User Story 2 - El agente consulta existencias reales antes de afirmarlas (Priority: P1) 🎯 MVP

**Goal**: `check_stock` en esquema y prompt solo con la bandera; el sistema pega el texto; fallo ⇒ degradación como la agenda; el Laboratorio consulta igual.

**Independent Test**: con la app viva y los mocks, wa-mock inbound "¿tienen playera negra?" produce una respuesta saliente con "Playera negra (PLY-NEG): 7 pieza — $199 MXN"; con `_mode down` la respuesta es "Déjame revisar." en < 6 s y el log dice `[agente] inventario: unavailable`; con la bandera apagada la respuesta es el eco normal y el esquema del turno no tiene `check_stock`.

### Tests for User Story 2

- [X] T011 [P] [US2] Escribir `tests/unit/inventario-actions.test.ts`: `agentActionSchema({ agenda: false, inventario: true })` acepta `{ action: "check_stock", query: "playera", reply: "..." }` y rechaza `query` de 1 carácter o 101; con `inventario: false` la rechaza; `degradeAction` de `check_stock` con `reply` ⇒ `reply`, sin ⇒ `none`
- [X] T012 [P] [US2] Escribir `tests/unit/inventario-prompt.test.ts`: `buildAgentSystemPrompt({ …, inventario: true })` contiene `"check_stock"`, "antes de afirmar" y "no inventes"; con `inventario: false` (o ausente) no contiene `check_stock` ni "inventario"
- [X] T013 [P] [US2] Escribir `tests/unit/check-stock-turn.test.ts` (adaptador mockeado con `vi.mock("@/server/inventario/client")`): producto exacto ⇒ una línea `Playera negra (PLY-NEG): 7 pieza — $199 MXN`; agotado ⇒ `agotado`; sin precio ⇒ `sin precio`; 2.5 ⇒ `2.5 kg`; `intro` precede al listado; `truncated` ⇒ termina en "¿me dices cuál te interesa?"; vacío ⇒ `No encontré productos para «zapatos».` con `ok: true`; cualquier `error` ⇒ `ok: false` y `text` = `intro` o `""`
- [X] T014 [P] [US2] Escribir `tests/unit/ai-mock-inventario.test.ts`: con el system prompt que contiene `check_stock`, `"¿tienen playera negra?"` ⇒ `{ action: "check_stock", query: "playera negra", reply: … }`, `"cuánto cuesta la PLY-NEG"` ⇒ `query: "la PLY-NEG"` → normalizado a `"PLY-NEG"` (quitar artículos `el/la/los/las/una/un` al inicio); sin el marcador en el prompt ⇒ la respuesta de eco de siempre

### Implementation for User Story 2

- [X] T015 [US2] Extender `src/server/ai/actions.ts`: `inventarioActions` (`check_stock`: `query` 2–100, `reply` opcional), `agentActionSchema(flags: { agenda: boolean; inventario: boolean })` (actualizar el único llamador en `pipeline.ts`), `AgentAction` incluye ambas familias, `degradeAction` trata `check_stock` como `offer_slots`
- [X] T016 [US2] Extender `src/server/ai/prompts.ts`: parámetro `inventario?: boolean`; línea de acción `- {"action":"check_stock","query":"<lo que el cliente pidió: nombre, parte del nombre o SKU>","reply":"..."} — consultar existencias y precio reales (reply es solo la frase de entrada; los datos los pega el sistema).` y reglas: consultar **antes** de afirmar existencia o precio; NUNCA inventar existencias ni precios; si el cliente da un SKU, usarlo tal cual; responder con lo que el sistema devuelva
- [X] T017 [US2] Implementar `src/server/inventario/agent.ts`: `checkStockTurn({ query, intro }) → Promise<{ text: string; ok: boolean }>` con `lookup` del adaptador y el formato de [data-model.md](data-model.md) (precio con `Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 })` seguido del código de moneda; cantidades hasta 2 decimales; máximo 5 líneas; `truncated` ⇒ frase final)
- [X] T018 [US2] Extender `src/server/ai/pipeline.ts`: `const inventario = inventarioEnabled()`; pasar `inventario` al prompt y al esquema; bloque `if (action.action === "check_stock")`: sin bandera ⇒ `degradeAction`; con bandera ⇒ `checkStockTurn`; `ok` ⇒ `deliverReply(conversation, turn.text)` + `publish(conversation.updated)` + `return`; `!ok` ⇒ `console.error("[agente] inventario: …")` + `degradeAction`; sin excepción posible (el turno no lanza); las conversaciones `isTest` consultan igual
- [X] T019 [US2] Extender `src/server/dev/ai-mock.ts` con la regla `check_stock` **condicionada a `system.includes("check_stock")`**, antes de la regla de "quiero comprar": regex `/(?:tienen|tienes|hay|cu[aá]nto cuesta|precio de)\s+(.+?)\??$/i`, artículo inicial fuera, `reply: "Déjame revisar."`
- [X] T020 [US2] Guion `tests/e2e/us-inventario.md` (historias, pasos, resultado esperado, camino infeliz) y `inventarioChecks()` en `scripts/e2e-selftest.mjs` (llamada desde `main()` tras `agendaChecks()`): con la bandera apagada → `404` en `/api/inventario/sso` y `/api/inventario/status` y "¿tienen playera negra?" ⇒ eco; encendida → `_reset`, inbound "¿tienen playera negra?" ⇒ outbox contiene "Playera negra (PLY-NEG): 7 pieza" y "$199"; "¿tienen gorra?" ⇒ "sin precio"; "¿tienen playera blanca?" ⇒ "agotado"; "¿tienen zapatos?" ⇒ "No encontré productos"; "¿cuánto cuesta la PLY-NEG?" ⇒ "$199"; para cada `_mode` ∈ `down`, `unauthorized`, `slow`, `garbage`: inbound ⇒ respuesta "Déjame revisar." en < 6 s y sin "error"/"503"/"unauthorized" en el texto; `_reset` al final
- [X] T021 [US2] Gate: `pnpm typecheck && pnpm lint && pnpm test` (bandera vacía y `on`) y `pnpm test:e2e` con la app viva y `INVENTARIO=on`; corregir hasta verde

**Checkpoint**: el agente ya responde con existencias reales (o degrada); MVP del conector.

---

## Phase 4: User Story 1 - Abrir el inventario desde Uniko sin llave (Priority: P1)

**Goal**: renglón "Inventario" (externo, pestaña nueva) tras Pipeline/Citas; `GET /api/inventario/sso` emite el pase conforme al contrato y redirige; 404 sin bandera, 401 sin sesión.

**Independent Test**: con sesión, `GET /api/inventario/sso` ⇒ `302` a `…/stock-mock/portal/sso?token=`; seguir la redirección ⇒ el mock muestra "<nombre> desde Uniko" y `_state.lastSso` trae `sub` = id del usuario, `aud` = `STOCK_BASE_URL`, `iss` = `APP_BASE_URL`, `exp − iat = 120`; dos llamadas ⇒ dos `jti`; sin sesión ⇒ `401`; bandera apagada ⇒ `404`; el renglón existe solo con la bandera.

### Tests for User Story 1

- [X] T022 [P] [US1] Escribir `tests/unit/inventario-sso.test.ts`: `issueSsoUrl({ userId: "usr_1", name: "Gerardo" })` devuelve `${STOCK_BASE_URL}/portal/sso?token=…`; decodificar con `jose.jwtVerify` (mismo secreto): `iss`/`aud`/`sub`/`name`/`jti` (UUID), `exp − iat === 120`, cabecera `alg: HS256`; `next: "/portal/products/X"` incluido y `next: "https://evil"` omitido; `name` de 100 caracteres recortado a 80; dos emisiones ⇒ `jti` distintos
- [X] T023 [P] [US1] Extender `inventarioChecks()` en `scripts/e2e-selftest.mjs`: sin cookie ⇒ `401`; con sesión `GET /api/inventario/sso` (`redirect: "manual"`) ⇒ `302` con `location` que empieza por `STOCK_BASE_URL + "/portal/sso?token="`; `fetch(location)` ⇒ `200` con "desde Uniko"; `_state.lastSso.sub` = id del usuario de la sesión y `name` = su nombre; segunda llamada ⇒ `jti` distinto; `?next=/portal/products/PLY-NEG` ⇒ `lastSso.next` igual; `?next=https://evil.example` ⇒ sin `next`

### Implementation for User Story 1

- [X] T024 [US1] Implementar `src/server/inventario/sso.ts`: `issueSsoUrl({ userId, name, next? })` con `SignJWT` de `jose` (claims de [data-model.md](data-model.md); `name` recortado a 80; `next` solo si `/^\/portal(\/|$|\?)/`), secreto de `getEnv().STOCK_SSO_SECRET`, URL con `encodeURIComponent`
- [X] T025 [US1] Crear `src/app/api/inventario/sso/route.ts` (`force-dynamic`): `inventarioEnabled()` falso ⇒ `inventarioDisabledResponse()`; `withAuth`; nombre desde `getAuth().api.getSession({ headers })` (`user.name` o `user.email`); `next` de la query; `Response.redirect(url, 302)`; ningún log con el token
- [X] T026 [US1] Extender `src/components/app-nav.tsx`: `NavItem` gana `external?: boolean`; `INVENTARIO_ITEM = { href: "/api/inventario/sso", label: "Inventario", icon: Package, external: true }`; prop `inventario`; orden `[Bandeja, Pipeline, Citas?, Inventario?, …]`; los externos se renderizan como `<a target="_blank" rel="noopener">` con la misma clase que `<Link>` y nunca "activo"; `src/app/(app)/layout.tsx` pasa `inventario={inventarioEnabled()}`
- [X] T027 [US1] Gate + `pnpm test:e2e`; Playwright manual (escritorio 1280 y móvil 375): el renglón aparece tras Pipeline (y Citas con `AGENDA=on`), abre pestaña nueva con el mock, no aparece con la bandera apagada

**Checkpoint**: la persona entra al inventario desde Uniko sin llave.

---

## Phase 5: User Story 3 - Saber si el conector está bien conectado (Priority: P3)

**Goal**: pestaña "Inventario" en Ajustes con dirección y "Probar conexión"; `GET /api/inventario/status`; 404 sin bandera.

**Independent Test**: con sesión, `GET /api/inventario/status` ⇒ `{ baseUrl, status: "connected" }`; `_mode unauthorized` ⇒ `unauthorized`; `_mode down` ⇒ `unavailable`; bandera apagada ⇒ `404` y sin pestaña; la respuesta y el HTML no contienen la llave ni el secreto.

### Tests for User Story 3

- [X] T028 [P] [US3] Extender `inventarioChecks()`: `status` en los tres modos; búsqueda literal de `STOCK_API_KEY` y `STOCK_SSO_SECRET` en la respuesta de `status` y en el HTML de `GET /settings/inventario` (con cookie) ⇒ 0 apariciones; bandera apagada ⇒ `404` en ambas rutas

### Implementation for User Story 3

- [X] T029 [US3] Crear `src/app/api/inventario/status/route.ts` (`withAuth`, `force-dynamic`, 404 sin bandera): `health()` ⇒ si falla `unavailable`; luego `getProduct("UNIKO-STATUS-PROBE")`: `not_found` ⇒ `connected`, `unauthorized` ⇒ `unauthorized`, otro ⇒ `unavailable`; responde `{ baseUrl: getEnv().STOCK_BASE_URL, status }`
- [X] T030 [US3] Crear `src/components/settings/inventario-client.tsx` (cliente: muestra `baseUrl`, botón "Probar conexión" → `GET /api/inventario/status` → "Conectado" / "Llave rechazada" / "Servicio no disponible" con el color semántico de los tokens de marca; nota sobre secretos de SSO distintos) y `src/app/(app)/settings/inventario/page.tsx` (`notFound()` sin bandera); `INVENTARIO_TAB` en `src/components/settings/settings-nav.tsx` tras Agenda con prop `inventario`; `src/app/(app)/settings/layout.tsx` la pasa
- [X] T031 [US3] Gate + `pnpm test:e2e`; captura de Ajustes → Inventario en escritorio y 375 px con el skill `frontend-design` como revisión (tokens de marca, sin inventar estilos)

**Checkpoint**: el negocio diagnostica el conector en 10 segundos.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: CI, docs, contrato real contra MS-Stock, despliegue en la instancia de pruebas y cierre.

- [X] T032 [P] Extender la matriz de `.github/workflows/ci.yml`: `inventario: ""` en `default`; `inventario: "on"` en `completo` con `STOCK_BASE_URL: "http://localhost:3000/api/dev/stock-mock"`, `STOCK_API_KEY` y `STOCK_SSO_SECRET` de 40 caracteres de mentira; `env: INVENTARIO: ${{ matrix.config.inventario }}` y las tres `STOCK_*`
- [X] T033 [P] Documentar: `docs/inventario-conector.md` (qué es MS-Stock, variables, cómo encender, qué ve la persona y el agente, degradación, cómo probar con el mock y con MS-Stock local, enlace al contrato de MS-Stock); `README.md` (sección "Inventario (conector opcional)"); `CLAUDE.md` (fila en el mapa del código: `src/server/inventario/` — bandera `INVENTARIO`; nota del `stock-mock` junto a los demás mocks; variables `STOCK_*` en la lista); `docs/desarrollo-local.md` (bloque opcional del conector para el self-test)
- [X] T034 Self-test contra MS-Stock real en local (quickstart §4): `../MS-Sotck` con `uv run uvicorn …` y el mismo secreto; `STOCK_BASE_URL=http://127.0.0.1:8000`; botón ⇒ portal real con "<nombre> desde Uniko" y "Volver a Uniko" → `http://localhost:3000`; Laboratorio "¿cuánto cuesta la PLY-NEG?" ⇒ datos reales; registrar resultados al final de `quickstart.md`; corregir y re-verificar ante cualquier fallo (contrato ⇒ se corrige en MS-Stock y se cita aquí)
- [X] T035 Merge `--ff-only` a `main` y push (deploy automático de `uniko-lanco`); por MCP Coolify poner `INVENTARIO=on` en la app `uniko-lanco` (`c2caigvzd8phgbfznrjvm7tl`; las `STOCK_*` ya existen) y redesplegar; `GET https://uniko.lanco.cloud/api/health` ⇒ `ok`
- [X] T036 (rutas y arranque verificados; el clic con sesión queda **pendiente de verificación humana**, ver quickstart) Verificación en la instancia de pruebas (quickstart §5.2) con Playwright: botón ⇒ `https://stock.lanco.cloud/portal` con "<nombre> desde Uniko"; Ajustes → Inventario ⇒ "Conectado"; Laboratorio "¿tienen PLY-NEG?" ⇒ datos reales (SC-007); registrar en `quickstart.md`; **no** promover a `production`
- [X] T037 Cierre: marcar tareas, actualizar `specs/README.md` (026 con tasks y estado), memoria del proyecto (`memory/`: decisión de que Uniko consume el contrato de MS-Stock y no al revés; `INVENTARIO=on` solo en `uniko-lanco`), commit y push

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 primero; T002–T005 en paralelo
- **Foundational (Phase 2)**: T006 → T007; T008 y T009 en paralelo; T010 cierra; **bloquea todas las historias**
- **US2 (Phase 3)**: depende de Phase 2; va primero (MVP)
- **US1 (Phase 4)**: depende de Phase 2 (mock `/portal/sso`) y de T001 (`jose`); independiente de US2
- **US3 (Phase 5)**: depende de Phase 2 (adaptador `health`/`getProduct`); independiente de US1/US2
- **Polish (Phase 6)**: T032–T033 en paralelo desde que exista código; T034 → T035 → T036 → T037

### Within Each User Story

- Tests primero y en rojo → módulo → ruta/UI → arnés E2E → gate en verde en ambas configuraciones de la bandera

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005
- Phase 2: T008, T009 mientras T006/T007
- US2: T011, T012, T013, T014 juntos; T019 en paralelo con T015–T018
- US1: T022 y T023 mientras T024–T026
- US3: T028 mientras T029–T030
- Polish: T032 y T033

---

## Parallel Example: User Story 2

```bash
# Tests en paralelo (rojo):
Task: "T011 tests/unit/inventario-actions.test.ts"
Task: "T012 tests/unit/inventario-prompt.test.ts"
Task: "T013 tests/unit/check-stock-turn.test.ts"
Task: "T014 tests/unit/ai-mock-inventario.test.ts"
# Implementación:
Task: "T015 actions.ts" → "T016 prompts.ts" → "T017 agent.ts" → "T018 pipeline.ts"
Task: "T019 ai-mock.ts" (en paralelo)
```

---

## Implementation Strategy

### MVP First (Phase 1–3)

1. Setup + Foundational (bandera, env, adaptador, mock)
2. US2 completa: el agente consulta y degrada
3. **STOP y validar**: gate en ambas configuraciones + `pnpm test:e2e`

### Incremental Delivery

- + US1 → botón y pase SSO (verificable con el mock y con MS-Stock local)
- + US3 → estado en Ajustes
- + Polish → CI, docs, MS-Stock local, deploy de pruebas con `INVENTARIO=on`

---

## Notes

- Ninguna tarea toca `drizzle/` ni `/api/bot/*`: sin migración y sin cambio de contrato publicado.
- La llave y el secreto no pasan por el chat ni por el repo: `.env` local y Coolify (`uniko-lanco` ya los tiene).
- No se promueve a `production` en esta feature (puerta de promoción: señal explícita del dueño).
