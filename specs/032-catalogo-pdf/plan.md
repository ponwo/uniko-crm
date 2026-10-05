# Implementation Plan: Catálogo PDF del negocio — acción `send_catalog`

**Branch**: `032-catalogo-pdf` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/032-catalogo-pdf/spec.md`

## Summary

Con `INVENTARIO=on`, el agente gana una acción `send_catalog`: el motor pide el catálogo
a MS-Stock (`GET /v1/agent/catalog` por el adaptador existente, 3 s, sin reintentos) y
lo envía como **un** mensaje de documento por URL (`filename` y pie = frase del modelo +
«Dime modelo y talla y te confirmo existencia y precio», ≤ 1024), sin que el PDF pase por
Uniko. Respaldo a texto con el enlace si WhatsApp rechaza el documento o el canal no
envía documentos; degradación a la frase del modelo si no hay catálogo o MS-Stock falla;
el Laboratorio persiste el documento sin tocar la API. En `check_stock`, el cierre pasa a
depender del total con existencia: de 6 a 10, «Hay más coincidencias…»; con más de 10 o
recorte, se consulta el catálogo y, si existe, «Hay más modelos en nuestro catálogo, ¿te
lo mando?» (deroga en parte FR-1308 de la 028). Prompt, simuladores (stock, WhatsApp,
modelo), bandeja (documento por URL), arnés y documentación. Decisiones en
[research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto sobre Node 22, Next.js 15 App Router
(`pnpm`), como el resto del repo. Sin dependencias nuevas.

**Primary Dependencies**: las de la 026/028: `src/server/inventario/client.ts`
(adaptador: fetch + zod), `src/server/inventario/agent.ts` (redacción del turno),
`src/server/ai/actions.ts` · `pipeline.ts` · `prompts.ts`, `src/server/inbox/send.ts`
(`sendText`, `sendImageLink` → nuevo `sendDocumentLink`), `src/components/inbox/
message-thread.tsx`. Simuladores bajo `/api/dev/*` (stock-mock, wa-mock, ai-mock).

**Storage**: sin cambios en `drizzle/`: mensaje `type: "document"` y adjunto `kind:
"document"` ya existen (008); el documento por URL se persiste con `payload: { url }`,
como la foto de la 026.

**Testing**: Vitest (adaptador, turno, cierre, acciones, prompt, entrega, simuladores);
arnés `scripts/e2e-selftest.mjs` con `INVENTARIO=on` (sección «032») y con la bandera
vacía (sin cambios); CI en la matriz `default` / `completo`.

**Target Platform**: mismo contenedor Next standalone en Coolify (`uniko-lanco`).

**Project Type**: web-service monolito (App Router).

**Performance Goals**: el documento sale en el mismo límite que hoy una respuesta del
agente (≤ 5 s de MS-Stock + ≤ 5 s de WhatsApp en el peor caso, fuera del webhook);
degradación en < 5 s (SC-002); el cierre de `check_stock` solo agrega la consulta del
catálogo (≤ 3 s) cuando hay más de 10 o recorte.

**Constraints**: bandera apagada = cero cambio (US4, SC-005); la URL del PDF nunca en el
prompt (SC-004); los 5 productos de la 028, sus fotos y su orden intactos; nunca más de un
documento por turno.

**Scale/Scope**: ~9 archivos de producto (`client.ts`, `agent.ts`, `actions.ts`,
`pipeline.ts`, `prompts.ts`, `send.ts`, `status.ts`, `lab/runner.ts`, ruta
`api/media/[assetId]`) + `message-thread.tsx`; ~6 de simuladores (`stock-mock-state.ts` +
su ruta, ruta Graph del wa-mock, `ai-mock.ts`, `ai-mock-state.ts` + sus dos rutas de
completions); ~12 archivos de test; dos arneses (`e2e-selftest.mjs`, `e2e-lab.mjs`); docs
(`docs/inventario-conector.md`, `tests/e2e/us-inventario.md`, `README.md`, `CLAUDE.md`,
marca en la 028). Los ajustes que salieron al bajar a tareas están en research R12.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este plan | Estado |
|---|---|---|
| I. Seguridad de datos | La llave de MS-Stock sigue solo en el servidor (`x-api-key`) y nunca en logs; al cliente solo le llega lo que MS-Stock publica (URL pública del PDF y su nombre); la URL no entra al prompt (FR-1709). | ✅ |
| II. Soberanía (conector opcional) | Todo tras `INVENTARIO`; el único que habla HTTP con MS-Stock sigue siendo `client.ts` (`getCatalog`); degradación definida para cada fallo (FR-1708) y para el cierre (cae a «Hay más coincidencias»); el PDF no pasa por Uniko; simuladores feliz/infeliz y CI con la bandera apagada y encendida. | ✅ |
| III. Multi-tenancy | Sin tablas nuevas; mensaje y adjunto con la `organizationId` de la conversación, como la foto de la 026. | ✅ |
| IV. Idempotencia | `send_catalog` es solo lectura de MS-Stock; un documento por turno ya deduplicado por `wa_message_id` del entrante; sin reintentos propios. | ✅ |
| V. Calidad verificable | Gate + unit tests + arnés ampliado en ambas configuraciones (R9). | ✅ |
| VI. Specs antes de código | Carril ciclo completo declarado; banda FR-17xx; spec, este plan y `tasks.md` antes de programar. | ✅ |
| VII. Trazabilidad | Derogación parcial de FR-1308 marcada en la 028 junto al requisito y la mención «029» corregida (FR-1711), en el mismo PR; supuestos visibles en la spec. | ✅ |
| VIII. Foco vertical | Uniko no absorbe el catálogo ni lo genera: envía en la conversación lo que el negocio publica en MS-Stock. | ✅ |
| IX. Verificación en vivo | Arnés con simuladores (feliz e infeliz), MS-Stock local con un PDF real, y `uniko-lanco` ↔ `stock.lanco.cloud` con prueba por WhatsApp (SC-006); loop hasta verde. | ✅ |
| X. Irreversibilidad | Sin cambios en `drizzle/`. Reversión: redesplegar el commit anterior o apagar `INVENTARIO`. | ✅ |
| Restricciones de plataforma | Simuladores solo bajo `/api/dev/` (404 en producción, 024); sin variables nuevas; adaptador dedicado. | ✅ |
| Puerta de promoción | Fuera de esta feature: `main` → `production` solo con la señal del dueño y la puerta completa (llega a NuriaAndrea, que tiene `INVENTARIO=on`). | ✅ |

**Resultado del gate (pre-research)**: sin violaciones. **Post-diseño**: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/032-catalogo-pdf/
├── plan.md              # Este archivo
├── research.md          # R1–R12
├── data-model.md        # Tipos del turno, cierre, lo que se persiste, simuladores
├── quickstart.md        # Gate, arnés, Laboratorio, MS-Stock local, instancia de pruebas
├── contracts/
│   └── turno-send-catalog.md   # Acción, ejecución, envío, cierre, simuladores
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/inventario/
├── client.ts             # + getCatalog() → GET /v1/agent/catalog (CatalogInfo, StockResult)
└── agent.ts              # + sendCatalogTurn, buildCatalogCaption, CATALOG_FOOTER, stripCatalogLink;
                          #   selectProducts devuelve total; closingFor(total, truncated)
src/server/ai/
├── actions.ts            # + send_catalog en inventarioActions; degradeAction
├── pipeline.ts           # + rama send_catalog; deliverCatalog (Laboratorio, documento, respaldo
│                         #   a texto); historial del prompt sin el enlace del respaldo
└── prompts.ts            # + línea de acción y reglas del catálogo (solo con inventario)
src/server/inbox/
├── send.ts               # + sendDocumentLink (espejo de sendImageLink, type "document")
└── status.ts             # + failed tardío del documento ⇒ texto con el enlace (R12.2)
src/server/lab/
└── runner.ts             # + transcriptDe: [Documento: <nombre>] + pie (R12.1)
src/app/api/media/[assetId]/route.ts # + 302 también para documento por URL (R12.3)
src/components/inbox/
└── message-thread.tsx    # linkedUrl: documento por URL abre su URL
src/server/dev/
├── stock-mock-state.ts   # + catalog (estado, versión), CAL-01…12, SUD-01…07
├── ai-mock.ts            # + send_catalog (pregunta general / aceptación), antes de check_stock
└── ai-mock-state.ts      # + lastPrompt (R12.5)
src/app/api/dev/
├── stock-mock/[...path]/route.ts    # + GET v1/agent/catalog, GET catalogo.pdf, POST _catalog
├── wa-mock/graph/[...path]/route.ts # + document por link con mediaModeFor
└── ai-mock/{v1/,}chat/completions/route.ts # pasan los mensajes a recordAiMockCall
tests/unit/
├── stock-client.test.ts             # getCatalog
├── catalog-turn.test.ts             # (nuevo) pie, recorte, degradación, stripCatalogLink
├── check-stock-turn.test.ts         # cierre 5 / 6–10 / >10 / recorte / catálogo caído
├── inventario-actions.test.ts       # send_catalog con y sin bandera; degradeAction
├── inventario-prompt.test.ts        # reglas del catálogo, sin URL
├── deliver-catalog.test.ts          # (nuevo) Laboratorio, documento, respaldo, canal sin medios
├── status-foto-respaldo.test.ts     # failed tardío del documento
├── lab-transcript.test.ts           # (nuevo) transcript con el documento
├── stock-mock.test.ts               # ruta del catálogo, PDF, categorías nuevas
├── wa-mock-media.test.ts            # documento por link, rechazo
├── ai-mock-inventario.test.ts       # send_catalog solo con la mención; aceptación
└── ai-mock-state.test.ts            # (nuevo) lastPrompt
scripts/e2e-selftest.mjs             # sección "032"
scripts/e2e-lab.mjs                  # escenario «Pregunta qué venden»
tests/e2e/us-inventario.md           # casos de la 032
docs/inventario-conector.md          # §Catálogo PDF (032)
specs/028-respuesta-por-talla/spec.md # marca DEROGADO EN PARTE en FR-1308; «029» → «032»
README.md · CLAUDE.md                # párrafo y fila del inventario
```

**Structure Decision**: sin módulos nuevos. El adaptador crece en `client.ts` (único que
conoce HTTP de MS-Stock), la redacción del turno en `agent.ts`, la entrega en `pipeline.ts`
junto a `deliverReply`/`deliverReplies`, y el envío de bajo nivel en `send.ts` junto a
`sendImageLink`. Los simuladores crecen donde ya estaban.

## Complexity Tracking

> Sin violaciones del Constitution Check.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 — Research

Completada: [research.md](research.md), R1–R11; R12 recoge los ajustes que salieron al
bajar a tareas (2026-10-05). Sin `NEEDS CLARIFICATION`.

## Phase 1 — Design & Contracts

- [data-model.md](data-model.md): `CatalogInfo`, `CatalogTurn`, pie y recorte, cierre
  (`closingFor`), lo que se persiste por caso, esquema de la acción, estado de los
  simuladores.
- [contracts/turno-send-catalog.md](contracts/turno-send-catalog.md): acción, ejecución,
  tabla de envío por canal y fallo, tabla del cierre, rutas de los simuladores.
- [quickstart.md](quickstart.md): gate, arnés en ambas configuraciones, Laboratorio y
  bandeja, MS-Stock local con un PDF real, instancia de pruebas (SC-006), sin promover.
- El contrato inter-repo (MS-Stock v2) **no cambia**: ya está publicado y desplegado.

## Post-Design Constitution Check

Re-evaluado tras Phase 1: **sin violaciones**. Sin dependencias, variables ni esquema
nuevos. La única regla existente que cambia (el cierre de FR-1308) queda acotada por
tabla, con su derogación marcada en la 028.

## Next Step

`/speckit-tasks` (orden sugerido: marca en la 028 → adaptador (`getCatalog`) → turno
(`sendCatalogTurn`, pie) y cierre (`closingFor`) → acción y degradación → envío
(`sendDocumentLink`, `deliverCatalog`) → prompt → bandeja → simuladores (stock, wa, ai) →
unit tests → arnés «032» → docs → self-test local, MS-Stock local, deploy de pruebas y
SC-006).
