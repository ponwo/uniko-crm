# Tasks — 016 Atribución de anuncios y Conversions API

Rama `016-atribucion-capi`. Agrupadas por historia; lo fundacional primero
porque sin esquema y sin bandera no hay nada que encender ni que probar.
`[P]` = paralelizable (archivos distintos, sin dependencia).

---

## Fase 1 — Fundacional (bloquea todo)

- [x] **T001** `src/lib/db/schema.ts`: tablas `ad_attribution`,
      `conversion_event` y `capi_settings` con sus índices UNIQUE, tal como
      `data-model.md`.
- [x] **T002** `src/lib/db/ids.ts`: prefijos `att`, `cve`, `capi`. [P]
- [x] **T003** `pnpm db:generate` → `drizzle/0010_atribucion_capi.sql` (aditiva,
      re-ejecutable) y su entrada en el journal.
- [x] **T004** `src/server/attribution/flag.ts`: `parseAtribucionFlag`,
      `atribucionEnabled`, `atribucionDisabledResponse` (404 sin cuerpo), con el
      porqué escrito — calco de `server/agenda/flag.ts`.
- [x] **T005** `src/lib/env.ts`: `ATRIBUCION` opcional, documentada inline. [P]
- [x] **T006** `tests/unit/atribucion-flag.test.ts`: valores encendidos,
      apagados y basura. [P]

## Fase 2 — US1: la bandera (P1)

- [x] **T007** `src/app/(app)/settings/layout.tsx` + `components/settings/settings-nav.tsx`:
      pestaña "Anuncios" solo con la bandera encendida (patrón `agenda`).
- [x] **T008** `src/app/(app)/settings/ads/page.tsx`: `notFound()` sin bandera.
- [x] **T009** Guardia de bandera como primera línea de cada handler de API
      (patrón de la agenda: 404 en cuanto hay sesión).

## Fase 3 — US2: conectar el dataset (P1)

- [x] **T010** `src/server/attribution/settings.ts`: `getCapiSettings` (descifra),
      `saveCapiSettings` (upsert cifrado), `deleteCapiSettings`,
      `getCapiSettingsView` (lo que ve el cliente: `last4`, nunca el token).
- [x] **T011** `src/app/api/settings/capi/route.ts`: `GET` / `PUT` / `DELETE` con
      Zod; sin token reusa el de `metaCredentials` (`409 sin_whatsapp`);
      `qualifiedStageId` validado contra las etapas de la organización
      (`422 etapa_invalida`).
- [x] **T012** `src/components/settings/ads-client.tsx`: formulario (dataset,
      token opcional con ayuda, selector de etapa), estado conectado con
      `last4`, botón desconectar.

## Fase 4 — US3: capturar el anuncio (P1)

- [x] **T013** `src/server/inbox/webhook.ts`: tipo `WebhookReferral` y
      `referral?` en el mensaje entrante. [P]
- [x] **T014** `src/server/attribution/store.ts`: `recordAttribution`
      (`ON CONFLICT DO NOTHING` por org+conversación) y
      `getAttributionForConversation`.
- [x] **T015** `src/server/inbox/ingest.ts`: pasar el `referral` y capturarlo
      **antes** del dedup del mensaje, solo con la bandera encendida.
- [x] **T016** Mock de inbound (`wa-mock/inbound` + `server/dev/wa-mock-inbound.ts`):
      campos `ctwaClid` / `adHeadline` / `adSourceId` para simular un anuncio.

## Fase 5 — US4/US5: reportar (P1)

- [x] **T017** `src/lib/meta/capi.ts`: catálogo cerrado, `buildEventPayload`
      (`action_source`, `messaging_channel`, `user_data`, `custom_data`,
      `partner_agent: "uniko-crm"`), `sendBusinessMessagingEvent` con la regla
      `events_received >= 1`.
- [x] **T018** `src/server/attribution/conversions.ts`: `emitConversion`
      (dedup por UNIQUE, `skipped` con motivo, `failed` con el error de Meta,
      `sent` con `fbtrace_id`), guardia `is_test`, best-effort absoluto.
- [x] **T019** `purchaseCustomDataFromAmount` (centavos → unidades; sin monto,
      sin `value`) y la resolución del monto del lead. [P]
- [x] **T020** `src/server/leads/stage-history.ts`: tras el commit, si la etapa
      destino es la calificada → `QualifiedLead`; si su `kind` es `won` →
      `Purchase`. Fuera de la transacción y envuelto.
- [x] **T021** Mock de Graph: `POST {dataset}/events` — valida catálogo y
      `ctwa_clid`, responde `events_received`/`fbtrace_id`, y simula el 200
      mentiroso con datasets `-fail`.
- [x] **T022** `tests/unit/capi-payload.test.ts`: forma exacta del payload,
      catálogo, merge de `custom_data`, y el rechazo por `events_received: 0`. [P]
- [x] **T023** `tests/unit/conversions.test.ts`: centavos→unidades, sin monto,
      y la traducción de fila de actividad. [P]

## Fase 6 — US6: ver qué se reportó (P2)

- [x] **T024** `listConversionActivity` con tope duro (25/50) + titular del
      anuncio por join.
- [x] **T025** `src/app/api/settings/capi/events/route.ts`.
- [x] **T026** Tabla de actividad en la pantalla: estado en palabras, motivo del
      fallo/omisión, `fbtrace_id` y refresco manual.

## Fase 7 — Cierre

- [x] **T027** `tests/e2e/us-atribucion.md`: el guion de la historia.
- [x] **T028** `scripts/e2e-selftest.mjs`: sección nueva — apagada (404 + sin
      captura) y encendida (configurar, capturar, calificar, ganar, dedup, sin
      anuncio, Meta rechazando).
- [x] **T029** `docs/atribucion-capi.md`: guía del dueño — qué es el dataset, de
      dónde sale, los gotchas de Meta y la receta del espejo de venta para quien
      la necesite. [P]
- [x] **T030** `README.md` + `.env.example` + `CLAUDE.md`: la feature opcional,
      la variable y la fila del mapa de código. [P]
- [x] **T031** Gate técnico completo y arnés en las **dos** configuraciones.

---

## Verificación (2026-08-28)

Gate técnico: `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test`
(**371 unit**, 22 de esta feature) — todo en verde.

Arnés E2E contra la app viva con mocks, en las **dos** configuraciones y con
base nueva por ronda:

| Configuración | Resultado |
|---|---|
| `ATRIBUCION=on` | **120/120 checks** |
| sin la bandera | **103/103 checks** (incluidos los 6 que prueban que no existe) |

Comprobado además contra la base, que es donde vive la promesa de ADR-001: con
la bandera apagada, tras un inbound CON anuncio, `ad_attribution` y
`conversion_event` quedan en **0 filas**. Con la bandera encendida, las cuatro
filas esperadas: `QualifiedLead` enviada con acuse, `Purchase` enviada,
una omitida (lead sin anuncio) y una fallida (Meta descartando con
`events_received: 0`).

La migración `0010` se aplicó dos veces seguidas sobre la misma base sin error
(solo avisos de "ya existe"): re-ejecutable como exige la Constitución IV.

---

## Enmienda 2026-10-09 — «Obtener de Meta» (FR-017, FR-018)

Origen: en ILTU se tecleó el ID del dataset y se guardaron el de la cuenta, el
del número y otro conjunto del portafolio; las ventas fallaron en Meta. Ver la
sección «Enmienda» de la spec. Sin migración.

- [x] **T032** `obtainWabaDataset` en `src/lib/meta/capi.ts`: `POST {waba}/dataset`
      por la frontera única (`graphRequest`), exige un ID numérico en la respuesta.
- [x] **T033** `datasetFromMeta` en `src/server/attribution/settings.ts`: cuenta y
      token de WhatsApp ya conectados, tope de 20 s, errores traducidos
      (`sin_whatsapp` 409 · `meta_rechazo` 422 con el motivo de Meta ·
      `meta_no_disponible` 503 · `meta_respuesta_inesperada` 502). No guarda.
- [x] **T034** `POST /api/settings/capi/dataset` (404 sin la bandera).
- [x] **T035** `datasetIdProblem` + `422 dataset_invalido` en el `PUT`: no
      numérico, el ID de la cuenta o el del número.
- [x] **T036** Pantalla: botón «Obtener de Meta» junto a "ID del dataset"; coloca
      el ID, dice de dónde salió y si difiere del guardado; el aviso se retira si
      se edita el campo; el error de Meta se ve tal cual. Ayuda corregida.
- [x] **T037** wa-mock: `POST {waba}/dataset` idempotente por WABA; los WABA
      `…-sin-permiso` reproducen el rechazo por permiso. Datasets del arnés
      numéricos (los que terminan en `0000` descartan eventos).
- [x] **T038** Pruebas: unitarias (`tests/unit/capi-settings.test.ts`), sección
      016 del self-test (obtener, idempotencia, no guarda, rechazos, 404 sin la
      bandera) y `scripts/e2e-dataset-desde-meta.mjs` en el navegador (en la
      cadena `test:e2e`).
- [x] **T039** Contrato `settings-capi.md`, guía, README, `CLAUDE.md` y guion
      `tests/e2e/us-atribucion.md`.

### Verificación (2026-10-09)

Gate técnico: `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test`
(**1050 unit**) — en verde.

Arnés E2E contra la app viva con mocks, base nueva por configuración:

| Configuración | `e2e-selftest.mjs` | `e2e-dataset-desde-meta.mjs` |
|---|---|---|
| `ATRIBUCION=on` | **213/213** | **20/20** |
| sin la bandera | **190/190** (la ruta nueva da 404) | **2/2** (ruta y pantalla, 404) |
