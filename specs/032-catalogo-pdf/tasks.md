---
description: "Tareas de la 032 — Catálogo PDF del negocio: acción send_catalog y cierre de check_stock"
---

# Tasks: 032 — Catálogo PDF del negocio (`send_catalog`)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/turno-send-catalog.md](contracts/turno-send-catalog.md)
· [quickstart.md](quickstart.md) · contrato de MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md)
§4 y §4b (v2, desplegado el 2026-10-04)

**Tests**: SÍ. La constitución (V, IX) y la spec (FR-1713..FR-1715, SC-001..SC-005) los
exigen: unit por módulo, simuladores con camino feliz e infeliz, sección «032» en
`scripts/e2e-selftest.mjs`, escenario propio en `scripts/e2e-lab.mjs` y corrida completa con
la bandera apagada. Los tests de cada historia se escriben primero y deben fallar antes de
implementar.

**Organización**: por historia de usuario en orden de prioridad. US1 (pregunta general →
documento) es el MVP; US2 (más de 10 → ofrecimiento y aceptación) reutiliza `getCatalog` y
el envío de US1; US3 (el inventario manda, la URL nunca en el prompt) y US4 (sin inventario
nada cambia) cierran. Las tareas incluyen los seis ajustes que salieron al bajar el diseño
al código ([research R12](research.md)).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1 (pregunta general → documento), US2 (más de 10 → ofrecimiento),
  US3 (el inventario manda; sin URL en el prompt), US4 (sin inventario, nada cambia)
- Rutas exactas desde la raíz del repositorio; las del repo hermano empiezan por
  `../MS-Sotck/`

---

## ⛔ Tres reglas que no son recomendaciones

### 1. El contrato manda y ya está desplegado

`GET /v1/agent/catalog` y las reglas de §4/§4b viven en el contrato v2 de MS-Stock,
corriendo en `stock.lanco.cloud` y en NuriaAndrea desde el 2026-10-04. Esta feature no toca
MS-Stock. Si al implementar algo no cuadra con el contrato, se para, se corrige allá (PR en
MS-Stock, merge del dueño) y se vuelve.

### 2. De la 028 solo cambia el cierre

Los 5 productos, sus textos, sus fotos y su orden no se mueven (FR-1710). Los tests y las
secciones del arnés de la 026 y la 028 pasan sin tocar un esperado; la única adaptación
permitida es darle al mock del cliente un `getCatalog` que por defecto responde
`not_found` (sin catálogo = el cierre de siempre).

### 3. Bandera apagada = cero cambio, comprobado antes de cerrar

La corrida completa con `INVENTARIO=` vacía (base nueva) va en la Phase 7 además de la
encendida (US4, SC-005). Una prueba que solo pasa encendida prueba la mitad que no corre en
ninguna instancia por defecto.

---

## Phase 1: Setup

**Purpose**: partir de `main` al día y de una línea base conocida.

- [X] T001 Preflight: rama `032-catalogo-pdf` (creada desde `main` en `1e5cf4e`); `git fetch origin && git log --oneline HEAD..origin/main` vacío (si no, sincronizar antes de programar); Node 22 (`eval "$(fnm env --shell bash)" && fnm use 22`); `.env` con los mocks, `INVENTARIO=on`, `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock` y las `STOCK_*` de desarrollo de la 026 (sin variables nuevas); base desechable nueva `uniko_dev_032a` en `DATABASE_URL` y `pnpm db:dev`
- [X] T002 Línea base antes de tocar código: `pnpm typecheck && pnpm lint && pnpm test` → anotar el conteo de tests para distinguir después un fallo previo de uno propio

---

## Phase 2: Foundational (trazabilidad, adaptador y catálogo del stock-mock)

**Purpose**: marcar lo que se deroga, darle al adaptador la consulta del catálogo y al
stock-mock la ruta del contrato. US1 y US2 dependen de las dos cosas.

**⚠️ CRITICAL**: ninguna historia empieza antes de esta fase.

- [X] T003 [P] FR-1711 (Principio VII) en `specs/028-respuesta-por-talla/spec.md`: en FR-1308 tachar **solo** la cláusula del cierre (`` ~~y cerrar con `Hay más coincidencias, ¿me dices cuál te interesa?` si quedaron más con existencia o si MS-Stock avisó que recortó~~ ``) y añadir debajo `` **DEROGADO** (parcial, 032 `032-catalogo-pdf`, PR #<n>): … `` con lo que deja de regir, el sustituto FR-1710 (6 a 10 sin recorte: igual; más de 10 o recorte con catálogo: «Hay más modelos en nuestro catálogo, ¿te lo mando?»; sin catálogo o con fallo: igual) y lo que sigue vigente (25 pedidos, 5 mostrados, SKU exacto primero, 3 s, sin reintentos, solo lectura); nota `(032: FR-1710)` junto al escenario de US3 que cita el cierre (~línea 156); corregir a «032» las tres menciones de «029» como la feature del catálogo (~líneas 25 y 143, y el supuesto «Catálogo PDF (029) fuera de alcance», ~415), aclarando una vez que el número 029 lo tomó «Google por link»; propagar una nota `(032: FR-1710)`, sin borrar el original, en `specs/028-respuesta-por-talla/data-model.md` (~45) y `research.md` (~40). El `PR #<n>` se completa en T053
- [X] T004 [P] Test primero en `tests/unit/stock-client.test.ts`: `getCatalog()` pide `GET ${STOCK_BASE_URL}/v1/agent/catalog` con `x-api-key` y `cache: "no-store"`; 200 `{ url: "https://img.stock.example/catalog/ab12.pdf", filename: "Catálogo Otoño 2026.pdf", updated_at: "2026-10-04T18:00:00Z" }` → `{ ok: true, data }`; 404 → `not_found`; 401 → `unauthorized`; 503 → `unavailable`; cuerpo no JSON → `invalid`; `url` no http(s) (`ftp://…`, `javascript:alert(1)`, texto suelto) → `invalid`; `filename` vacío o de 241 caracteres → `invalid`; sin `updated_at` → `invalid`; abort por tiempo → `timeout`; la llave nunca aparece en `console.error` — deben fallar
- [X] T005 Implementar en `src/server/inventario/client.ts`: `catalogSchema` (`url`: texto http/https válido —misma regla que `toImageUrl`, pero aquí una URL mala invalida la respuesta—; `filename`: `z.string().min(1).max(240)`; `updated_at`: `z.string()`), `export type CatalogInfo` y `export function getCatalog(): Promise<StockResult<CatalogInfo>>` por `request("/v1/agent/catalog", catalogSchema, { auth: true })`; sin caché (la URL cambia en cada reemplazo, contrato §4b); comentario con FR-1702
- [X] T006 [P] Test primero en `tests/unit/stock-mock.test.ts`: `GET v1/agent/catalog` sin llave → 401 (y queda en `calls`); con llave → 200 `{ url: "http://localhost:3000/api/dev/stock-mock/catalogo.pdf?v=1", filename: "Catálogo de prueba.pdf", updated_at }` (ISO); tras `POST _catalog {"present":false}` → 404 `{ error: { code: "NOT_FOUND", message: "No hay catálogo." } }`; `{"present":true,"filename":"Catálogo Otoño 2026.pdf"}` → ese nombre y `?v=2`; `_catalog` con cuerpo inválido (sin `present`, `filename` sin `.pdf` o de más de 100) → 422; `_mode down|unauthorized|garbage` aplican al catálogo como al resto de `/v1/agent/*`; `GET catalogo.pdf` sin llave → 200 `content-type: application/pdf`, cuerpo que empieza con `%PDF-` y termina en `%%EOF`; `_reset` vuelve a «Catálogo de prueba.pdf» con `?v=1`; `_state` incluye `catalog`; en producción `v1/agent/catalog`, `catalogo.pdf` y `_catalog` → 404 — deben fallar
- [X] T007 Implementar el catálogo del stock-mock: en `src/server/dev/stock-mock-state.ts`, `MockState.catalog: { filename: string; updatedAt: string; version: number } | null` (por defecto `{ filename: "Catálogo de prueba.pdf", updatedAt: <ISO fijo>, version: 1 }`), `setStockMockCatalog(present: boolean, filename?: string)` (presente ⇒ `version + 1` y el nombre nuevo o el anterior; ausente ⇒ `null`), `resetStockMock()` lo restaura y `stockMockSnapshot()` lo incluye; en `src/app/api/dev/stock-mock/[...path]/route.ts`: `GET catalogo.pdf` antes del bloque `v1/agent/` (sin llave ni modos infelices, como una URL pública; un PDF de una página «Catálogo de prueba» con los offsets de `xref` correctos, que abre en el visor del navegador), `GET v1/agent/catalog` dentro del bloque `v1/agent/` (tras la llave y `unhappy()`) → `` { url: `${url.origin}/api/dev/stock-mock/catalogo.pdf?v=${version}`, filename, updated_at } `` o `apiError(404, "NOT_FOUND", "No hay catálogo.")`, y `POST _catalog` validado con zod (`present: boolean`; `filename?`: de 5 a 100 caracteres terminado en `.pdf`) → 422 `VALIDATION_ERROR` si no; comentario de cabecera (032)

**Checkpoint**: `pnpm test` verde con los tests nuevos de T004/T006; nada observable cambió
para el agente todavía.

---

## Phase 3: User Story 1 — El cliente pregunta qué venden y recibe el catálogo (Priority: P1) 🎯 MVP

**Goal**: con `INVENTARIO=on`, «¿qué venden?» produce UN documento por URL con el nombre de
MS-Stock y el pie; sin catálogo o con MS-Stock caído, solo la frase del modelo en < 5 s;
respaldo a texto con enlace si WhatsApp lo rechaza (al momento o después) o el canal no
envía documentos; el Laboratorio lo persiste sin tocar la API y su reporte lo muestra.

**Independent Test**: arnés sección «032» casos 1–6 ([quickstart §2](quickstart.md)) y el
escenario «Pregunta qué venden» de `scripts/e2e-lab.mjs`.

### Tests for User Story 1 ⚠️

> Escribirlos primero; deben fallar antes de implementar.

- [X] T008 [P] [US1] Test primero en `tests/unit/catalog-turn.test.ts` (nuevo; `vi.mock("@/server/inventario/client")` con `getCatalog`): `buildCatalogCaption("")` y `("   ")` → `"Dime modelo y talla y te confirmo existencia y precio"`; `("¡Claro!")` → `"¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio"`; un intro de exactamente `1024 - 2 - CATALOG_FOOTER.length` (969) caracteres no se recorta; con 970 o 2000 → `length <= 1024`, termina en `"…\n\n" + CATALOG_FOOTER`, la frase fija intacta y sin espacios antes de «…»; un emoji en el punto de corte no deja un sustituto suelto (`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/` no coincide); `sendCatalogTurn({ intro: "¡Claro!" })` con catálogo → `{ ok: true, document: { url, filename, caption }, fallbackText: caption + "\n" + url }`; con cada error (`not_found`, `unauthorized`, `unavailable`, `timeout`, `invalid`, `network`) → `{ ok: false }` y un `console.error` `[agente] catálogo: <motivo> …` sin la llave — deben fallar
- [X] T009 [P] [US1] Test primero en `tests/unit/inventario-actions.test.ts`: con `agentActionSchema({ agenda: false, inventario: true })` se aceptan `{ action: "send_catalog" }` y `{ action: "send_catalog", reply: "¡Claro!" }` (una clave de más como `url` se descarta) y se rechaza un `reply` que no es texto; `degradeAction({ action: "send_catalog", reply: "x" })` → `{ action: "reply", text: "x" }`; sin `reply` → `{ action: "none" }` — deben fallar (el caso apagado va en T045)
- [X] T010 [P] [US1] Test primero en `tests/unit/deliver-catalog.test.ts` (nuevo; mismos mocks que `tests/unit/deliver-replies.test.ts` más `sendDocumentLink`) para `deliverCatalog(conv, turn)`: (a) `isTest` → ningún `send*`; inserta `mediaAsset` `{ kind: "document", fileName, caption: pie, payload: { url }, fetchStatus: "available" }` y `message` `{ type: "document", text: pie, status: "sent", aiGenerated: true, origin: "ai", mediaAssetId }`; (b) WhatsApp → un `sendDocumentLink({ link: url, filename, caption: pie, aiGenerated: true, signal })` y ningún `sendText`; (c) `sendDocumentLink` rechaza con `SendError("meta_error")` → un `sendText` con `fallbackText`; (d) rechaza por tiempo (`TimeoutError`/`AbortError`) → igual; (e) canal `instagram` o `messenger` → sin `sendDocumentLink`, un `sendText(fallbackText)`; (f) `SendError("window_closed")` → sin texto de respaldo y la conversación escalada con motivo `ventana`; (g) nunca más de un documento por llamada — deben fallar
- [X] T011 [P] [US1] Test primero en `tests/unit/status-foto-respaldo.test.ts`: `failed` tardío de un mensaje `document` con `origin: "ai"` → `sendText` una vez con `text + "\n" + url` (la `url` sale del `payload` de su `media_asset`); un `failed` repetido no reenvía (monotónico); `document` del operador → nada; asset sin URL http(s) → `sendText(text)` solo; un fallo del respaldo se registra y el webhook no lanza; la imagen sigue como hoy (su pie solo) — deben fallar (el mock de `select` necesita la segunda consulta, la del asset)
- [X] T012 [P] [US1] Test primero en `tests/unit/lab-transcript.test.ts` (nuevo) para la función pura `transcriptDe(mensajes, nombres)` que exportará `src/server/lab/runner.ts`: un saliente `document` cuyo asset está en `nombres` ⇒ `{ role: "agente", text: "[Documento: Catálogo de prueba.pdf]\n<pie>" }`; sin nombre ⇒ `"[Documento]\n<pie>"`; salientes `text`/`image` y entrantes igual que hoy; mensajes sin texto se omiten — debe fallar
- [X] T013 [P] [US1] Test primero en `tests/unit/inventario-prompt.test.ts`: con `inventario: true` el prompt trae la línea de acción `{"action":"send_catalog","reply":"..."}` con la advertencia de que `reply` no promete el adjunto, y la regla «preguntas generales (qué venden, qué tienen, si hay catálogo) → send_catalog; un producto concreto → check_stock»; con `inventario: false` no aparece `send_catalog` ni «catálogo» — deben fallar
- [X] T014 [P] [US1] Test primero en `tests/unit/wa-mock-media.test.ts`: `POST …/messages` con `type: "document"` y `document: { link, filename, caption }` → 200 con `wamid`, entrada `type: "document"` en el outbox con ese cuerpo y `scheduleSentStatus` llamado; `media-mode {reject}` → 400 `OAuthException` código 100 y nada en el outbox; `{reject, link: "catalogo.pdf"}` rechaza solo el documento cuyo `link` lo contiene (una imagen pasa); `slow` retrasa el documento igual que a la imagen — deben fallar
- [X] T015 [P] [US1] Test primero en `tests/unit/ai-mock-inventario.test.ts`: con `send_catalog` y `check_stock` en el system, «¿qué venden?», «¿Qué tienen?», «que manejan?», «¿tienes catálogo?», «¿tienen catalogo?», «mándame el catálogo», «¿me puedes enviar el catálogo?», «pásame el catálogo» → `{ action: "send_catalog", reply: "¡Claro!" }`; «mándame el catálogo completo» → `send_catalog` con un `reply` de más de 1024 caracteres (para ejercitar FR-1704 en el arnés); siguen en `check_stock`: «¿tienen playera negra?» y «En el catálogo dice que la playera negra cuesta $150, ¿cuánto cuesta la playera negra?» (`query: "playera negra"`); la frase de la persona del Laboratorio «¿Qué es lo más popular que tienen?» (`src/server/lab/personas.ts`) NO la dispara; sin `send_catalog` en el system, «¿qué venden?» no la propone — deben fallar

### Implementation for User Story 1

- [X] T016 [US1] Implementar en `src/server/inventario/agent.ts` según [data-model.md](data-model.md): `CATALOG_FOOTER`, `CATALOG_CAPTION_MAX = 1024`, `buildCatalogCaption(intro)` (mide con `.length`; si no cabe, recorta el intro sin partir pares sustitutos —`Array.from`— y sin espacios finales y le añade «…»; la frase fija nunca se toca), `type CatalogTurn` y `sendCatalogTurn({ intro })` (`getCatalog()`; un fallo ⇒ `` console.error(`[agente] catálogo: ${error} al consultar MS-Stock`) `` y `{ ok: false }`); bloque de cabecera «032» con FR-1702..FR-1708
- [X] T017 [US1] Implementar en `src/server/ai/actions.ts`: `z.object({ action: z.literal("send_catalog"), reply: z.string().optional() })` en `inventarioActions` (comentario: `reply` es solo la frase de entrada y no promete el adjunto; el sistema pide, envía y degrada) y `send_catalog` en la lista de `degradeAction`
- [X] T018 [US1] Implementar en `src/server/inbox/send.ts` `sendDocumentLink({ conversationId, organizationId, link, filename, caption?, aiGenerated?, signal? })`, espejo de `sendImageLink`: `` SendError("meta_error", `Todavía no se pueden enviar documentos por ${caps.label}; manda el texto`) `` sin `outboundMedia` o sin credenciales; Graph `{ messaging_product: "whatsapp", to, type: "document", document: { link, filename, caption? } }` con `signal`; si Graph rechaza no persiste nada; asset `{ kind: "document", fileName: filename, caption, payload: { url: link }, fetchStatus: "available" }` y mensaje `type: "document"`, `text: caption ?? null`, `pending` si el canal tiene `deliveryReceipts`; el guard de `prepareSend` contra `is_test` intacto; comentario (032, FR-1703)
- [X] T019 [US1] Implementar en `src/server/ai/pipeline.ts` (depende de T016–T018): (1) `persistTestOutbound(conversation, text, media?)` con `media` = `{ kind: "image", url }` o `{ kind: "document", url, fileName }` (la imagen exactamente como hoy; el documento como en T010a) y `deliverReply` pasándole `{ kind: "image", url }`; (2) `export async function deliverCatalog(conversation, turn)` (exportada solo para su test) según [research R4](research.md): Laboratorio ⇒ persistir; canal sin `outboundMedia` ⇒ `deliverReply(conversation, turn.fallbackText)`; si no, `sendDocumentLink` con `AbortSignal.timeout(PHOTO_TIMEOUT_MS)`; `window_closed` ⇒ `applyHandoff(…, "ventana")` sin respaldo; otro fallo ⇒ `console.error("[agente] catálogo: no se pudo enviar el documento (<motivo>); sale el texto con el enlace")` y `deliverReply(conversation, turn.fallbackText)`; (3) rama `send_catalog` justo después de la de `check_stock`: bandera apagada ⇒ `degradeAction`; `sendCatalogTurn({ intro: action.reply })` ok ⇒ `deliverCatalog` + `publish(conversation.updated)` + `return`; `ok: false` ⇒ `degradeAction` (FR-1708)
- [X] T020 [P] [US1] Implementar en `src/server/inbox/status.ts` el respaldo del `failed` tardío también para `document` con `origin: "ai"`: seleccionar `mediaAssetId`, leer `payload.url` del asset con `scoped()` por organización y enviar `text + "\n" + url` si es http(s) (si no, `text`); comentario con FR-1706 junto al de FR-1120 ([research R12.2](research.md))
- [X] T021 [P] [US1] Implementar en `src/server/lab/runner.ts` `export function transcriptDe(mensajes, nombres)` y usarla en `runConversation`; los `fileName` de los salientes `document` se leen con `scoped(schema.mediaAsset.organizationId, organizationId, inArray(schema.mediaAsset.id, ids))`. Así el reporte de la corrida muestra el documento con su nombre y su pie (US1-5) y el juez sabe que se envió ([research R12.1](research.md))
- [X] T022 [P] [US1] Implementar en `src/server/ai/prompts.ts` (solo con `inventario`): línea de acción `- {"action":"send_catalog","reply":"..."} — enviar el catálogo PDF del negocio cuando el cliente pregunta en general qué venden o pide el catálogo (reply es solo una frase de entrada y NO debe prometer el adjunto: puede salir sola si no hay catálogo).` y la regla «Para preguntas generales (qué venden, qué tienen, si hay catálogo) → send_catalog; para un producto concreto → check_stock.»
- [X] T023 [P] [US1] Bandeja: en `src/components/inbox/message-thread.tsx`, `linkedImageUrl` → `linkedUrl` para `image` **y** `document` (solo http/https), de modo que el documento por URL abre su URL y no `/api/media/…`; en `src/app/api/media/[assetId]/route.ts`, el 302 a `payload.url` también para `kind === "document"` (comentario 032, [research R12.3](research.md))
- [X] T024 [P] [US1] wa-mock: en `src/app/api/dev/wa-mock/graph/[...path]/route.ts`, `type: "document"` con `document.link` pasa por `mediaModeFor(link)` (`reject` ⇒ 400 `(#100) Param document['link'] is not a valid URL`; `slow` ⇒ 7 s) y, aceptado, `scheduleSentStatus(waMessageId)` como la imagen; comentario (032, FR-1706)
- [X] T025 [P] [US1] ai-mock: en `src/server/dev/ai-mock.ts`, regla `send_catalog` ANTES de la de `check_stock` y solo si el system menciona `send_catalog`: el mensaje empieza con `¿?\s*qu[eé]\s+(?:venden|tienen|manejan)\b`, o trae `(?:tienes|tienen|hay)\s+(?:un\s+|el\s+)?cat[aá]logo`, o un verbo de pedir (`m[aá]nd|env[ií]|p[aá]s…`) seguido de «catálogo» ⇒ `{ action: "send_catalog", reply: "¡Claro!" }`; con «catálogo completo» ⇒ `reply` de más de 1024 caracteres; comentario con la razón (FR-1714, [research R12.6](research.md))

### Arnés de User Story 1

- [ ] T026 [US1] Arnés `scripts/e2e-selftest.mjs`: sección `== 032: catálogo PDF (send_catalog) ==` dentro de `inventarioChecks()`, después de la degradación de la 026 (tras su `await reset()`) y antes de restaurar el perfil del agente; helpers locales `catalogo(body)` (`POST ${STOCK}/_catalog`), `turno032(lead, texto, id, esperados)` (nombre fijo `Lead catálogo <lead>`, `waMessageId` `wamid.e2e.032.<id>`, espera como `preguntarVarios`) y `textoDe` que también lee `body.document.caption`; leads `52146270320xx`. Casos: (1) «¿qué venden?» → exactamente un saliente `document` con `link` `${ORIGEN}/api/dev/stock-mock/catalogo.pdf?v=1`, `filename` «Catálogo de prueba.pdf» y `caption` «¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio», en menos de `coalesce + 5000` ms (SC-001); en el hilo, un `document` IA con `media.kind`, `media.fileName`, `media.payload.url` y `text` = pie, sin `failed`; `GET /api/media/<assetId>` → 302 a la URL; (2) «mándame el catálogo completo» → pie de ≤ 1024 caracteres que termina en «…\n\nDime modelo y talla y te confirmo existencia y precio»; (3) `catalogo({ present: true, filename: "Catálogo Otoño 2026.pdf" })` + «¿tienes catálogo?» → ese `filename` y `?v=2` (cada envío consulta en ese momento)
- [ ] T027 [US1] Arnés, sección 032 (camino infeliz): (4) `catalogo({ present: false })` + «¿qué venden?» → un solo `text` exactamente «¡Claro!», ningún `document`, sin mencionar catálogo ni fallo; (5) `_mode down` y luego `slow` (con catálogo) + «¿qué venden?» → un solo `text` «¡Claro!» cada uno en menos de `coalesce + 5000` ms (SC-002); esperar a que el mock lento termine antes del siguiente lead; (6) `media-mode {reject, link:"catalogo.pdf"}` + «mándame el catálogo» → un solo `text` = pie + `\n` + URL, ningún `document`, el hilo sin `failed`; `DELETE media-mode`; al final `reset()` → `pnpm test:e2e` verde
- [ ] T028 [US1] `scripts/e2e-lab.mjs`: dentro de `if (inventarioOn)`, después del bloque 026: `POST ${STOCK_BASE_URL}/_reset`; escenario «Pregunta qué venden» (`script: ["hola, buenas", "¿qué venden?"]`) → corrida → la última entrada `agente` de ese caso es exactamente `[Documento: Catálogo de prueba.pdf]\n¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio`; ninguna entrada contiene `stock-mock/catalogo.pdf`; el outbox del wa-mock no crece (FR-1707); borrar el escenario al final (`DELETE /api/lab/scenarios/<id>`) para que la siguiente corrida mida lo mismo

**Checkpoint**: US1 verde en unit, en `e2e-selftest` y en `e2e-lab`. MVP entregable.

---

## Phase 4: User Story 2 — Muchos modelos: cinco con foto y el ofrecimiento del catálogo (Priority: P1)

**Goal**: con más de 10 con existencia (o recorte) y catálogo, 5 productos + «Hay más
modelos en nuestro catálogo, ¿te lo mando?»; de 6 a 10, «Hay más coincidencias…» sin
consultar el catálogo; sin catálogo o con fallo, el cierre de siempre; un «sí» envía el
catálogo.

**Independent Test**: arnés sección «032» casos 7–10: calcetines (12) con y sin catálogo,
«sí», sudaderas (7) y el registro de llamadas del stock-mock.

### Tests for User Story 2 ⚠️

- [ ] T029 [P] [US2] Test primero en `tests/unit/check-stock-turn.test.ts`: extender el mock del cliente con `getCatalog` (por defecto `{ ok: false, error: "not_found" }` en `beforeEach`: los esperados actuales con `truncated` siguen dando «Hay más coincidencias…»); casos nuevos con productos con existencia: 5 → 5 mensajes sin cierre y `getCatalog` sin llamar; 6 y 10 → 5 + «Hay más coincidencias, ¿me dices cuál te interesa?» sin llamar a `getCatalog`; 11 y 12 con catálogo → 5 + «Hay más modelos en nuestro catálogo, ¿te lo mando?» y una sola llamada; 11 sin catálogo o con `timeout` → «Hay más coincidencias…»; 2 con `truncated` y catálogo → 2 + ofrecimiento; 1 con `truncated` y catálogo → `[formatProduct, ofrecimiento]`; 12 resultados todos agotados → «Por ahora no tengo … con existencia.» sin llamar a `getCatalog`; con talla, 12 resultados de los que 3 tienen esa talla con existencia → 3 sin cierre (se cuenta tras el filtro); los 5 mensajes de producto (texto, `imageUrl`, orden) idénticos con y sin catálogo; `selectProducts` devuelve `total` — deben fallar
- [ ] T030 [P] [US2] Test primero en `tests/unit/stock-mock.test.ts`: `search?q=calcetines&limit=25` → 12 resultados `CAL-01`…`CAL-12` en orden, todos con existencia, `truncated: false`, `image_url` distintas (`?m=cal01`…`?m=cal12`); `q=sudaderas` → 7 `SUD-01`…`SUD-07` con existencia e `image_url: null`; `q=calcetin` → los mismos 12; las búsquedas que los tests ya fijan (`playeras`, `pantalones`, `playera negra`, `PLY-NEG`…) no cambian — deben fallar
- [ ] T031 [P] [US2] Test primero en `tests/unit/ai-mock-inventario.test.ts`: con `send_catalog` en el system y el ÚLTIMO mensaje `assistant` con «¿te lo mando?»: «sí», «Si», «sí, mándamelo», «dale», «mándamelo», «claro» → `send_catalog`; «sí» cuando el último `assistant` no ofreció (aunque uno anterior sí) → no; sin `send_catalog` en el system → no — deben fallar
- [ ] T032 [P] [US2] Test primero en `tests/unit/inventario-prompt.test.ts`: con `inventario: true`, la regla «Si el sistema ofreció el catálogo («¿te lo mando?») y el cliente acepta → send_catalog»; con `false`, nada — debe fallar

### Implementation for User Story 2

- [ ] T033 [US2] Implementar en `src/server/inventario/agent.ts` (después de T016, mismo archivo): `selectProducts` devuelve también `total` (los que quedan tras el filtro); `CATALOG_OFFER_ABOVE = 10`, `OFERTA_CATALOGO = "Hay más modelos en nuestro catálogo, ¿te lo mando?"` y `export async function closingFor(total, truncated): Promise<string | null>` según [data-model.md](data-model.md) §Cierre (consulta `getCatalog()` solo con `total > 10` o `truncated`; un fallo distinto de `not_found` se registra como `[agente] catálogo (cierre): <motivo>`); `checkStockTurn` añade el cierre como último mensaje (texto, sin foto) en la rama de un producto con `truncated` y en la de varios, sin tocar los mensajes de producto; comentarios con FR-1710 (deroga en parte FR-1308)
- [ ] T034 [P] [US2] Implementar en `src/server/dev/stock-mock-state.ts`, al final de `STOCK_MOCK_CATALOG`: `CAL-01`…`CAL-12` («Calcetín <color>»: blanco, negro, gris, azul, rojo, verde, amarillo, rosa, morado, café, beige, naranja; `stock: 10`, `unit: "pieza"`, `price: 59`, `imagePath: "/icon-192.png?m=calNN"`) y `SUD-01`…`SUD-07` («Sudadera <color>»: negra, gris, azul, roja, verde, blanca, café; `stock: 3`, `price: 499`, `imagePath: null`), activos y sin tallas; comentario (032: más de 10 y de 6 a 10 para FR-1710)
- [ ] T035 [P] [US2] Implementar en `src/server/dev/ai-mock.ts`, dentro de la regla de T025: si el último mensaje `assistant` contiene «¿te lo mando?» y el del cliente empieza con `s[ií]|dale|m[aá]ndamelo|claro|va` ⇒ `{ action: "send_catalog", reply: "¡Claro!" }`
- [ ] T036 [P] [US2] Implementar en `src/server/ai/prompts.ts` (solo con `inventario`) la regla «Si el sistema ofreció el catálogo («¿te lo mando?») y el cliente acepta → send_catalog.»

### Arnés de User Story 2

- [ ] T037 [US2] Arnés, sección 032 (cierre): (7) `reset()` + «¿tienen calcetines?» → 6 salientes: 5 `image` (`CAL-01`…`CAL-05`, `link` `?m=cal01`…`?m=cal05`, el primero con «Déjame revisar.\n» delante) y un `text` final «Hay más modelos en nuestro catálogo, ¿te lo mando?»; `_state.calls` trae exactamente una `/v1/agent/catalog` (SC-003); (8) el mismo lead, «sí» → un `document` como el del caso 1; (9) `reset()` + «¿tienen sudaderas?» → un solo `text` (sin fotos, colapsado) con 5 líneas `SUD-0x` y «Hay más coincidencias, ¿me dices cuál te interesa?» como última línea, y `_state.calls` sin `/v1/agent/catalog`; (10) `catalogo({ present: false })` + «¿tienen calcetines?» → 5 `image` + «Hay más coincidencias…»; `reset()`. El check de la 028 «¿tienen playera?» (6 → «Hay más coincidencias…») sigue verde sin cambios → `pnpm test:e2e` verde

**Checkpoint**: US1 + US2 verdes; los checks de la 026/028 sin un esperado cambiado.

---

## Phase 5: User Story 3 — El agente no describe el catálogo: el inventario manda (Priority: P2)

**Goal**: el prompt prohíbe describir o citar el catálogo y manda existencia y precio a
`check_stock`; la dirección del PDF nunca entra al prompt, tampoco desde el texto de
respaldo.

**Independent Test**: `lastPrompt` del ai-mock tras un documento y tras un respaldo no trae
la URL (SC-004); una pregunta con un precio «del catálogo» se contesta con el del
inventario.

### Tests for User Story 3 ⚠️

- [ ] T038 [P] [US3] Test primero en `tests/unit/inventario-prompt.test.ts`: con `inventario: true`, reglas «NUNCA describas, resumas ni cites el catálogo: no lo ves», «existencia y precio solo con check_stock» y «si lo que el cliente cita del catálogo no coincide con el inventario, manda el inventario»; ninguna línea del bloque de inventario contiene `http`; con `false`, nada de eso — deben fallar
- [ ] T039 [P] [US3] Test primero en `tests/unit/catalog-turn.test.ts`: `stripCatalogLink("¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio\nhttps://img.stock.example/catalog/ab12.pdf")` → sin la última línea; un texto sin la frase fija, o cuya última línea no es http(s), o con un enlace de reunión (`https://meet.google.com/…`) → igual — deben fallar
- [ ] T040 [P] [US3] Test primero en `tests/unit/ai-mock-state.test.ts` (nuevo): `recordAiMockCall(model, messages)` deja en `aiMockSnapshot().lastPrompt` el contenido de todos los mensajes del último turno (system e historial) y `resetAiMock()` lo limpia; sin `messages` → `null` — debe fallar

### Implementation for User Story 3

- [ ] T041 [US3] Implementar en `src/server/ai/prompts.ts` (solo con `inventario`) las tres reglas de T038
- [ ] T042 [US3] Implementar `export function stripCatalogLink(text)` en `src/server/inventario/agent.ts` (quita la última línea solo si es http(s) y la anterior es `CATALOG_FOOTER`) y aplicarla en `src/server/ai/pipeline.ts` al armar el `hilo` (contenido de los salientes, antes de `withDayMarkers`): el respaldo conserva el enlace en el hilo —es lo que recibió el cliente— pero no entra al prompt (FR-1709, [research R12.4](research.md))
- [ ] T043 [P] [US3] Implementar `lastPrompt` en `src/server/dev/ai-mock-state.ts` (`recordAiMockCall(model, messages?)`, `aiMockSnapshot`, `resetAiMock`) y pasar `body.messages` desde `src/app/api/dev/ai-mock/v1/chat/completions/route.ts` y `src/app/api/dev/ai-mock/chat/completions/route.ts` ([research R12.5](research.md))

### Arnés de User Story 3

- [ ] T044 [US3] Arnés, sección 032 (prompt): (11) en el lead del caso 1, «gracias» → `GET /api/dev/ai-mock/_state` → `lastPrompt` contiene `send_catalog` y no `stock-mock/catalogo.pdf`; (12) lo mismo en el lead del caso 6 (respaldo con enlace en el hilo) → el prompt tampoco lo trae (SC-004); (13) «En el catálogo dice que la playera negra cuesta $150, ¿cuánto cuesta la playera negra?» → la respuesta trae «$199 MXN» y no «$150» (US3-3) → `pnpm test:e2e` verde

---

## Phase 6: User Story 4 — Sin inventario, nada cambia (Priority: P3)

**Goal**: con `INVENTARIO` apagada no existe `send_catalog`, el prompt es el de siempre y no
se llama a MS-Stock.

**Independent Test**: arnés completo con `INVENTARIO=` vacía (base nueva) igual que antes
de la feature, más el check de T046.

- [ ] T045 [P] [US4] Tests de la bandera apagada (completar donde T009/T013/T015/T031 no lo cubran): `agentActionSchema({ agenda: false, inventario: false })` rechaza `{ action: "send_catalog" }` en `tests/unit/inventario-actions.test.ts`; el prompt sin `inventario` no contiene `send_catalog` ni «catálogo» en `tests/unit/inventario-prompt.test.ts`; el ai-mock sin `send_catalog` en el system no la propone para «¿qué venden?» ni para «sí» tras «¿te lo mando?» en `tests/unit/ai-mock-inventario.test.ts`
- [ ] T046 [US4] Arnés, mitad apagada de `inventarioChecks()` en `scripts/e2e-selftest.mjs`: «¿qué venden?» (lead `5214627032900`) → el eco de siempre («Respuesta de prueba»), sin `document` en el outbox (US4-1)

---

## Phase 7: Polish, docs y verificación en vivo

- [ ] T047 [P] Docs: `docs/inventario-conector.md` sección nueva «## Catálogo PDF (032)» (qué hace; el pie; tabla de envío por canal y fallo, incluido el `failed` tardío; tabla del cierre; Laboratorio; cómo probarlo con `_catalog` y `media-mode {link:"catalogo.pdf"}`; contra MS-Stock real el negocio lo sube en su portal), la regla de cierre de «## Respuesta por talla y fotos por producto (028)» remitiendo a FR-1710 y en «## Lo que NO hace (a propósito)» que no describe ni cachea el catálogo; `README.md` (párrafo del inventario: si el negocio subió su catálogo PDF en MS-Stock, lo envía cuando preguntan qué venden); `CLAUDE.md` fila del inventario (`send_catalog` → `sendCatalogTurn` + `deliverCatalog`; cierre con más de 10)
- [ ] T048 [P] `tests/e2e/us-inventario.md`: sección «## 032 — Catálogo PDF (`send_catalog` y cierre con más de 10)» con los casos 26–39, uno por check del arnés (T026, T027, T037, T044, T046) y el del Laboratorio (T028)
- [ ] T049 [P] Comentarios que citan el cierre de FR-1308 (`src/server/inventario/agent.ts` —cabecera y `selectProducts`—, `tests/unit/check-stock-turn.test.ts`, `scripts/e2e-selftest.mjs` §028 «5 + Hay más coincidencias»): anotar FR-1710 donde la regla cambió y dejar FR-1308 donde sigue vigente (25 pedidos, 5 mostrados)
- [ ] T050 Gate completo verde: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`; arnés completo `pnpm test:e2e` con `INVENTARIO=on` (base nueva `uniko_dev_032b`; matar el `next dev` anterior con `taskkill //F //IM node.exe`; calentar `/api/inventario/status` y el ai-mock) y con `INVENTARIO=` vacía (base nueva `uniko_dev_032c`); registrar conteos en [quickstart.md](quickstart.md) «Resultados del self-test local»; corregir y repetir hasta verde
- [ ] T051 Revisión visual con el navegador integrado contra la app local: en la bandeja, la conversación del caso 1 muestra la burbuja de documento con icono, «Catálogo de prueba.pdf» y el pie, y el enlace abre el PDF del stock-mock; en el Laboratorio, el reporte de la corrida de T028 muestra `[Documento: Catálogo de prueba.pdf]` y el pie; anotar en el quickstart §3
- [ ] T052 Contra MS-Stock real en local ([quickstart §4](quickstart.md)): levantar `../MS-Sotck` con el stub S3 y subir un PDF real con `PUT /v1/catalog?filename=Cat%C3%A1logo%20de%20prueba`; `.env` de Uniko con `STOCK_BASE_URL=http://localhost:8000` y su llave de desarrollo; por el wa-mock, «¿qué venden?» → `document` con la URL y el nombre que dio MS-Stock; `DELETE /v1/catalog` y repetir → solo la frase; restaurar el `.env`; anotar resultados (confirma la forma del §4b contra el servicio de verdad)
- [ ] T053 Commit(s) por fase (`feat(032)`, `test(032)`, `docs(032)`); con el visto bueno del dueño, push de `032-catalogo-pdf` y PR a `main` con resumen, evidencias del arnés en ambas configuraciones, la derogación de FR-1308 y el plan de reversión (redesplegar el commit anterior o apagar `INVENTARIO`; sin cambios en `drizzle/`); completar el `PR #<n>` de T003; CI `default` y `completo` verdes. **Merge = señal del dueño**
- [ ] T054 Tras el merge y el deploy de `uniko-lanco`: `/api/health` 10/10 con el commit antes de medir; `GET /v1/agent/catalog` de `stock.lanco.cloud` con la llave de la instancia de pruebas tratada como en la memoria (nunca al chat ni al repo; archivo de cabecera en el scratchpad que se borra al terminar); si no hay catálogo, subir uno de prueba por la API y quitarlo al final si el dueño no sube el suyo; Laboratorio de `uniko.lanco.cloud` con el escenario «¿qué venden?» → transcript con el nombre real; quitar el catálogo → solo la frase; pedir al dueño la prueba por WhatsApp con el número de pruebas (SC-006): llega el PDF con su nombre y su pie y abre en el teléfono; registrar en el quickstart «Resultados en la instancia de pruebas»
- [ ] T055 Cierre: `tasks.md` al día; memoria del repo (`memory/` + `memory/MEMORY.md`) con la nota de la 032; la de MS-Stock («lado Uniko: 032 en `main`»); en `../MS-Sotck/CLAUDE.md` (hoja de ruta) y el quickstart de su 006, la nota de que el lado Uniko está hecho, por PR en MS-Stock (su merge redepliega MS-Stock: lo decide el dueño); **no promover a `production`** (otra señal del dueño, con la puerta de la constitución y `uniko-promote`; llega a NuriaAndrea)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → nada antes.
- **Foundational (Phase 2)** → bloquea todo: `getCatalog` (T005) lo usan US1 y US2; el
  catálogo del stock-mock (T007) lo usan los arneses de US1–US3.
- **US1 (P1)** → después de la Phase 2. Es el MVP.
- **US2 (P1)** → después de la Phase 2; su arnés (T037) reutiliza los helpers de T026 y el
  envío de US1 para el «sí» (T019, T025); T033 va después de T016 (mismo archivo).
- **US3 (P2)** → T042 depende de T019 y T033 (`pipeline.ts`, `agent.ts`); su arnés (T044)
  usa los leads de T026/T027.
- **US4 (P3)** → al final de las historias (comprueba que nada de lo anterior se filtra con
  la bandera apagada).
- **Polish (Phase 7)** → docs y comentarios en paralelo; luego gate → navegador → MS-Stock
  local → PR → merge (dueño) → instancia de pruebas → cierre.

```text
Phase 1 ─→ Phase 2 ─→ US1 (MVP) ─→ US2 ─→ US3 ─→ US4 ─→ Phase 7
                      (T008–T028)  (T029–T037) (T038–T044) (T045–T046)
```

### Within Each User Story

- Tests primero (deben fallar) → implementación → arnés.
- `agent.ts` antes que `pipeline.ts`; `send.ts` antes que `deliverCatalog`.
- Cada historia cierra con su sección del arnés verde.

## Parallel Execution Examples

- **Phase 2**: T003 ‖ T004 ‖ T006 → T005 ‖ T007.
- **US1 tests**: T008 ‖ T009 ‖ T010 ‖ T011 ‖ T012 ‖ T013 ‖ T014 ‖ T015 (ocho archivos
  distintos).
- **US1 implementación**: T016 → T017 ‖ T018 → T019; en paralelo con ellas T020 ‖ T021 ‖
  T022 ‖ T023 ‖ T024 ‖ T025; luego T026 → T027 → T028.
- **US2**: T029 ‖ T030 ‖ T031 ‖ T032 → T033 ‖ T034 ‖ T035 ‖ T036 → T037.
- **US3**: T038 ‖ T039 ‖ T040 → T041 ‖ T042 ‖ T043 → T044.
- **Phase 7**: T047 ‖ T048 ‖ T049 → T050 → T051 → T052 → T053.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: «¿qué venden?» ya recibe el catálogo, con todas sus
   degradaciones y el Laboratorio. Se podría desplegar solo: el cierre de `check_stock`
   seguiría como en la 028.
2. **US2** cambia el cierre con más de 10 y hace que el «sí» cierre el círculo; **US3**
   blinda el prompt (reglas + URL fuera del historial); **US4** comprueba la bandera
   apagada.
3. **Phase 7** verifica contra MS-Stock real en local y en `uniko-lanco` ↔
   `stock.lanco.cloud`, con la prueba por WhatsApp del dueño (SC-006). Un solo PR para
   toda la feature, como en la 028; la promoción a `production` es aparte.

Total: **55 tareas** (Setup: 2 · Foundational: 5 · US1: 21 · US2: 9 · US3: 7 · US4: 2 ·
Polish: 9).
