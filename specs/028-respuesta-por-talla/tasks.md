---
description: "Tareas de la 028 — Respuesta por talla y fotos por producto en check_stock"
---

# Tasks: 028 — Respuesta por talla y fotos por producto

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) · [quickstart.md](quickstart.md)
· contrato de MS-Stock: [`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md) §4

**Tests**: SÍ. La constitución (V, IX) y la spec (FR-1312, FR-1313, SC-001..SC-004) los
exigen: unit por módulo, mocks con camino infeliz **por mensaje**, sección "028" en el
arnés E2E y matriz de CI apagada/encendida. Los tests de cada historia se escriben
primero y deben fallar antes de implementar.

**Organización**: por historia de usuario en orden de prioridad, con dos fases previas
que el dueño pidió mantener en este orden: **MS-Stock primero** (contrato §4 y plural,
FR-1310) y después el cimiento de Uniko (derogaciones y turno en lista sin cambiar
todavía ningún texto).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1 (talla + varios), US2 (un producto igual que hoy), US3 (sin talla +
  varios), US4 (una foto falla)
- Rutas exactas desde la raíz del repositorio; las del repo hermano empiezan por
  `../MS-Sotck/`

---

## ⛔ Tres reglas de orden que no son recomendaciones

### 1. El contrato se cambia en MS-Stock antes de programar aquí (FR-1310)

La "Forma exacta" vive en `uniko-integration.md` §4 del repo hermano. La Phase 1 se
cierra —mergeada y desplegada— antes de tocar `agent.ts`. Si al implementar algo no
cuadra con el delta, se corrige allá y se vuelve.

### 2. Un producto = texto byte a byte igual al de la 026 (FR-1302, FR-1304, SC-002)

`formatProduct` no se toca. La selección por conjunto solo entra con **dos o más**
productos resueltos. Los tests de US2 fijan los textos de la 026 literalmente y corren
antes y después de cada fase.

### 3. Bandera apagada = cero cambio, y se comprueba ANTES de cerrar

La última tarea del cierre corre la suite y el arnés con `INVENTARIO` vacía además de
encendida (FR-1313). Una prueba que solo pasa encendida está probando la mitad que no
corre en ninguna instancia por defecto.

---

## Phase 1: MS-Stock primero (repo hermano `../MS-Sotck/`)

**Purpose**: contrato §4 con el delta D1–D4 y búsqueda tolerante al plural, mergeados
y desplegados en `stock.lanco.cloud` antes de una sola línea en Uniko.

- [X] T001 En `../MS-Sotck/`, crear la rama `busqueda-plural-contrato-028` desde `main` al día
- [X] T002 [P] Aplicar el delta [contracts/forma-exacta-delta.md](contracts/forma-exacta-delta.md) D1–D4 en `../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md` §4 (paso 2 con `limit=25` y plural; "Cómo se redacta al cliente" con la forma real de la 026/028; foto "una por producto, tope 5"; prompt en singular)
- [X] T003 [P] Amendment a FR-017 en `../MS-Sotck/specs/001-consulta-inventario-agente/spec.md`: "…sin distinguir mayúsculas, acentos **ni el plural de la consulta** (ajuste 2026-09-15: cada palabra de ≥ 4 letras se prueba también sin `s` final y, si termina en `es`, sin `es`)" y escenario de aceptación nuevo; añadir en su `tasks.md` una fase "Ajuste 2026-09-15 — plural (Uniko 028)" con T-plural-1..3 (test, implementación, gate)
- [X] T004 Tests primero en `../MS-Sotck/tests/contract/test_agent_search.py`: `test_search_tolerates_plural` ("playeras" encuentra "Playera negra"; "pantalones" encuentra "Pantalón azul"; "playeras negras" encuentra "Playera negra"; "playera" sigue encontrando un producto llamado "Playeras lisas" por contiene; "tenis" no rompe nada) — deben fallar
- [X] T005 Implementar en `../MS-Sotck/app/normalize.py` `singular_candidates(needle: str) -> list[str]` (frase completa: cada palabra ≥ 4 letras terminada en `s` → sin `s`; terminada en `es` → además sin `es`; sin duplicados; sin la original) y en `../MS-Sotck/app/services/products.py::_matches` OR-ear `Product.name_search.like(f"%{c}%")` por cada candidato (a lo sumo 3 términos); `search_public` conserva el orden por el `needle` original; tests de `singular_candidates` (tabla de casos: `playeras`→`playera`; `pantalones`→`pantalone`,`pantalon`; `playeras negras`→`playera negra`; `tenis`→`teni`; `sol`→sin candidatos) en `../MS-Sotck/tests/contract/test_agent_search.py` junto a los del endpoint
- [X] T006 [P] Docs en MS-Stock: `../MS-Sotck/README.md` (búsqueda tolera el plural; lado Uniko 028: respuesta por talla y fotos por producto) y `../MS-Sotck/CLAUDE.md` (hoja de ruta: 005 "lado Uniko: 028 en curso"; mapa del código: `singular_candidates` en `app/normalize.py`)
- [X] T007 Gate de MS-Stock verde: `uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest` y `IMAGES_IN_TESTS=off uv run pytest`; commit(s) en la rama; merge a `main` (flujo de MS-Stock: push a `main` despliega) y verificación remota con `K=… uv run python scratchpad/live_catalog.py playeras "playeras negras" pantalones` → `playeras` devuelve los 4 modelos; anotar resultado en `../MS-Sotck/specs/001-consulta-inventario-agente/quickstart.md` (sección "Ajuste plural 2026-09-15")

**Checkpoint**: `stock.lanco.cloud` responde al plural y el contrato §4 dice lo que la
028 va a implementar. Solo entonces empieza la Phase 2.

---

## Phase 2: Foundational (Uniko — derogaciones y turno en lista, sin cambiar textos)

**Purpose**: dejar marcado lo que se deroga y cambiar la **forma** del turno (lista de
mensajes) y la entrega (serie) conservando exactamente el comportamiento de la 026.
Al terminar esta fase, `pnpm test` y el arnés de la 026 pasan sin tocar un texto.

- [X] T008 Derogaciones (Principio VII) en `specs/026-conector-inventario/spec.md`: junto a FR-1110, FR-1111, FR-1119, FR-1124 y FR-1125, tachar **solo** la parte listada en la tabla "Derogaciones" de [spec.md](spec.md) y añadir el bloque `**DEROGADO** (parcial, 028 `028-respuesta-por-talla`, PR #<n>): <qué deja de regir> — <motivo>` con la referencia al FR-13xx que lo sustituye
- [X] T009 [P] Propagar la marca a los demás artefactos de la 026 donde se citan esos FR: `specs/026-conector-inventario/data-model.md`, `research.md`, `quickstart.md`, `tasks.md` (una nota `(028: …)` por mención, sin borrar el texto original) y reescribir el caso 9 de `tests/e2e/us-inventario.md` con la regla nueva (una imagen por modelo con existencia); añadir los casos 18–24 (US1: G, M, XCH, 40/none, plural, sin foto, equivalencia; US3: tope; US4: rechazo de una imagen)
- [X] T010 Test primero en `tests/unit/check-stock-turn.test.ts`: la forma nueva del turno — `checkStockTurn` devuelve `{ ok, messages }`; con un producto, `messages` tiene un solo elemento cuyo `text` es exactamente el de hoy (`intro + "\n" + formatProduct`) y `imageUrl` la del producto; con fallo, `ok:false` y `messages` = `[{text: intro}]` o `[]`; los tests actuales que leen `turn.text`/`turn.imageUrl` se adaptan a `messages[0]` **sin cambiar los textos esperados** — deben fallar por la forma
- [X] T011 Implementar en `src/server/inventario/agent.ts` los tipos `StockMessage`/`StockTurn` de [data-model.md](data-model.md) y hacer que `checkStockTurn` devuelva la lista, **manteniendo la redacción actual** (una línea por producto unidas por `\n` en un solo mensaje con la foto del primero) — refactor sin cambio observable; constantes `SHOW_LIMIT = 5`, `MAX_PHOTOS = 5` declaradas; comentarios de cabecera citando FR-1301..FR-1308
- [X] T012 Test primero en `tests/unit/stock-client.test.ts`: `lookup`/`searchProducts` piden `limit=25` (FR-1308); debe fallar
- [X] T013 Implementar en `src/server/inventario/client.ts`: `SEARCH_LIMIT = 25` con comentario (028: se filtra del lado Uniko; se muestran 5 en `agent.ts`)
- [X] T014 Implementar en `src/server/ai/pipeline.ts` `deliverReplies(conversation, messages)` según [data-model.md](data-model.md) §Entrega: colapso a un solo `deliverReply` cuando ningún mensaje tiene foto enviable (todas `null`, o canal sin `outboundMedia` y no `isTest`); si no, un `deliverReply(text, { imageUrl })` por mensaje en serie; `window_closed` detiene la serie (lo maneja `deliverReply` con `applyHandoff`); un solo `publish` al final; el bloque `check_stock` usa `deliverReplies(conversation, turn.messages)`; con la forma de la Phase 2 (un mensaje) el comportamiento es idéntico
- [X] T015 Gate + arnés de la 026 sin cambios: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`; `pnpm dev` con `INVENTARIO=on` (base desechable nueva, matar el `next dev` anterior con `taskkill`) y `pnpm test:e2e` → todos los checks de inventario de la 026 verdes con los mismos textos (incluido, todavía, el caso 9 viejo: la regla nueva entra en US3)

**Checkpoint**: forma nueva, comportamiento viejo, todo verde. Las historias solo
cambian `selectProducts`/la redacción del conjunto y los mocks.

---

## Phase 3: User Story 1 — Pregunta por una talla con varios modelos (Priority: P1) 🎯 MVP

**Goal**: con `size` y ≥ 2 productos, solo los con existencia en esa talla, un mensaje
por producto con su foto y su precio; agotados y sin la talla omitidos; ninguno → frase;
plural encontrado; sin foto → texto en su lugar.

**Independent Test**: arnés con el stock-mock ampliado: "¿tienen playeras en G?" →
exactamente `image` NEG, `text` ROJ, `image` GRS con los pies del
[contrato §1](contracts/turno-check-stock.md); "en M", "en XCH", "pantalones en 40",
"pantalones en 32" según la tabla del [quickstart §2](quickstart.md).

- [X] T016 [P] [US1] Tests primero en `tests/unit/check-stock-turn.test.ts` (fixtures de 3+ modelos con tallas cruzadas, uno sin foto, uno sin tallas con existencia, uno sin tallas agotado): con `size` y varios → solo los con existencia en la talla, un mensaje por producto, `text` = `Nombre (SKU) talla G: 7 pieza — $219 MXN`, `imageUrl` del propio producto, sin foto → `null`; el sin tallas con existencia aparece con su línea de siempre; el agotado no; agotados en la talla y sin la talla ausentes (ningún `text` contiene "agotad" ni "no viene"); ninguno con existencia → un solo mensaje `Por ahora no tengo <query> en talla <size>.`; `intro` solo en el primer `text`; equivalencia "grande" → G; orden = orden de entrada — deben fallar
- [X] T017 [P] [US1] Tests primero en `tests/unit/stock-mock.test.ts`: catálogo ampliado ([contrato §3](contracts/turno-check-stock.md)): `search?q=playeras&limit=25` → 7 modelos en orden de catálogo con `image_url` distintas por modelo (`?m=…`); `q=pantalones` → 2; `q=PLA-GRS-G` → el modelo gris; `products/PLA-GRS-G` → talla con `label:"G"`, `parent_sku`; `products/PAN-AZ-32` → talla `32`; los tests existentes que listan resultados de "playera" se actualizan a la lista nueva — deben fallar
- [X] T018 [P] [US1] Test primero en `tests/unit/inventario-prompt.test.ts`: la línea de `check_stock` y la regla mencionan "singular" (y siguen mencionando `size`); con la bandera apagada nada de esto aparece — debe fallar
- [X] T019 [US1] Implementar en `src/server/inventario/agent.ts` `selectProducts(products, size)` y la redacción del conjunto para `size` + ≥ 2 según [data-model.md](data-model.md) §Reglas (casos 3 con `size`), incluida la regla de fotos (dedupe por URL, `MAX_PHOTOS`), el recorte a `SHOW_LIMIT` y el cierre `Hay más coincidencias, ¿me dices cuál te interesa?` cuando sobran o `truncated`; `formatProduct` intacto
- [X] T020 [US1] Implementar en `src/server/dev/stock-mock-state.ts` las seis filas nuevas al final de `STOCK_MOCK_CATALOG` (`PLA-AZL`, `PLA-VRD`, `PLA-GRS`, `PLA-AMA`, `PAN-AZ`, `PAN-NG` con precios, tallas y `imagePath` con `?m=…` según el contrato) y `searchActive` tolerante al plural (`singularCandidates(needle)` con la misma regla que MS-Stock, en el mismo archivo); `variantSku` ya cubre `PAN-AZ-32`
- [X] T021 [US1] Implementar en `src/server/ai/prompts.ts`: `"query":"<nombre base del producto, en singular y sin la talla, o su SKU>"` y la regla "Escribe el nombre en singular (playera, no playeras); la talla va en size"
- [X] T022 [US1] Arnés `scripts/e2e-selftest.mjs`: sección `== 028: respuesta por talla y fotos ==` con los casos de US1 (leads `52146270280xx`): "¿tienen playeras en G?" (3 salientes: image NEG con pie `Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN`, text ROJ, image GRS; ningún saliente contiene "agotad"/"no viene"/otra talla), "¿tienen playeras en M?" (image NEG, image VRD), "¿tienen playeras en extra chica?" (image NEG, image AZL — equivalencia), "¿tienen pantalones en 40?" (un text con `Por ahora no tengo pantalones en talla 40.`), "¿tienen pantalones en 32?" (image PAN-AZ, text PAN-NG); comprobar también el hilo del Inbox (N mensajes `image` con `media.payload.url` y pie) y que `icon-` no aparece en ningún texto; `pnpm dev` + `pnpm test:e2e` → verde

**Checkpoint**: US1 verde en unit y arnés; MVP entregable.

---

## Phase 4: User Story 2 — Un solo modelo se sigue contestando como hoy (Priority: P1)

**Goal**: regresión cero: un producto (con o sin `size`, con o sin tallas, por SKU de
talla) → texto idéntico al de la 026 y su foto; bandera apagada → nada.

**Independent Test**: los tests de `check-stock-turn` que fijan los textos de la 026 y
los casos 1–8 y 10–17 del arnés pasan sin cambiar el esperado.

- [X] T023 [P] [US2] Tests en `tests/unit/check-stock-turn.test.ts` (ya existentes, revisados): un producto con `size` agotada → `talla M: agotada — … Con existencia: …`; talla inexistente → `no viene en talla XXG. Tallas: …`; talla por SKU → `(PLY-ROJ-G) talla G`; sin tallas → línea de siempre con o sin `size`; sin `size` un modelo → `— $219 MXN. Tallas: …`; agotado solo → `agotado`; todos con `messages.length === 1` y `imageUrl` del producto — deben pasar ya (fijan la regresión)
- [X] T024 [US2] Arnés: confirmar que los casos 1–8 y 10–17 de `tests/e2e/us-inventario.md` (secciones 026 del arnés) siguen verdes con el catálogo ampliado y `limit=25` (en particular "¿tienen playera negra?" sigue resolviendo a **un** producto: `search` con "playera negra" no coincide con los modelos nuevos) — si alguno cambia, es un defecto de la implementación, no del test
- [X] T025 [US2] Con `INVENTARIO=` vacío (base desechable nueva): `pnpm test` y `pnpm test:e2e` → sin cambios (FR-1313); anotar en el quickstart

---

## Phase 5: User Story 3 — Varios modelos sin talla: cada uno con su foto (Priority: P2)

**Goal**: sin `size` y ≥ 2 productos, un mensaje por producto con existencia (línea
vigente + su foto), agotados omitidos, tope 5 + "Hay más coincidencias…"; el caso 9 de
la 026 pasa a esta regla.

**Independent Test**: "¿tienen playeras?" → 5 mensajes (NEG img, ROJ txt, AZL img, VRD
img, GRS img) + text "Hay más coincidencias…"; blanca ausente; ≤ 5 `image`, sin `link`
repetido.

- [X] T026 [P] [US3] Tests primero en `tests/unit/check-stock-turn.test.ts`: sin `size` y varios → solo con existencia, línea vigente por producto (`— $… Tallas: …` o simple), foto por producto; 6 con existencia → 5 mensajes + cierre; `truncated:true` con 2 → 2 + cierre; todos agotados → `Por ahora no tengo <query> con existencia.`; 7 con foto → exactamente 5 `imageUrl` no nulos y ninguno repetido (fixture con dos productos con la misma URL → la segunda `null`) — deben fallar
- [X] T027 [US3] Implementar en `src/server/inventario/agent.ts` el caso 3 sin `size` de [data-model.md](data-model.md) (filtro `stock > 0`, línea vigente, fotos, tope, cierre) reutilizando `selectProducts`
- [X] T028 [US3] Arnés: reescribir el check "búsqueda con varios resultados: a lo sumo UNA imagen (la del primero)…" de la sección foto de la 026 (`¿tienen playera?`, lead `5214627026006`) con la regla nueva (5 mensajes en orden NEG img · ROJ txt · AZL img · VRD img · GRS img + text "Hay más coincidencias, ¿me dices cuál te interesa?"; blanca ausente; ≤ 5 `image`; `link`s distintos; frase de entrada solo en el primero) y añadir a la sección 028 el caso Laboratorio (conversación de prueba "¿tienen playeras en M?" → dos mensajes `image` persistidos, sin tocar Graph: el outbox del wa-mock no crece) → `pnpm test:e2e` verde

---

## Phase 6: User Story 4 — Cuando una foto no sale, el dato sale igual (Priority: P3)

**Goal**: una imagen rechazada o lenta convierte **esa** línea en texto, en su lugar;
las demás salen con foto; canal sin imágenes → un solo texto; conversación de prueba →
N imágenes persistidas.

**Independent Test**: wa-mock `media-mode {reject, link:"m=grs"}` + "¿tienen playeras
en G?" → `image` NEG · `text` ROJ · `text` GRS en ese orden, sin `failed` en el hilo,
`[agente] foto:` en el log.

- [X] T029 [P] [US4] Test primero en `tests/unit/media-send.test.ts` (o nuevo `tests/unit/wa-mock-media.test.ts` si el existente no cubre la ruta Graph del mock): con `mediaMode = "reject"` y `mediaLink = "m=grs"`, un `image` cuyo `link` contiene `m=grs` recibe 400 y otro con `m=azl` recibe 200; sin `mediaLink`, ambos 400; `slow` con `link` solo retrasa la que coincide; `DELETE` limpia ambos — debe fallar
- [X] T030 [US4] Implementar en `src/server/dev/wa-mock-state.ts` (`mediaLink?: string`), `src/app/api/dev/wa-mock/media-mode/route.ts` (`bodySchema` con `link: z.string().min(1).max(200).optional()`; `GET` devuelve `link`; `DELETE` borra) y `src/app/api/dev/wa-mock/graph/[...path]/route.ts` (aplicar `reject`/`slow` solo si `!state.mediaLink || link.includes(state.mediaLink)`)
- [X] T031 [P] [US4] Test en `tests/unit/check-stock-turn.test.ts` o en un test del pipeline si existe patrón (`tests/unit/*pipeline*`): `deliverReplies` colapsa a un solo texto cuando ningún mensaje tiene foto, o cuando el canal no tiene `outboundMedia` y la conversación no es de prueba; con fotos, llama a `deliverReply` una vez por mensaje en orden (usar `vi.mock` de `@/server/inbox/send` como en `foto-por-url.test.ts`) — debe fallar si el colapso no está
- [X] T032 [US4] Ajustar `src/server/ai/pipeline.ts` si T031 lo exige (colapso por canal; `isTest` conserva las N imágenes) y documentar en el comentario de `deliverReplies` las reglas FR-1305/FR-1306
- [X] T033 [US4] Arnés, sección 028: `media-mode {mode:"reject", link:"m=grs"}` + "¿tienen playeras en G?" (lead nuevo) → tipos `["image","text","text"]` en ese orden, el tercer texto es la línea de la gris, el hilo no tiene `failed`, y `outboxDe` no muestra la imagen rechazada; `media-mode {mode:"slow", link:"m=vrd"}` + "¿tienen playeras en M?" → NEG con foto y VRD como texto dentro de `coalesce + 5000 + margen`; `DELETE media-mode` al final; esperar al mock lento antes del siguiente lead (como hace la 026) → verde

---

## Phase 7: Polish, docs y verificación en vivo

- [X] T034 [P] Docs Uniko: `docs/inventario-conector.md` §Tallas → "Respuesta por talla y fotos por producto (028)" con las reglas y ejemplos del [contrato §1](contracts/turno-check-stock.md); `README.md` (línea de tallas: "…con la foto de cada modelo que sí la tiene"); `CLAUDE.md` fila del inventario (menciona `deliverReplies` y la regla de 5 fotos)
- [X] T035 [P] Comentarios del código que citan FR derogados (`src/server/inventario/agent.ts`, `client.ts`, `src/server/ai/pipeline.ts`, `tests/unit/check-stock-turn.test.ts`, `foto-por-url.test.ts`, `stock-client.test.ts`, `scripts/e2e-selftest.mjs`): actualizar a FR-13xx donde la regla cambió; dejar FR-1120/FR-1121/FR-1122/FR-1123 donde siguen vigentes
- [X] T036 Gate completo verde: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`; arnés completo con `INVENTARIO=on` (base desechable nueva) y con `INVENTARIO=` vacío (otra base); registrar conteos en [quickstart.md](quickstart.md) "Resultados del self-test local"
- [X] T037 Contra MS-Stock local ([quickstart §4](quickstart.md)): levantar `../MS-Sotck` con Postgres local y sembrar la réplica del catálogo real (4 modelos con tallas; fotos con el stub S3 si aplica), `.env` de Uniko apuntando a `http://localhost:8000`; en el Laboratorio: "¿tienen playeras en G?", "¿en M?", "¿en XCH?", "¿en 24?", "¿tienen playeras negras?" → según §4; anotar resultados; corregir y repetir hasta verde
- [ ] T038 Commit(s) por fase con mensajes `feat(028)`/`test(028)`/`docs(028)`, push de `028-respuesta-por-talla`, PR a `main` con resumen, evidencias del arnés (ambas configuraciones) y la lista de derogaciones; CI `default` y `completo` verdes. **Merge = señal del dueño**
- [ ] T039 Tras el merge y el deploy de `uniko-lanco` (Coolify): `GET https://uniko.lanco.cloud/api/health` reporta el commit; logs de arranque sin errores; en WhatsApp o en el Laboratorio de la instancia, contra `stock.lanco.cloud` con los cuatro modelos reales: los cinco casos del [quickstart §5](quickstart.md) (G → Negra y roja con foto; M → Negra y verde; XCH → solo roja; 24 → frase; roja en M → 026 intacta); revisar el log de `uniko-lanco` (`[agente] inventario:` solo si hubo fallo real) y el de `ms-stock` (peticiones `search?q=…&limit=25`); registrar en el quickstart "Resultados en la instancia de pruebas" (SC-007)
- [ ] T040 Cerrar la T057 de `specs/026-conector-inventario/tasks.md` con la misma evidencia (marcar `[X]` y anotar en su quickstart "Resultados de las tallas en la instancia de pruebas — 2026-09-…"); actualizar `memory/tallas-026-pr29.md` (o crear `memory/respuesta-por-talla-028.md`) y `memory/MEMORY.md`; **no promover a `production`** (otra señal del dueño)

---

## Dependencies & Execution Order

- **Phase 1 (MS-Stock)** → bloquea todo lo demás (FR-1310). Se hace y despliega primero.
- **Phase 2 (Foundational)** → bloquea US1–US4: la forma del turno y `deliverReplies`
  se cambian una vez, sin comportamiento nuevo.
- **US1 (P1)** y **US2 (P1)**: US2 son los tests de regresión; conviene tenerlos verdes
  antes y después de US1. **US3 (P2)** reutiliza `selectProducts` de US1. **US4 (P3)**
  solo necesita la Phase 2 y el wa-mock; puede ir en paralelo con US3.
- **Phase 7**: docs y comentarios en paralelo; gate → MS-Stock local → PR → merge
  (dueño) → instancia de pruebas → cierre.

```text
Phase 1 (MS-Stock) ─→ Phase 2 ─→ US1 ─→ US3 ─┐
                                 └→ US2 (regresión, corre siempre)   ├─→ Phase 7
                                 └→ US4 ─────────────────────────────┘
```

## Parallel Execution Examples

- Phase 1: T002 ‖ T003 ‖ T006 (archivos distintos) mientras T004→T005 avanzan.
- Phase 2: T008 ‖ T009 (026) mientras T010→T011 (agent) y T012→T013 (client).
- US1: T016 ‖ T017 ‖ T018 (tests) → T019 ‖ T020 ‖ T021 → T022.
- US4: T029 ‖ T031 → T030 ‖ T032 → T033.
- Phase 7: T034 ‖ T035 → T036 → T037 → T038.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1 + US2**: la pregunta por talla ya responde solo con
   lo que hay, con foto por modelo, y nada de la 026 cambia. Se puede desplegar.
2. **US3** añade la misma regla sin talla (y reescribe el caso 9); **US4** cierra el
   camino infeliz por mensaje.
3. **Phase 7** verifica en vivo con los cuatro modelos reales y cierra la T057 de la
   026 con la misma evidencia.

Total: **40 tareas** (Phase 1: 7 · Phase 2: 8 · US1: 7 · US2: 3 · US3: 3 · US4: 5 ·
Polish: 7).
