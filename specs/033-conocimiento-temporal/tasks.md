---
description: "Tareas de la 033 — Conocimiento temporal: vigencia del conocimiento y reloj del agente"
---

# Tasks: 033 — Conocimiento temporal

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/kb-vigencia.md](contracts/kb-vigencia.md) ·
[quickstart.md](quickstart.md)

**Tests**: SÍ (Principios V y IX, FR-1852/FR-1853). Los de cada historia se escriben
primero y deben fallar antes de implementar. Tres rojos se demuestran a propósito
(quickstart §3).

**Organización**: fundación (esquema, zona, puerta + guard) y luego por historia: US1 (lo
vencido no se afirma), US2 (reloj y regla del historial), US3 (pantalla del dueño), US4
(Laboratorio). Cierre: simulador, arnés, docs, verificación y ensayo X.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- Rutas desde la raíz del repositorio

---

## Phase 1: Fundación

- [ ] T001 `src/lib/db/schema.ts`: `kb_entry.valid_until` = `date("valid_until", { mode: "string" })`, nullable, con comentario (D-02, D-09); importar `date` de `drizzle-orm/pg-core`.
- [ ] T002 Generar la migración `drizzle/0018_kb_vigencia.sql` con `pnpm db:generate` (debe ser solo `ADD COLUMN "valid_until" date`) y revisar el snapshot.
- [ ] T003 [P] `src/lib/time/zona.ts`: `ZONA_DEL_PRODUCTO = "America/Mexico_City"` con la suposición de producto documentada; `src/server/agenda/settings.ts`: `DEFAULT_TIMEZONE = ZONA_DEL_PRODUCTO`.
- [ ] T004 `src/server/negocio/zona.ts`: `zonaDelNegocio(organizationId)` → zona de la agenda con `AGENDA` encendida; si no, `ZONA_DEL_PRODUCTO` sin consultar nada (D-05).
- [ ] T005 Tests primero — `tests/unit/kb-vigencia.test.ts`: `estadoDeVigencia` (null, futuro lejano, 14 días, hoy, ayer), `soloVigentes`, `hoyDelNegocio` en el borde de las 18:30 de México (00:30 UTC del día siguiente), la puerta con el doble de base que ignora el `where` (vigente filtra; completo trae todo con estado), `zonaDelNegocio` con y sin `AGENDA`.
- [ ] T006 Tests primero — `tests/unit/kb-vigencia-guard.test.ts`: escanea `src/` y falla si `from(schema.kbEntry)`, `from(kbEntry)` o `query.kbEntry` aparece fuera de `src/server/kb/vigencia.ts`; y un caso que demuestra que la puerta sí contiene el patrón.
- [ ] T007 `src/server/kb/vigencia.ts`: la puerta (`conocimientoVigente`, `conocimientoCompleto`), funciones puras (`estadoDeVigencia`, `soloVigentes`, `hoyDelNegocio`), `DIAS_AVISO_VENCIMIENTO = 14`, `fechaDeVigencia` (zod con ida y vuelta, D-15).

## Phase 2: US1 — El dato vencido deja de afirmarse (P1)

- [ ] T010 [US1] `src/server/ai/pipeline.ts`: el conocimiento sale de `conocimientoVigente(organizationId, ahora)`.
- [ ] T011 [P] [US1] `src/app/api/bot/profile/route.ts`: `conocimientoVigente`.
- [ ] T012 [P] [US1] `src/app/api/kb/size/route.ts`: `conocimientoVigente`.
- [ ] T013 [US1] Correr `kb-vigencia-guard.test.ts`: los seis lectores fuera de la puerta tienen que dejar de aparecer conforme se migran (al final de US4, verde).

## Phase 3: US2 — Reloj y regla del historial (P1)

- [ ] T020 Tests primero — `tests/unit/prompt-reloj.test.ts`: sin agenda, `AHORA ES:` en el prompt con «del historial y del conocimiento»; la regla del historial está con y sin agenda; `agenda-hoy.test.ts`: un mensaje posterior a `now` cuenta como de hoy.
- [ ] T021 [US2] `src/server/ai/prompts.ts`: la línea de la fecha menciona el conocimiento; regla dura nueva del historial (FR-1822), siempre.
- [ ] T022 [US2] `src/server/ai/pipeline.ts`: `tz = await zonaDelNegocio(org)` siempre; `AHORA ES` y `withDayMarkers` siempre; reescribir el comentario de la 015 apuntando a D-05; `runAgentTurn(id, opts?: { ahora?: Date })`.
- [ ] T023 [US2] `src/server/ai/history.ts`: «anterior» = día estrictamente antes de hoy (D-11).

## Phase 4: US3 — El dueño ve lo obsoleto, lo renueva y lo corrige (P2)

- [ ] T030 Tests primero — `tests/unit/kb-vigencia-rutas.test.ts`: los esquemas de alta y edición aceptan fecha/null/ausente, rechazan «el martes» y «2026-02-31» con el mensaje esperado y sin lanzar.
- [ ] T031 [US3] `src/app/api/kb/route.ts`: `GET` por `conocimientoCompleto` (+ `hoy`); `POST` con `validUntil`; respuesta con `estado`.
- [ ] T032 [US3] `src/app/api/kb/[id]/route.ts`: `PATCH` con `validUntil` (ausente / fecha / `null`) sin tocar el texto; respuesta con `estado`.
- [ ] T033 [US3] `src/components/agent/agent-client.tsx`: fecha opcional en el alta con su explicación; por entrada: fecha editable, «Hacer permanente», marca «Vence pronto · sigue activa»; aviso de cuántas por vencer; sección «Conocimiento obsoleto» solo si hay; aviso de «todo vencido»; **editar el texto** (Editar → Guardar/Cancelar).

## Phase 5: US4 — El Laboratorio ensaya contra el mismo mundo (P2)

- [ ] T040 [US4] `src/server/lab/runner.ts`: `startRun` toma el `startedAt` del insert; `runAllCases` resuelve `conocimientoVigente(org, startedAt)` una vez para el juez y pasa `{ ahora: startedAt }` a cada `runAgentTurn`.
- [ ] T041 [US4] `src/server/lab/generar.ts`: `conocimientoVigente`; motivo `kb_vencida` si hay entradas pero ninguna vigente.
- [ ] T042 [US4] Guard en verde: ningún lector fuera de la puerta.

## Phase 6: Simulador, arnés y documentación

- [ ] T050 Tests primero — `tests/unit/ai-mock-kb.test.ts`: `KBTOK` presente/ausente en el conocimiento → `SI_CONOZCO`/`NO_CONOZCO`; un token solo en el historial no cuenta; sin token, el eco de siempre.
- [ ] T051 `src/server/dev/ai-mock.ts`: rama `KBTOK` (D-13), antes del eco y después de juez/generador.
- [ ] T052 `scripts/e2e-kb-vigencia.mjs`: el arnés de quickstart §2 (API, agente por wa-mock, Laboratorio, pantalla con Playwright), con limpieza de sus entradas al terminar; `package.json`: al final de `test:e2e`.
- [ ] T053 [P] `tests/e2e/us-kb-vigencia.md`: guion de la historia.
- [ ] T054 [P] `CLAUDE.md` (fila del mapa: la vigencia del conocimiento) y `README.md` (párrafo del agente: vigencia y fecha).

## Phase 7: Verificación

- [ ] T060 Gate: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`, también con `AGENDA=on CHANNELS=… INVENTARIO=on …` (configuración `completo`).
- [ ] T061 Rojos demostrados (quickstart §3): guard, corte en UTC, lector sin filtro.
- [ ] T062 Arnés en vivo: `e2e-kb-vigencia.mjs` verde en base fresca, sin agenda y con agenda; `e2e-selftest.mjs` y `e2e-lab.mjs` siguen verdes.
- [ ] T063 Ensayo X (quickstart §4) con los respaldos de ILTU y NuriaAndrea; registrar el resultado en el PR.
- [ ] T064 PR con plan de reversión, aviso del cambio observable en `/api/bot/profile` y lo pendiente en la instancia de pruebas.
