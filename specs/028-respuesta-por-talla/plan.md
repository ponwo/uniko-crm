# Implementation Plan: Respuesta por talla y fotos por producto en `check_stock`

**Branch**: `028-respuesta-por-talla` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/028-respuesta-por-talla/spec.md`

## Summary

`check_stock` deja de redactar "una línea por producto y a lo sumo una foto" y pasa a
redactar **el conjunto**: con `size` y varios productos, solo los que tienen existencia
en esa talla; sin `size`, solo los que tienen existencia; un solo producto, igual que
en la 026. El turno ya no devuelve **un** texto con **una** foto sino una **lista de
mensajes** (`StockMessage[]`: texto + foto opcional), uno por producto mostrado, con
la frase del modelo al frente del primero; el pipeline los entrega **en orden, de uno
en uno**, reutilizando la entrega con foto de la 026 por mensaje (pie ≤ 1024, respaldo
a texto si la imagen falla), con tope de 5 imágenes y colapso a un solo texto cuando no
hay ninguna foto que enviar (canal sin imágenes o productos sin foto). El adaptador pide
25 resultados y el motor muestra 5. En MS-Stock (repo hermano) se corrige **antes** el
contrato §4 y la búsqueda tolera el plural. Réplica del catálogo real en el stock-mock,
rechazo de una imagen concreta en el wa-mock, arnés E2E con los escenarios de US1–US4
y la marca de derogación en la 026. Decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto sobre Node 22, Next.js 15 App Router
(`pnpm`), como el resto del repo. Sin dependencias nuevas.

**Primary Dependencies**: las de la 026: adaptador `src/server/inventario/client.ts`
(fetch + zod), `src/server/inventario/agent.ts` (redacción), `src/server/ai/pipeline.ts`
(`deliverReply`, `sendPhoto`, `persistTestOutbound`), `src/server/inbox/send.ts`
(`sendText`, `sendImageLink`). Mocks bajo `/api/dev/*` (`stock-mock`, `wa-mock`,
`ai-mock`).

**Storage**: ninguno nuevo (sin migración `drizzle/`): los mensajes salientes de texto e
imagen ya se persisten como hoy; el conjunto filtrado vive en el turno.

**Testing**: Vitest (unit: selección y redacción del conjunto, forma del turno, límite
de consulta, prompt, stock-mock ampliado, wa-mock por link); arnés `scripts/
e2e-selftest.mjs` con `INVENTARIO=on` (sección nueva "028") y con la bandera vacía
(sin cambios); CI en la matriz `default` / `completo`.

**Target Platform**: mismo contenedor Next standalone en Coolify (`uniko-lanco`).

**Project Type**: web-service monolito (App Router).

**Performance Goals**: primer mensaje del turno en el mismo límite de hoy (≤ 6 s desde
la pregunta, SC-005); cada foto ≤ 5 s de espera (regla FR-1120 por mensaje); turno de
5 fotos ≤ 6 s + 5 × 5 s en el peor caso (fuera del webhook, como hoy).

**Constraints**: bandera apagada = cero cambio (SC-002, FR-1313); un solo producto y
productos sin tallas = texto idéntico al de la 026; nunca más de 5 imágenes por turno
ni la misma foto dos veces (SC-004); `image_url` sigue sin entrar al prompt.

**Scale/Scope**: ~4 archivos de producto (`agent.ts`, `client.ts`, `pipeline.ts`,
`prompts.ts`), ~4 de mocks (`stock-mock-state.ts`, ruta `media-mode` + `wa-mock-state`
+ ruta Graph del wa-mock; `ai-mock.ts` sin cambios), ~6 tests, arnés, docs (contrato en
MS-Stock, `docs/inventario-conector.md`, `tests/e2e/us-inventario.md`, la 026 con sus
derogaciones). En MS-Stock: `_matches` + tests + amendment de la 001 + contrato §4.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este plan | Estado |
|---|---|---|
| I. Seguridad de datos | Nada nuevo viaja al cliente salvo lo que MS-Stock ya devuelve (nombre, SKU, existencia, precio, `image_url` pública); la llave sigue solo en el servidor; `image_url` no entra al prompt (FR-1121 vigente). | ✅ |
| II. Soberanía (conector opcional) | Todo detrás de `INVENTARIO`; el único que habla HTTP con MS-Stock sigue siendo `client.ts` (solo cambia el `limit`); la degradación FR-1112 no se toca; el fallo de una foto degrada esa foto, no el turno (R5); mocks feliz/infeliz y CI en ambas configuraciones (R9, R10). | ✅ |
| III. Multi-tenancy | Sin tablas nuevas; los mensajes se persisten con la `organizationId` de la conversación como hoy. | ✅ |
| IV. Idempotencia | `check_stock` sigue siendo solo lectura; la entrega de N mensajes ocurre dentro del mismo turno ya deduplicado por `wa_message_id` del mensaje entrante; ningún reintento propio. | ✅ |
| V. Calidad verificable | Gate + unit tests + arnés E2E ampliado (R10). | ✅ |
| VI. Specs antes de código | Carril ciclo completo declarado; banda FR-13xx; este plan y `tasks.md` antes de programar. | ✅ |
| VII. Trazabilidad | Derogaciones parciales de FR-1110/1111/1119/1124/1125 marcadas en la 026 junto a cada requisito y propagadas (R8), en el mismo PR; supuestos visibles en la spec. | ✅ |
| VIII. Foco vertical | Uniko sigue sin absorber inventario: filtra y redacta lo que MS-Stock devuelve para atender mejor la conversación de WhatsApp. | ✅ |
| IX. Verificación en vivo | Arnés con mocks (feliz + infeliz por mensaje), luego `uniko.lanco.cloud` ↔ `stock.lanco.cloud` con los cuatro modelos reales (SC-007), loop hasta verde; la ráfaga queda acotada a 5 y solo a quien preguntó (guardarraíl). | ✅ |
| X. Irreversibilidad | Sin cambios en `drizzle/`. Reversión: redesplegar el commit anterior (o apagar `INVENTARIO`). | ✅ |
| Restricciones de plataforma | Mocks solo bajo `/api/dev/` (404 en producción, 024); secretos por entorno; adaptador dedicado. | ✅ |

**Resultado del gate (pre-research)**: sin violaciones. **Post-diseño**: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/028-respuesta-por-talla/
├── plan.md              # Este archivo
├── research.md          # R1–R11
├── data-model.md        # Tipos del turno (StockMessage), reglas de selección, invariantes
├── quickstart.md        # Gate, arnés, manual, MS-Stock local, instancia de pruebas
├── contracts/
│   ├── turno-check-stock.md   # Forma del turno, entrega, mocks (stock-mock, wa-mock)
│   └── forma-exacta-delta.md  # Texto a aplicar en MS-Stock (§4 del contrato) ANTES de programar aquí
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/inventario/
├── agent.ts              # checkStockTurn → { ok, messages }, selectProducts, formatProduct (sin cambio de texto)
└── client.ts             # SEARCH_LIMIT 5 → FETCH_LIMIT 25 (lookup); SHOW_LIMIT 5 vive en agent.ts
src/server/ai/
├── pipeline.ts           # entrega secuencial de messages (deliverReplies), colapso a texto, tope de fotos
└── prompts.ts            # "nombre base en singular"
src/server/dev/
├── stock-mock-state.ts   # réplica del catálogo real (3 modelos con foto y tallas + pantalones), plural
└── wa-mock-state.ts      # MediaMode + mediaRejectLink (rechazar solo la imagen cuyo link contenga …)
src/app/api/dev/
├── stock-mock/[...path]/route.ts   # sin cambios de rutas (limit hasta 25 ya soportado)
├── wa-mock/media-mode/route.ts     # body { mode, link? }
└── wa-mock/graph/[...path]/route.ts # reject solo si link coincide (o todos, como hoy)
tests/unit/
├── check-stock-turn.test.ts   # conjunto: talla/varios, uno, sin talla, ninguno, tope, dedupe
├── stock-client.test.ts       # lookup pide limit=25
├── inventario-prompt.test.ts  # singular
├── stock-mock.test.ts         # catálogo nuevo, plural, búsqueda
└── wa-mock-media.test.ts      # (nuevo) rechazo por link
scripts/e2e-selftest.mjs       # caso 9 reescrito + sección "028"
tests/e2e/us-inventario.md     # casos 18–24
docs/inventario-conector.md    # §Tallas: respuesta por talla y fotos por producto
specs/026-conector-inventario/ # marcas DEROGADO (spec, data-model, research, quickstart, tasks)

../MS-Sotck/                   # repo hermano, PR propio, ANTES del código de aquí
├── specs/003-sso-uniko/contracts/uniko-integration.md   # §4: forma exacta + fotos (delta)
├── specs/001-…/spec.md + tasks.md                       # amendment: búsqueda tolerante al plural
├── app/services/products.py                             # _matches con candidatos en singular
└── tests/contract/test_agent_search.py                  # plural
```

**Structure Decision**: no hay módulos nuevos. La redacción del conjunto vive en
`agent.ts` (que ya es "lo que el agente hace con el inventario"), la entrega en
`pipeline.ts` (que ya sabe mandar texto+foto y degradar), y el adaptador solo cambia
un número. Los mocks crecen donde ya estaban.

## Complexity Tracking

> Sin violaciones del Constitution Check.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 — Research

Completada: [research.md](research.md), R1–R11. Sin `NEEDS CLARIFICATION`.

## Phase 1 — Design & Contracts

- [data-model.md](data-model.md): `StockMessage`, `StockTurn` nuevo, reglas de
  selección y redacción por caso, invariantes (tope, dedupe, orden, texto idéntico
  para un producto), estado del wa-mock.
- [contracts/turno-check-stock.md](contracts/turno-check-stock.md): forma del turno,
  entrega secuencial, colapso a texto, `media-mode` con `link`, catálogo del
  stock-mock y sus escenarios.
- [contracts/forma-exacta-delta.md](contracts/forma-exacta-delta.md): el texto que
  sustituye en MS-Stock la regla "a lo sumo la foto del primero" y añade "respuesta
  por talla con varios modelos" y "la búsqueda tolera el plural".
- [quickstart.md](quickstart.md): gate, arnés en ambas configuraciones, manual en el
  Laboratorio, contra MS-Stock local, instancia de pruebas con los cuatro modelos
  reales (SC-007) — sin promover a `production`.

## Post-Design Constitution Check

Re-evaluado tras Phase 1: **sin violaciones**. Sin dependencias ni esquema nuevos. La
única regla de la 026 que se relaja (nunca más de una foto) queda sustituida por un
tope explícito (5) verificado por test y por el arnés.

## Next Step

`/speckit-tasks` (orden sugerido: MS-Stock primero —contrato §4 + plural, PR propio—;
luego aquí: derogaciones en la 026 → `agent.ts` (selección + turno en lista) →
`client.ts` (25) → `pipeline.ts` (entrega secuencial) → prompt → mocks (stock, wa) →
unit tests → arnés (caso 9 + sección 028) → docs → self-test local, MS-Stock local,
deploy de pruebas y SC-007 con los cuatro modelos).
