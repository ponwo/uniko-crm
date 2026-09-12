# Implementation Plan: Conector INVENTARIO — botón "Inventario" (SSO a MS-Stock) y `check_stock`

**Branch**: `026-conector-inventario` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/026-conector-inventario/spec.md`

## Summary

Conector opcional (ADR-001) detrás de la bandera `INVENTARIO` que enlaza Uniko con
**MS-Stock** (repo hermano, feature 003 desplegada): (1) un renglón "Inventario" en la
navegación que llama a `GET /api/inventario/sso`, donde el servidor emite un **pase
JWT HS256** de un solo uso y 2 minutos (`jose`, `STOCK_SSO_SECRET`) y redirige al
portal de MS-Stock; (2) la acción tipada `check_stock` del agente, ejecutada a través
de un **adaptador dedicado** (`src/server/inventario/client.ts`, 3 s, sin reintentos,
resultado tipado) cuyo texto pega el sistema como hace la agenda, con degradación a
`reply`/`none` ante cualquier fallo; (3) una pestaña "Inventario" en Ajustes con
"Probar conexión". Sin tablas ni migraciones: la configuración son tres variables de
despliegue exigidas solo con la bandera encendida. Verificación con un `stock-mock`
propio (feliz e infeliz), una regla nueva en el `ai-mock`, unit tests y
`inventarioChecks()` en el arnés E2E; luego contra MS-Stock local y la instancia de
pruebas. Decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto sobre Node 22 (`.nvmrc`), Next.js 15 App
Router + React 19 (sin cambios de stack)

**Primary Dependencies**: + `jose@^6` como dependencia directa (ya presente vía Better
Auth; firma HS256 del pase). Zod para la acción y las respuestas de MS-Stock. Sin
nada más.

**Storage**: ninguno nuevo (sin migración `drizzle/`); tres variables de entorno

**Testing**: Vitest (unit: bandera, env, adaptador con fetch falso, texto del turno,
esquema/prompt, pase, regla del ai-mock) + `scripts/e2e-selftest.mjs`
(`inventarioChecks()` con `stock-mock`) + guion `tests/e2e/us-inventario.md`;
Playwright para el botón y Ajustes en escritorio y 375 px

**Target Platform**: mismo contenedor Next standalone en Coolify; navegadores de
escritorio y móvil

**Project Type**: web-service monolito (App Router)

**Performance Goals**: clic → portal < 3 s (SC-001); `check_stock` ≤ 3 s por llamada;
turno degradado < 6 s (SC-003); `status` < 5 s

**Constraints**: bandera apagada = cero superficie y cero cambio (SC-004); llave y
secreto nunca al navegador ni a logs (SC-005); solo lectura contra MS-Stock; el
dominio no conoce HTTP de MS-Stock (adaptador); mocks solo bajo `/api/dev/`

**Scale/Scope**: ~12 archivos nuevos (`src/server/inventario/{flag,client,agent,sso}.ts`,
2 rutas API, página + cliente de Ajustes, `stock-mock` + estado, tests) y ~8
modificados (`env.ts`, `actions.ts`, `prompts.ts`, `pipeline.ts`, `app-nav.tsx`,
`layout.tsx`, `settings-nav.tsx`, `settings/layout.tsx`, `ai-mock.ts`, arnés E2E,
CI, docs); ~900 líneas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este plan | Estado |
|---|---|---|
| I. Seguridad de datos | `STOCK_API_KEY` y `STOCK_SSO_SECRET` solo en el servidor (variables de entorno); nunca en respuestas, HTML ni logs (tests literales, SC-005); el pase viaja firmado y caduca en 2 min; no hay credenciales del negocio que cifrar porque no se guardan en la base (R2). | ✅ |
| II. Soberanía (conector opcional, 5 condiciones) | (1) apagado por defecto tras `INVENTARIO` (R1); (2) aislado en `src/server/inventario/client.ts` con contrato propio (R3, FR-1114); (3) la instancia funciona completa sin él y el fallo degrada como la agenda: el agente responde sin inventario, la conversación sigue (R6); (4) credenciales de la propia instancia de MS-Stock del negocio, por entorno como `ZOOM_*`; (5) `stock-mock` con modos infelices y CI en ambas configuraciones (R9, R10). | ✅ |
| III. Multi-tenancy | Una instancia = un negocio = un MS-Stock; no hay tabla nueva; la sesión de Uniko sigue resolviendo `organizationId`; el pase lleva `sub` del usuario, no de la org. | ✅ |
| IV. Idempotencia | `check_stock` es solo lectura (FR-1113); el pase es de un solo uso del lado MS-Stock; nada que deduplicar en Uniko. | ✅ |
| V. Calidad verificable | Gate + unit tests por módulo + arnés E2E extendido (FR-1116/1117). | ✅ |
| VI. Specs antes de código | Carril ciclo completo declarado en la spec; este plan y `tasks.md` antes de programar; banda FR-11xx. | ✅ |
| VII. Trazabilidad | Supuestos visibles en la spec (botón para todo miembro, sin estado en BD, lectura en el Laboratorio, arranque estricto); decisiones en research.md. | ✅ |
| VIII. Foco vertical | Uniko no absorbe inventario: solo enlaza (SSO) y consulta (lectura); el catálogo, existencias y movimientos siguen en MS-Stock. | ✅ |
| IX. Verificación en vivo | Self-test con mocks (feliz + infeliz), contra MS-Stock local y contra `uniko.lanco.cloud` ↔ `stock.lanco.cloud` (quickstart §2–§5); loop hasta verde. | ✅ |
| X. Irreversibilidad | Sin cambios en `drizzle/`. Plan de reversión: apagar `INVENTARIO` (o redesplegar el commit anterior); no hay esquema que revertir. | ✅ |
| Restricciones de plataforma | Mocks solo bajo `/api/dev/` (middleware 024 + `mockGuard`); secretos por entorno; adaptador dedicado. | ✅ |

**Resultado del gate (pre-research)**: sin violaciones. **Post-diseño**: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/026-conector-inventario/
├── plan.md
├── research.md              # R1–R10
├── data-model.md            # sin tablas: formas en runtime e invariantes
├── quickstart.md            # mocks → MS-Stock local → instancia de pruebas
├── contracts/
│   ├── conector-inventario.md   # rutas, navegación, acción, adaptador, pase, variables
│   └── stock-mock.md            # el MS-Stock de mentira del self-test
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── lib/env.ts                          # + INVENTARIO, STOCK_BASE_URL, STOCK_API_KEY, STOCK_SSO_SECRET + superRefine
├── server/inventario/
│   ├── flag.ts                         # parseInventarioFlag, inventarioEnabled, inventarioDisabledResponse
│   ├── client.ts                       # adaptador: getProduct, searchProducts, lookup, health, looksLikeSku (3 s, tipado)
│   ├── agent.ts                        # checkStockTurn({ query, intro }) → { text, ok }
│   └── sso.ts                          # issueSsoUrl({ userId, name, next? }) con jose
├── server/ai/actions.ts                # + inventarioActions, agentActionSchema({ agenda, inventario }), degradeAction
├── server/ai/prompts.ts                # + inventario: línea de la acción y reglas
├── server/ai/pipeline.ts               # + ejecución/degradación de check_stock
├── server/dev/ai-mock.ts               # + regla check_stock (solo si el prompt la menciona)
├── server/dev/stock-mock-state.ts      # catálogo, modo, lastSso, calls, reset
├── app/api/inventario/sso/route.ts     # GET → 302 a MS-Stock (404 sin bandera, 401 sin sesión)
├── app/api/inventario/status/route.ts  # GET → { baseUrl, status }
├── app/api/dev/stock-mock/[...path]/route.ts
├── app/(app)/layout.tsx                # inventario={inventarioEnabled()}
├── app/(app)/settings/layout.tsx       # inventario={inventarioEnabled()}
├── app/(app)/settings/inventario/page.tsx
├── components/app-nav.tsx              # INVENTARIO_ITEM externo tras Pipeline/Citas
├── components/settings/settings-nav.tsx    # INVENTARIO_TAB
└── components/settings/inventario-client.tsx  # dirección + "Probar conexión"

tests/unit/
├── inventario-flag.test.ts · inventario-env.test.ts · stock-client.test.ts
├── check-stock-turn.test.ts · inventario-actions.test.ts · inventario-prompt.test.ts
├── inventario-sso.test.ts · ai-mock-inventario.test.ts
tests/e2e/us-inventario.md
scripts/e2e-selftest.mjs                # + inventarioChecks()
.github/workflows/ci.yml                # + inventario en la matriz (default "", completo "on" + STOCK_* de mentira)
.env.example · docs/inventario-conector.md · README.md · CLAUDE.md · package.json (jose)
```

**Structure Decision**: `src/server/inventario/` es el módulo del conector, con la
misma anatomía que `src/server/agenda/` (bandera, servicio para el agente) y un
`client.ts` que hace de adaptador (como `src/lib/meta`). Las rutas viven en
`src/app/api/inventario/` (no bajo `/api/bot/*`, que es la superficie del cerebro
externo con otra autenticación).

## Complexity Tracking

> Sin violaciones del Constitution Check.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 — Research

Completada: [research.md](research.md), R1–R10. Sin `NEEDS CLARIFICATION`.

## Phase 1 — Design & Contracts

- [data-model.md](data-model.md): configuración, tipos del adaptador, acción y
  texto pegado, claims del pase, estado del conector y del mock, invariantes.
- [contracts/conector-inventario.md](contracts/conector-inventario.md): rutas,
  navegación, acción, adaptador, emisión del pase, variables.
- [contracts/stock-mock.md](contracts/stock-mock.md): rutas imitadas, catálogo,
  modos, control.
- [quickstart.md](quickstart.md): gate, self-test con mocks, manual en navegador,
  contra MS-Stock local, despliegue en la instancia de pruebas (sin promover a
  `production`).

## Post-Design Constitution Check

Re-evaluado tras Phase 1: **sin violaciones**. Única dependencia nueva declarada:
`jose` (librería, ya presente). Sin cambios de esquema. Superficie nueva solo con la
bandera; mocks solo bajo `/api/dev/`.

## Next Step

`/speckit-tasks` (orden sugerido: bandera + env + adaptador → acción/prompt/pipeline
+ texto del turno → pase + ruta + botón → status + Ajustes → mocks + arnés E2E →
docs/CI → self-test local, MS-Stock local, deploy de pruebas con `INVENTARIO=on`).
