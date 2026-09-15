# Tareas — 027 Plantillas: espejo de Meta y errores con causa

Orden de dependencias. `[P]` = puede ir en paralelo con las vecinas.

## Fase 1 — Modelo y cliente Graph

- [ ] T001 `src/lib/db/schema.ts`: `metaStatus`, `missingSince`, `components`
      (jsonb) en `template`.
- [ ] T002 `drizzle/0015_plantillas_espejo_de_meta.sql` + journal/snapshot
      (`pnpm db:generate --name plantillas_espejo_de_meta`) con el backfill.
- [ ] T003 [P] `src/lib/meta/client.ts`: `MetaApiError` con `subcode`,
      `userTitle`, `userMsg`, `detail`, `explanation`; `graphRequest` los lee.
- [ ] T004 [P] `src/lib/meta/template-errors.ts`: `describeTemplateError`,
      `esNombreDuplicado`.

## Fase 2 — Reglas compartidas

- [ ] T005 `src/lib/templates.ts`: `normalizeBody`, reglas de inicio/fin y
      variables pegadas en `validateBodyVariables`, `esEnviable`,
      `bloqueoDeMeta`, `analizarComponentes`.
- [ ] T006 `src/lib/types.ts`: `TemplateDto` con `metaStatus`, `missingSince`,
      `components`.

## Fase 3 — Servicio

- [ ] T007 `syncTemplates`: paginación por cursor, `fields` explícitos,
      emparejamiento en dos pasadas, import/update/missing, `ResumenDeSync`.
- [ ] T008 `createTemplate`: normalización, `allow_category_change`, respuesta
      de Meta guardada, traducción del error, log sin token, duplicado ⇒ sync
      + 409.
- [ ] T009 `applyTemplateStatusEvent`: `meta_status` siempre.
- [ ] T010 `sendTemplate`: bloqueos por ausencia, Meta y componentes.
- [ ] T011 `POST /api/templates/sync` devuelve el resumen; `POST /api/templates`
      mapea el 409.

## Fase 4 — UI

- [ ] T012 `templates-client.tsx`: resumen, error visible, insignias,
      explicaciones, componentes.
- [ ] T013 [P] `template-sender.tsx`, `start-conversation.tsx`, `composer.tsx`:
      `esEnviable`.

## Fase 5 — Mock y arnés

- [ ] T014 `wa-mock-state.ts`: plantillas por WABA, ids con sello, estados
      libres, `nextTemplateId`.
- [ ] T015 `graph/[...path]/route.ts`: `fields` validados, paginación, rechazos
      síncronos al crear.
- [ ] T016 `seed-templates/route.ts` nuevo; `template-status` con `event` libre.
- [ ] T017 `scripts/e2e-templates-sync.mjs`: escenarios 1–9 de la spec; entra
      en `pnpm test:e2e`.
- [ ] T018 Unit: `tests/unit/templates.test.ts` (reglas nuevas, `esEnviable`,
      `bloqueoDeMeta`, `analizarComponentes`), `tests/unit/meta-client.test.ts`
      (`explanation`), `tests/unit/template-errors.test.ts`.

## Fase 6 — Verificación y cierre

- [ ] T019 Gate: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] T020 Arnés: `e2e-templates-sync.mjs`, `e2e-templates-multivar.mjs`,
      `e2e-selftest.mjs` en verde contra `pnpm dev` con mocks.
- [ ] T021 Ensayo del Principio X contra un respaldo real restaurado
      (registrar en quickstart).
- [ ] T022 Docs: `tests/e2e/us6-templates.md`, `specs/README.md`, memoria.
- [ ] T023 En vivo (tras merge a `main` → uniko-lanco): sync importa lo que
      hay en el WABA de LanCo; crear una plantilla real desde la pantalla y
      leer la respuesta de Meta con causa. Registrar en quickstart.
