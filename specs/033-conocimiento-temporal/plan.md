# Implementation Plan: 033 — Conocimiento temporal

**Branch**: `033-conocimiento-temporal` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/033-conocimiento-temporal/spec.md`

## Summary

Cada entrada del conocimiento gana una fecha opcional «vigente hasta» (`kb_entry.valid_until`,
`date`, inclusiva). Al pasar esa fecha, la entrada sale del conocimiento que reciben el
agente, la API del cerebro externo, el juez y el generador del Laboratorio; sigue
existiendo, visible para el dueño en «Conocimiento obsoleto» y recuperable cambiando su
fecha. Además, el agente sabe **siempre** qué día es (hoy solo con agenda) y ve los
separadores de día en el historial, con una regla nueva: lo dicho en días anteriores
sobre promociones, precios o cupos no se repite como vigente.

**El riesgo de la feature no es la columna, son los seis lectores** de `kb_entry`
(agente, API del bot, pantalla, contador, juez, generador): filtrar cinco y olvidar uno
no rompe nada visible, solo hace que el producto mienta. Por eso hay una **puerta
única** (`src/server/kb/vigencia.ts`) y un **guard** que escanea la raíz `src/` y falla
si alguien lee `kb_entry` fuera de ella. El corte se decide en código (función pura), no
en SQL, porque el doble de base de los unitarios ignora el `where`.

Base: la 007 de Kosmo, con cinco ajustes de Uniko ([research.md](research.md) D-04,
D-05, D-10, D-11, D-12) y una pantalla que además deja editar el texto (D-14).

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`) sobre
Node 22, Next.js 15 App Router (`pnpm`). Sin dependencias nuevas: las fechas se resuelven
con `Intl` (ya lo usa `src/lib/time/slots.ts`).

**Primary Dependencies**: Drizzle ORM (columna `date` en modo `string`), Zod (validación
de la fecha), los helpers de `src/lib/time/slots.ts` (`dayIsoInTz`, `addDaysISO`,
`nowLabelInTz`), `src/server/ai/history.ts` (`withDayMarkers`).

**Storage**: PostgreSQL. Una columna nueva en `kb_entry` (`drizzle/0018_kb_vigencia.sql`).
`agent_test_run` no cambia (D-10).

**Testing**: Vitest (puerta y funciones puras con su borde de día, guard, prompt, ruta de
alta/edición, juez del Laboratorio, ai-mock); arnés nuevo `scripts/e2e-kb-vigencia.mjs`
contra la app viva con mocks (API + agente + Laboratorio + pantalla con Playwright),
encadenado en `pnpm test:e2e`; CI en la matriz `default` / `completo`.

**Target Platform**: el mismo contenedor Next standalone en Coolify (flota de tres).

**Project Type**: web-service monolito (App Router).

**Performance Goals**: sin objetivo nuevo. La puerta hace la misma consulta que hoy
(todo el conocimiento de la organización) y filtra en memoria un conjunto del tamaño de
un prompt. Sin agenda, el turno no hace ninguna consulta extra para la zona (constante).

**Constraints**: entradas sin fecha = cero cambio (SC-002); ningún lector nuevo de
`kb_entry` puede saltarse la puerta sin que una prueba se caiga; el corte nunca en UTC;
el juez y el agente de una corrida ven el mismo conocimiento.

**Scale/Scope**: 1 columna, 2 módulos nuevos (`server/kb/vigencia.ts`,
`server/negocio/zona.ts`) + 1 constante (`lib/time/zona.ts`), 6 lectores migrados,
prompt + historial, Laboratorio (runner, generador), ai-mock, 1 pantalla ampliada, ~6
archivos de test, 1 arnés nuevo, docs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este plan | Estado |
|---|---|---|
| I. Seguridad de datos | No hay secretos nuevos. Una fecha de vigencia no es dato sensible y no viaja a ningún sitio nuevo: el conocimiento ya iba al proveedor LLM; lo vencido deja de ir. | ✅ |
| II. Soberanía | Cero dependencias y cero terceros; fechas con `Intl` (plataforma). | ✅ |
| III. Multi-tenancy | Sin tabla nueva; la columna cuelga de `kb_entry` (`organization_id NOT NULL`); la puerta lee con `scoped()`; la zona se resuelve por organización. | ✅ |
| IV. Idempotencia | El vencimiento es una comparación, no un evento: no hay proceso que marque nada ni nada que re-ejecutar. La migración es `ADD COLUMN` nullable dentro del registro de drizzle. | ✅ |
| V. Calidad verificable | Gate + unitarios (con los rojos demostrados: guard, corte en UTC, lector sin filtro) + arnés nuevo. | ✅ |
| VI. Specs antes de código | Carril ciclo completo; banda FR-18xx; spec, plan y tareas antes de programar. | ✅ |
| VII. Trazabilidad | 16 decisiones en [research.md](research.md); los desvíos de Kosmo dicen su porqué; el comentario de `pipeline.ts` que pedía «zona propia» se reescribe apuntando a D-05. | ✅ |
| VIII. Foco vertical | Mejora la fidelidad de lo que el agente le dice a un cliente por WhatsApp. | ✅ |
| IX. Verificación en vivo | Arnés `e2e-kb-vigencia.mjs` (feliz + infelices, pantalla incluida) hasta verde; prueba en la instancia de pruebas tras el merge (regla del historial con el modelo real). | ✅ |
| X. Irreversibilidad | Toca `drizzle/`: una columna nullable, sin backfill, sin borrar nada. Ensayo ANTES de `main` contra un Postgres desechable con respaldos reales restaurados (ILTU y NuriaAndrea). Reversión: redesplegar el commit anterior (la columna queda sin uso). | ✅ |
| Sandbox del Laboratorio | No se relaja: las conversaciones `is_test` siguen sin tocar la API; cambia qué fecha y qué conocimiento ven, no a dónde envían. | ✅ |
| Módulos opcionales | Sin bandera (D-16): no es un módulo opcional, y sin fechas el conocimiento no cambia. | ✅ |
| Mocks bajo `/api/dev/` | El cambio del ai-mock vive en `src/server/dev/ai-mock.ts`, ya tras el perímetro. Sin rutas nuevas. | ✅ |
| Puerta de promoción | Fuera de esta feature: `main` → `production` solo con la señal del dueño y la puerta completa (el ensayo X ya hecho). | ✅ |

**Resultado del gate (pre-research)**: sin violaciones. **Post-diseño**: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/033-conocimiento-temporal/
├── plan.md              # Este archivo
├── spec.md              # Qué y por qué (Q1–Q4 resueltas por el dueño)
├── research.md          # D-01…D-16
├── data-model.md        # La columna y los estados derivados
├── quickstart.md        # Gate, arnés, ensayo X, instancia de pruebas
├── contracts/
│   └── kb-vigencia.md   # Rutas que cambian, turno del agente, ai-mock
├── checklists/
│   └── requirements.md
└── tasks.md             # Tareas
```

### Source Code (repository root)

```text
src/lib/
├── db/schema.ts                 # + kb_entry.valid_until (date, string)
└── time/zona.ts                 # NUEVO: ZONA_DEL_PRODUCTO (suposición de producto)
src/server/
├── negocio/zona.ts              # NUEVO: zonaDelNegocio(orgId) — agenda o México
├── kb/vigencia.ts               # NUEVO: LA puerta (vigente / completo) + funciones puras + zod
├── agenda/settings.ts           # DEFAULT_TIMEZONE = ZONA_DEL_PRODUCTO
├── ai/
│   ├── pipeline.ts              # lee por la puerta; reloj y separadores siempre; runAgentTurn(id, { ahora })
│   ├── prompts.ts               # AHORA ES siempre + regla del historial
│   └── history.ts               # «anterior» = día ANTES de hoy
├── lab/
│   ├── runner.ts                # conocimiento al started_at; el mismo instante al agente
│   └── generar.ts               # solo lo vigente; motivo kb_vencida
└── dev/ai-mock.ts               # KBTOK: responde según el conocimiento recibido
src/app/api/
├── kb/route.ts                  # GET con estado + hoy; POST con validUntil
├── kb/[id]/route.ts             # PATCH con validUntil (ausente / fecha / null)
├── kb/size/route.ts             # solo lo vigente
└── bot/profile/route.ts         # solo lo vigente
src/components/agent/agent-client.tsx  # fecha en alta y por entrada, por vencer, obsoletos, editar texto
drizzle/0018_kb_vigencia.sql     # ALTER TABLE kb_entry ADD COLUMN valid_until date
tests/unit/
├── kb-vigencia.test.ts          # NUEVO: estados, borde de día en México, puerta con doble de base
├── kb-vigencia-guard.test.ts    # NUEVO: nadie lee kb_entry fuera de la puerta
├── kb-vigencia-rutas.test.ts    # NUEVO: fechaDeVigencia y los esquemas de alta/edición
├── prompt-reloj.test.ts         # NUEVO: AHORA ES y la regla sin agenda; separadores
├── agenda-hoy.test.ts           # + «anterior» = día antes de hoy
├── ai-mock-kb.test.ts           # NUEVO: SI_CONOZCO / NO_CONOZCO; el eco intacto
└── lab-presupuesto.test.ts …    # los existentes, sin romperse
scripts/e2e-kb-vigencia.mjs      # NUEVO: arnés de la 033
package.json                     # + al final de test:e2e
tests/e2e/us-kb-vigencia.md      # NUEVO: guion
CLAUDE.md · README.md            # fila del mapa y párrafo del agente
```

**Structure Decision**: dos módulos nuevos y pequeños. La puerta vive en `server/kb/`
porque es del dominio del conocimiento; la zona en `server/negocio/` porque la usan dos
dominios sin relación (el reloj del prompt y la vigencia) y ninguno debería importar del
otro para saber qué día es. La constante va en `lib/time/` junto a los helpers de zona.

## Complexity Tracking

> Sin violaciones del Constitution Check. La única pieza que podría parecer ceremonia —la
> puerta con su guard en vez de un filtro repetido seis veces— es lo que evita el modo de
> fallo de esta feature.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 — Research

Completada: [research.md](research.md), D-01…D-16. Sin `NEEDS CLARIFICATION` (Q1–Q4
resueltas por el dueño el 2026-10-07).

## Phase 1 — Design & Contracts

- [data-model.md](data-model.md): la columna, los estados, qué viaja a cada superficie.
- [contracts/kb-vigencia.md](contracts/kb-vigencia.md): rutas, turno del agente, ai-mock.
- [quickstart.md](quickstart.md): gate, arnés, rojos a demostrar, ensayo X, instancia de
  pruebas.

## Post-Design Constitution Check

Re-evaluado tras Phase 1: **sin violaciones**. Una columna nullable; sin variables ni
dependencias nuevas; el comportamiento del Laboratorio cambia solo en qué instante usa
(el suyo, compartido por agente y juez).

## Next Step

[tasks.md](tasks.md). Orden: esquema y migración → zona → puerta + guard → lectores →
reloj y regla del historial → Laboratorio → ai-mock → pantalla → arnés → docs → gate,
arnés en las dos configuraciones, rojos demostrados, ensayo X.
