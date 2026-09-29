---
description: "Tareas de la 029 — Conexión de Google Calendar por link (modelo agencia)"
---

# Tasks: Conexión de Google Calendar por link (modelo agencia)

**Input**: `specs/029-google-por-link/` — [spec.md](spec.md), [plan.md](plan.md),
[research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md)

**Tests**: SÍ. La Definición de Hecho del proyecto exige unitarios y el self-test de
comportamiento de punta a punta (arnés), con camino infeliz.

**Organización**: por historia de usuario. `[P]` = archivo distinto y sin dependencia
de una tarea incompleta. Rutas relativas a la raíz de Uniko salvo las marcadas
`lanco-ws:` (repo `C:\G\gApps\LanCo\LanCo-SitioWeb\LanCo-Conect-Coex`).

---

## Phase 1: Setup (configuración compartida)

- [X] T001 Declarar `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_ONBOARDING_URL` (sin barra final) y `GOOGLE_AUTH_URL` (default `https://accounts.google.com/o/oauth2/v2/auth`) con su comentario en `src/lib/env.ts`, y el `superRefine`: con `AGENDA` encendida, todo o nada de las tres `GOOGLE_OAUTH_*` (el error nombra la que falta) y redirección `https:` salvo `http://localhost`
- [X] T002 [P] Documentar las cinco variables con guía inline (qué son, de dónde salen, valores de LanCo y de self-hoster) en `.env.example`
- [X] T003 [P] Añadir el prefijo `googleLink: "glink"` en `src/lib/db/ids.ts`
- [X] T004 [P] Añadir las tres `GOOGLE_OAUTH_*` y `GOOGLE_AUTH_URL` (apuntando a los mocks) a la configuración `completo` de la matriz en `.github/workflows/ci.yml`

---

## Phase 2: Foundational (lo que bloquea a todas las historias)

- [X] T005 Definir la tabla `googleLink` (data-model.md: FK a `organization` cascade, a `user` set null, UNIQUE `token_hash`, índice por organización) en `src/lib/db/schema.ts`
- [X] T006 Generar la migración con `pnpm db:generate --name google_link` y revisar que sea solo aditiva en `drizzle/0016_google_link.sql` (+ `drizzle/meta/`)
- [X] T007 [P] Extraer `googleCredentialValues(input)` (valores cifrados del upsert) y reutilizarlo en `saveGoogleCredentials` en `src/server/agenda/connectors/google-credentials.ts`
- [X] T008 [P] Añadir `exchangeAuthorizationCode({ clientId, clientSecret, redirectUri, code })` con `ConnectorError` tipado (auth vs. red/5xx), y `fields=summary` en la prueba de conexión, en `src/server/agenda/connectors/google.ts`
- [X] T009 Implementar el registro de links —`issueGoogleLink`, `revokeGoogleLinks`, `pendingGoogleLink`, `checkGoogleLink`, `consumeLinkAndSaveCredentials` (transacción; si no consume, relee la fila para distinguir usado de revocado)— con toda query por `scoped()`, reloj inyectado y cortes de tiempo en código en `src/server/agenda/connectors/google-link.ts`
- [X] T010 [P] Catálogo cerrado de motivos y sus textos (sin código de servidor) en `src/lib/google-link-motivos.ts`
- [X] T011 Implementar `googleLinkAvailable`, `googleAgencyConfig`, `buildGoogleLinkUrl`, `signOAuthState`/`verifyOAuthState` (HS256 + HKDF de `BETTER_AUTH_SECRET`, `ret`/`sub`/`lnk`/`nh`, 15 min, `currentDate` inyectable) y `buildGoogleAuthUrl` en `src/server/agenda/connectors/google-oauth.ts`
- [X] T012 [P] Estado del mock: códigos de autorización de un solo uso atados a `client_id` + `redirect_uri` + decisión, contadores para `_state`, y su `_reset` en `src/server/dev/google-mock-state.ts`
- [X] T013 Mock de Google: `GET auth` (valida parámetros; `mock_decision=approve|deny|partial|no_refresh|policy|exchange_down`) y `grant_type=authorization_code` en `/token` sin romper el refresco en `src/app/api/dev/google-mock/[...path]/route.ts`
- [X] T014 [P] Mock del relevo con el algoritmo del contrato §3 (lista = host de `APP_BASE_URL`, 302) tras `mockGuard()` en `src/app/api/dev/lanco-relay-mock/route.ts`
- [X] T015 [P] Unitarios del registro (generar revoca pendientes, huella y no llave, vencido/usado/revocado decididos con reloj falso, consumir devuelve false en la segunda vez) en `tests/unit/google-link.test.ts`

**Checkpoint**: base de datos, adaptador, firma y mocks listos.

---

## Phase 3: User Story 1 — El titular conecta su calendario con un link (P1) 🎯 MVP

**Goal**: generar un link como dueño y recorrerlo sin sesión hasta quedar conectado.

**Independent Test**: arnés — link → `start` → mock de Google → mock del relevo →
`callback` → `/conectar-google?estado=ok`; conexión guardada con el cliente de la
agencia, "Probar" pasa, conector `google`, una cita crea su evento.

- [X] T016 [US1] Implementar `completeGoogleOAuth(query, { cookieNonce, now, deps })` —camino feliz: verificar `state` y cookie, canje, `scope`, refresh token, prueba, consumir+guardar conservando el calendario destino previo (o `primary`), conector a `google`— con dependencias inyectables en `src/server/agenda/connectors/google-oauth.ts`
- [X] T017 [P] [US1] `GET`/`POST` del link (`withAuth`, 404 si no disponible, POST solo `owner` → 403) devolviendo la URL una sola vez en `src/app/api/settings/google/link/route.ts`
- [X] T018 [P] [US1] Ruta pública de inicio: validar link, cookie del nonce (`HttpOnly`, `SameSite=Lax`, ruta `/api/google/oauth`, 15 min, `Secure` en HTTPS) y 302 a Google o a `/conectar-google` en `src/app/api/google/oauth/start/route.ts`
- [X] T019 [P] [US1] Ruta pública de retorno: `completeGoogleOAuth`, borrar cookie del nonce, cookie del calendario en `ok`, 302 sobre `APP_BASE_URL`, nunca 500 hacia el titular en `src/app/api/google/oauth/callback/route.ts`
- [X] T020 [P] [US1] Página pública de resultado (404 si no disponible, catálogo cerrado, marca de la instancia, nombre del calendario desde la cookie) en `src/app/conectar-google/page.tsx`
- [X] T021 [US1] Sección del link (generar, copiar, vencimiento, pendiente, revocar, deshabilitada sin `canManage`) en `src/components/settings/google-link-section.tsx`
- [X] T022 [US1] Integrar la sección arriba de los campos manuales de Google y mostrar el nombre del calendario en "Probar" en `src/components/settings/connector-credentials.tsx`
- [X] T023 [P] [US1] Unitarios del flujo feliz y de la firma (`state` válido, `ret` = origen, URL de Google con los parámetros de D6, forma del link con y sin página de aterrizaje, calendario destino previo conservado) en `tests/unit/google-oauth.test.ts`
- [X] T024 [US1] Bloque "029" del arnés, camino feliz de punta a punta (incluida la cita que crea su evento) con estas aserciones: ninguna respuesta contiene el secreto de la agencia ni el refresh token (FR-1403, SC-002); ningún `Location` lleva el nombre del calendario (FR-1421); crear la cita no incrementa el contador del mock del relevo (SC-004); `/conectar-google?estado=<script>` muestra el genérico sin eco (FR-1420) en `scripts/e2e-selftest.mjs`

**Checkpoint**: MVP — un link conecta Google de punta a punta contra los mocks.

---

## Phase 4: User Story 2 — Si algo sale mal, nada se rompe (P1)

**Goal**: cada camino infeliz termina en su motivo, sin tocar la conexión previa.

**Independent Test**: arnés con una conexión previa guardada; cada decisión del mock
termina en su `estado` y la conexión previa sigue intacta.

- [X] T025 [US2] Completar las ramas infelices de `completeGoogleOAuth` —`otro_navegador`, `link_invalido`, `cancelado`, `politica_empresa`, `google_rechazo`, `link_usado`, `google_no_respondio`, `permiso_incompleto`, `prueba_fallida`— y la red de seguridad de excepciones en `src/server/agenda/connectors/google-oauth.ts`
- [X] T026 [P] [US2] Unitarios: un caso por motivo, y en ninguno se llama a guardar; `state` manipulado, vencido (reloj falso a +16 min) y sin cookie en `tests/unit/google-oauth.test.ts`
- [X] T027 [US2] Arnés: cancelar (y el link sigue sirviendo), permiso incompleto, política de empresa, canje caído, sin refresh token, sin cookie, `state` manipulado, link reusado — con la conexión previa intacta tras cada uno — en `scripts/e2e-selftest.mjs`

---

## Phase 5: User Story 3 — El operador controla sus links (P2)

**Goal**: a lo sumo un link vigente, revocable, visible sin revelar la llave, solo el dueño.

**Independent Test**: generar dos veces, revocar, y comprobar que solo el último sin
revocar funciona; un miembro recibe 403.

- [X] T028 [US3] `DELETE` del link (solo `owner`) en `src/app/api/settings/google/link/route.ts`
- [X] T029 [US3] Arnés: regenerar invalida el anterior (`link_invalido`), revocar a mano, pendiente sin la llave en el `GET`, y un miembro no dueño recibe 403 en `scripts/e2e-selftest.mjs`
- [X] T030 [US3] Arnés: un link usado sigue `link_usado` después de desconectar Google (FR-1409) en `scripts/e2e-selftest.mjs`

---

## Phase 6: User Story 4 — `lanco.cloud` reenvía sin guardar nada (P2)

**Goal**: aterrizaje + relevo estáticos, con lista de la flota; página de la app y
cláusula de privacidad para la verificación.

**Independent Test**: `npm run build` + recorrido en navegador (quickstart §5); el
arnés prueba que el relevo de pruebas se niega a reenviar fuera de su lista.

- [X] T031 [P] [US4] Lista de la flota (`uniko.lanco.cloud`, `uniko.ilovetheuniverse.mx`, `uniko.nuriaandrea.com` con su nombre visible) en `lanco-ws: data/flota.ts`
- [X] T032 [P] [US4] Funciones puras: leer `i`/`t`, decodificar `ret` del `state`, validar origen (https, origen pelado, en la lista), construir URLs de inicio y de retorno, detectar navegador embebido en `lanco-ws: modules/googleCalendar.ts`
- [X] T033 [US4] Aterrizaje y página de la app «LanCo Agenda» (sin parámetros), aviso de app sin verificar, navegador embebido con copiar, `noindex` y `no-referrer` en `lanco-ws: pages/GoogleCalendar.tsx`
- [X] T034 [US4] Relevo: `location.replace` al retorno de la instancia o error sin redirigir, `noindex` y `no-referrer` en `lanco-ws: pages/GoogleCalendarCallback.tsx`
- [X] T035 [US4] Rutas `/google-calendar` y `/google-calendar/callback` fuera del layout en `lanco-ws: App.tsx`
- [X] T036 [P] [US4] Sección "Datos de Google (LanCo Agenda)" con la declaración de uso limitado en la política de privacidad en `lanco-ws: data/legalData.ts`
- [X] T037 [P] [US4] Rutas nuevas en `lanco-ws: README.md`
- [X] T038 [US4] Arnés: el mock del relevo se niega (no redirige) ante un `ret` fuera de la lista, `http:` o con ruta en `scripts/e2e-selftest.mjs`

---

## Phase 7: User Story 5 — Una instancia sin la app de agencia no cambia (P2)

**Goal**: sin configuración, todo como antes; con ella, el camino manual intacto.

**Independent Test**: CI "default" y "completo"; arnés con `AGENDA` encendida sin
`GOOGLE_OAUTH_*` → las cuatro superficies en 404.

- [X] T039 [P] [US5] Unitarios del entorno: apagada no exige nada; con `AGENDA` encendida una o dos de tres impiden arrancar nombrando la que falta; redirección `http:` no local rechazada; completas arrancan en `tests/unit/google-env.test.ts`
- [X] T040 [US5] Arnés: sin app de agencia (o sin agenda), `GET/POST /api/settings/google/link`, `/api/google/oauth/start`, `/api/google/oauth/callback` y `/conectar-google` responden 404; el `PUT` manual sigue igual en `scripts/e2e-selftest.mjs`

---

## Phase 8: User Story 6 — Self-hoster con su propia app, sin relevo (P3)

**Goal**: el mismo link con el retorno directo a la instancia.

**Independent Test**: unitario de la forma del link sin página de aterrizaje; el
`callback` es el mismo código.

- [X] T041 [US6] Unitario: sin `GOOGLE_ONBOARDING_URL` el link es `{APP_BASE_URL}/api/google/oauth/start?t=…` y el retorno directo se acepta igual en `tests/unit/google-oauth.test.ts`
- [X] T042 [US6] Sección "Self-hoster: tu propia app con el mismo link" en `docs/agenda-conectores.md`

---

## Phase 9: Polish & Cross-Cutting

- [X] T043 [P] Guía del operador: preparación única del proyecto (renombrar, URLs, dominio, publicar sin logo), alta por negocio, verificación (Search Console por DNS en Cloudflare, video con consentimiento en inglés, justificación), rotación, baja y diagnóstico en `docs/google-agencia.md`
- [X] T044 [P] Sección "Conexión por link (modelo agencia)" y recuadro de condiciones remitiendo a la 4 enmendada en `docs/agenda-conectores.md`
- [X] T045 [P] Guion E2E de la historia en `tests/e2e/us-google-por-link.md`
- [X] T046 Aplicar la enmienda 1.8.0 (II.3.4 + Sync Impact Report + versión) en `.specify/memory/constitution.md`
- [X] T047 [P] Mapa (fila de la conexión por link) y resumen del Principio II con el modelo agencia en `CLAUDE.md`
- [X] T048 [P] Fila de la 029 en `specs/README.md`
- [X] T049 Gate técnico completo (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`) desde `C:\G\gApps\LanCo\Uniko-CRM`
- [X] T050 Arnés completo en base desechable con los mocks (quickstart §1–§3) y en la configuración sin app de agencia, más el recorrido en el navegador de vista previa de la sección de Ajustes (generar, copiar, revocar) y de la página de resultado (FR-1422, Principio IX); registrar resultados en `specs/029-google-por-link/quickstart.md`
- [X] T051 `lanco-ws`: `npm run build` y recorrido en navegador (quickstart §5); rama y PR en `github.com/ponwo/lanco-ws`
- [X] T052 Ensayo del Principio X contra un respaldo real restaurado (quickstart §4) y registro en `specs/029-google-por-link/quickstart.md` — **fuera de orden**: la #42 se mergeó antes (2026-09-28) y la `0016` ya corrió limpia en uniko-lanco. Hecho el 2026-09-29 contra los respaldos de los dos clientes (ILTU y NuriaAndrea): aditiva medida, 0 filas tocadas, la app de `main` arrancó contra las dos copias
- [X] T053 PR de Uniko con plan de reversión, enmienda a ratificar y checklist de verificación en vivo (quickstart §6)
- [X] T054 Verificación en vivo en uniko-lanco con el dueño (quickstart §6) y registro en `specs/029-google-por-link/quickstart.md`

---

## Phase 10: Permiso `calendar.events.owned` (revisión 2026-09-28, research D6)

**Goal**: la app de la agencia pide el permiso más estrecho que sirve, para que la
verificación de Google no pregunte por qué no basta uno menor.

**Independent Test**: el arnés ve `calendar.events.owned` en la autorización, y un
calendario destino conservado que no es de quien autoriza termina en
`prueba_fallida` sin tocar la conexión previa.

- [X] T055 `GOOGLE_SCOPE` = `calendar.events.owned` y `grantCoversCalendar()` (vale `.owned` o `calendar.events`, comparación exacta) en `src/server/agenda/connectors/google.ts`; la comprobación del `scope` y la pista del log para un destino que no es `primary` (sin el id) en `src/server/agenda/connectors/google-oauth.ts`
- [X] T056 [P] Mock: cada acceso lleva su permiso y el calendario compartido `MOCK_FOREIGN_CALENDAR` responde 403 al de `.owned` en `src/app/api/dev/google-mock/[...path]/route.ts` y `src/server/dev/google-mock-state.ts`
- [X] T057 [P] Unitarios: concesión de `calendar.events` aceptada, `.owned.readonly` → `permiso_incompleto`, log de destino ajeno sin el id en `tests/unit/google-oauth.test.ts`; canje con `.owned` en `tests/unit/connectors.test.ts`
- [X] T058 Arnés: el permiso pedido y el caso del calendario ajeno en `scripts/e2e-selftest.mjs`; guion en `tests/e2e/us-google-por-link.md`
- [X] T059 [P] Texto de `permiso_incompleto` en `src/lib/google-link-motivos.ts`; guía del operador (permiso, logo, contacto, problema frecuente, §5 reescrita con orden, video y justificación) en `docs/google-agencia.md`; `docs/agenda-conectores.md`; research D6/D7, `contracts/api.md`, `plan.md`
- [X] T060 Gate técnico completo y arnés completo con los mocks; registro en `specs/029-google-por-link/quickstart.md`
- [X] T061 PR de Uniko; tras el merge (señal del dueño), verificación en vivo en uniko-lanco (quickstart §6.1): link nuevo, la pantalla de Google con el permiso nuevo, «Probar», y una cita con Meet creada, movida y cancelada — ponwo/uniko-crm#45; verificada el 2026-09-28 (la pantalla de Google queda para el video)
- [X] T062 `lanco-ws` (sesión aparte): textos del permiso en `pages/GoogleCalendar.tsx` y sección 9 de la privacidad, junto con la página de la app prerenderizada — feature 004 de `lanco-ws`, ponwo/lanco-ws#4 (`9a0519a`), verificada en producción el 2026-09-28 (quickstart §5)

---

## Phase 11: Abrir el link desde la pantalla (revisión 2026-09-29, FR-1429)

**Goal**: quien tiene el calendario y está frente a *Ajustes* lo conecta sin copiar el
link a otro navegador, sabiendo que lo lleva a `lanco.cloud`; al volver, la pantalla
ya refleja la conexión.

**Independent Test**: arnés — el `GET` del link dice cuándo se usó el más reciente y
no toma un revocado por usado; navegador de vista previa — generar → *Conectar mi
calendario* abre otra pestaña que termina en «conectado» → de vuelta, la sección lo
dice y la tarjeta muestra la conexión nueva.

- [X] T063 `linkStatusFor` (pura) y `googleLinkStatus` en lugar de `pendingGoogleLink` en `src/server/agenda/connectors/google-link.ts`; `usedAt` en el `GET` de `src/app/api/settings/google/link/route.ts`
- [X] T064 [P] Unitarios de `linkStatusFor` (sin links, pendiente, usado aunque vencido, revocado o vencido sin usar) en `tests/unit/google-link.test.ts`
- [X] T065 *Conectar mi calendario*: enlace a otra pestaña (`noopener noreferrer`) con el aviso del sitio al que lleva; al volver a la pestaña con el link a la vista, usado → lo dice y la tarjeta relee la conexión, dejó de servir → lo dice; «Último link: usado el…» (y sin «p.m..» en el del link pendiente) en `src/components/settings/google-link-section.tsx`; `loadConnection` reutilizable en `src/components/settings/connector-credentials.tsx`; `buttonVariants` exportado en `src/components/ui/button.tsx`
- [X] T066 Arnés: `usedAt` nulo con el link pendiente, con fecha tras usarse y nulo tras revocar en `scripts/e2e-selftest.mjs`; guion en `tests/e2e/us-google-por-link.md`
- [X] T067 [P] spec (revisión, actores, US1, FR-1422, FR-1429), `contracts/api.md`, `plan.md`; guía del operador (§1, guion del video) y estado de la verificación (marca verificada el 2026-09-29, logo al final) en `docs/google-agencia.md`
- [X] T068 Gate técnico, arnés completo y recorrido en el navegador de vista previa (sin y con página de aterrizaje); registro en `specs/029-google-por-link/quickstart.md`
- [X] T069 PR; tras el merge (señal del dueño), en uniko-lanco: el botón y su aviso con `lanco.cloud` (sin pulsar *Continuar con Google*) — ponwo/uniko-crm#48 (`284c925`), verificada el 2026-09-29 (quickstart §3)

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T015)** → historias.
- **US1 (T016–T024)** necesita todo Foundational. **US2 (T025–T027)** extiende
  `completeGoogleOAuth` de US1 (mismo archivo: después de T016). **US3 (T028–T030)**
  necesita la ruta del link (T017). **US4 (T031–T038)** es otro repo: puede ir en
  paralelo desde el principio; T038 necesita T014. **US5 (T039–T040)** necesita T001 y
  las rutas. **US6 (T041–T042)** necesita T011.
- **Polish**: T046 antes de T053; T049–T052 antes de T053; T054 después del merge (señal
  del dueño).

### Parallel Opportunities

- T002, T003, T004 juntas tras T001.
- T007, T008, T010, T012, T014, T015 en paralelo una vez hechas T005–T006 (T015 tras
  T009).
- T017–T020 en paralelo tras T016 (archivos distintos).
- Todo US4 (repo `lanco-ws`) en paralelo con US1–US3.
- T043, T044, T045, T047, T048 en paralelo al final.

## Implementation Strategy

1. **MVP = US1**: Setup + Foundational + US1 → un link conecta de punta a punta contra
   los mocks (checkpoint de la Phase 3).
2. **US2 enseguida** (también P1): los caminos infelices son la mitad de la
   Definición de Hecho y comparten archivo con US1.
3. US3 y US5 cierran la superficie de Uniko; US4 (`lanco-ws`) en paralelo; US6 es un
   unitario y una sección de la guía.
4. Polish: documentación, enmienda, gate, arnés completo, ensayo X, PRs. La
   verificación en vivo (T054) espera el merge, que es señal del dueño.
