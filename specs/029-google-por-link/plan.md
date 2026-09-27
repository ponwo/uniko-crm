# Implementation Plan: Conexión de Google Calendar por link (modelo agencia)

**Branch**: `029-google-por-link` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/029-google-por-link/spec.md`

**Artefactos**: [research.md](research.md) · [data-model.md](data-model.md) ·
[contracts/api.md](contracts/api.md) · [contracts/relevo-lanco-cloud.md](contracts/relevo-lanco-cloud.md)
· [quickstart.md](quickstart.md) · [enmienda-constitucional.md](enmienda-constitucional.md)
· [tasks.md](tasks.md)

## Summary

El dueño de la cuenta genera en *Ajustes → Agenda* un link de un solo uso (llave opaca,
72 h, registrada solo por su huella en la tabla nueva `google_link`). El titular del
calendario lo abre sin sesión: la página de LanCo en `lanco.cloud` le explica qué
autoriza y lo manda a la instancia (`/api/google/oauth/start`), que valida el link,
ata el flujo a su navegador con una cookie y lo manda a Google con un `state` firmado
que lleva el origen de la instancia. Google vuelve a `lanco.cloud` (único URI
registrado en el cliente OAuth de ese negocio), cuyo relevo estático reenvía la
respuesta a la instancia (`/api/google/oauth/callback`). La instancia canjea el
`code` con su propio cliente, comprueba permiso y refresh token, prueba la conexión y,
en una transacción, consume el link y guarda las credenciales en la fila de la 015.
El conector de Google no cambia. Todo detrás de `AGENDA` + las tres `GOOGLE_OAUTH_*`.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: Next.js 15 (App Router) + React 19; `jose` (ya en el repo:
firma del `state`); `node:crypto` (llave, SHA-256, HKDF); Drizzle ORM; Zod. **Sin
dependencias nuevas.** Sitio: Vite 6 + React 19 + React Router 7 (repo `lanco-ws`).

**Storage**: PostgreSQL 16 — tabla nueva `google_link` (migración aditiva `0016`);
`google_credentials` y `calendar_settings` sin cambios de esquema.

**Testing**: Vitest (unitarios con reloj inyectable y `fetch` simulado) + arnés
`scripts/e2e-selftest.mjs` contra la app viva con `google-mock` y `lanco-relay-mock`.
El sitio no tiene suite: `npm run build` + recorrido en navegador.

**Target Platform**: contenedor Linux (Coolify), una instancia por negocio; sitio
estático servido por nginx.

**Project Type**: monolito web (Next.js) + sitio estático aparte.

**Performance Goals**: ninguno nuevo en el camino caliente: la operación de citas no
cambia. El recorrido del titular son dos redirecciones y un canje (< 3 s del lado de
Uniko con Google sano).

**Constraints**: ningún secreto ni token fuera de la instancia; ningún dato personal
en direcciones; la caída de `lanco.cloud` no afecta a conexiones hechas; superficie en
404 sin la configuración.

**Scale/Scope**: 3 instancias hoy, del orden de decenas de negocios a futuro; a lo
sumo un link vigente por negocio.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| **I. Seguridad** | El secreto del cliente OAuth y el refresh token se guardan con `lib/crypto` (AES-256-GCM), como en la 015; hacia fuera solo los últimos 4. La llave del link se guarda solo como SHA-256. `state` firmado (HS256, clave derivada por HKDF), 15 min, atado al navegador por cookie `HttpOnly`. Nada de esto va a logs. | ✅ |
| **II. Soberanía** | Conector opcional (condiciones 1, 2, 3 y 5 cumplidas: apagado por defecto, aislado en el adaptador de Google, `enlace-fijo` y el camino manual siguen, CI encendido/apagado con mock de camino infeliz). **La condición 4 prohíbe hoy la app de agencia** → enmienda **1.8.0** propuesta en [enmienda-constitucional.md](enmienda-constitucional.md) + ADR-004. `lanco.cloud` participa solo en el alta, sin guardar nada. | ⚠️ **Requiere la enmienda** — ratificación del dueño al aprobar la PR |
| **III. Multi-tenancy** | `google_link.organization_id` NOT NULL; toda query por `scoped()`; el link y el `state` llevan la organización y se comprueba contra la fila. | ✅ |
| **IV. Idempotencia** | Consumir el link es un `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL RETURNING` dentro de la transacción que guarda: dos respuestas del mismo link → una conexión. Migración re-ejecutable (`IF NOT EXISTS` de drizzle-kit). | ✅ |
| **V. Calidad verificable** | Gate completo + unitarios de cada motivo + bloque del arnés con camino feliz e infeliz. | ✅ |
| **VI. Specs antes de código** | Ciclo completo declarado en la spec (modelo de datos + contrato con `lanco-ws`). Banda FR-14xx. | ✅ |
| **VII. Trazabilidad** | Decisiones con alternativas en research.md; ningún requisito anterior se deroga (la 015 D6 dejaba el botón "Conectar con Google" como mejora futura: se cumple, no se deroga). | ✅ |
| **VIII. Foco vertical** | Es agendar desde WhatsApp: el diferencial de la agenda para los clientes de la flota. | ✅ |
| **IX. Verificación en vivo** | Arnés contra la app viva con mocks + verificación en uniko-lanco con el dueño (quickstart §6). | ✅ |
| **X. Irreversibilidad** | Solo agrega una tabla. Plan de reversión: redesplegar el commit anterior (la tabla queda inerte); quitar las variables apaga la feature. Ensayo contra respaldo real restaurado antes de `main` (quickstart §4). | ✅ (ensayo pendiente) |

**Re-check tras Phase 1**: sin cambios. La única desviación es la de II.3.4, y es
exactamente lo que la enmienda propone acotar; sin ella la PR no se mergea.

## Project Structure

### Documentation (this feature)

```text
specs/029-google-por-link/
├── spec.md
├── plan.md                     # este archivo
├── research.md
├── data-model.md
├── quickstart.md
├── enmienda-constitucional.md  # propuesta 1.7.0 → 1.8.0 (Principio II.3.4)
├── contracts/
│   ├── api.md                  # rutas de la instancia
│   └── relevo-lanco-cloud.md   # contrato con el repo lanco-ws
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── env.ts                                   # + GOOGLE_OAUTH_* , GOOGLE_AUTH_URL, GOOGLE_ONBOARDING_URL (+ superRefine)
│   └── db/
│       ├── schema.ts                            # + googleLink
│       └── ids.ts                               # + glink
├── server/
│   ├── agenda/connectors/
│   │   ├── google.ts                            # + exchangeAuthorizationCode (único que habla HTTP con Google)
│   │   ├── google-credentials.ts                # + googleCredentialValues (para la transacción)
│   │   ├── google-link.ts                       # NUEVO: registro de links (generar, revocar, pendiente, validar, consumir+guardar)
│   │   └── google-oauth.ts                      # NUEVO: config/disponibilidad, state, URL de Google, completar el flujo, motivos
│   └── dev/google-mock-state.ts                 # + códigos de autorización y decisiones deterministas
├── app/
│   ├── api/
│   │   ├── settings/google/link/route.ts        # NUEVO: GET/POST/DELETE (sesión; POST/DELETE solo owner)
│   │   ├── google/oauth/start/route.ts          # NUEVO: público
│   │   ├── google/oauth/callback/route.ts       # NUEVO: público
│   │   └── dev/
│   │       ├── google-mock/[...path]/route.ts   # + GET auth, + grant authorization_code
│   │       └── lanco-relay-mock/route.ts        # NUEVO: el contrato del relevo, para el arnés
│   └── conectar-google/page.tsx                 # NUEVO: página de resultado, pública
└── components/settings/
    ├── connector-credentials.tsx                # + sección del link en Google; "Probar" con el nombre del calendario
    └── google-link-section.tsx                  # NUEVO

drizzle/0016_google_link.sql (+ meta)            # generada con pnpm db:generate
tests/unit/google-link.test.ts                   # NUEVO
tests/unit/google-oauth.test.ts                  # NUEVO
tests/unit/google-env.test.ts                    # NUEVO (todo o nada con AGENDA)
tests/e2e/us-google-por-link.md                  # NUEVO guion
scripts/e2e-selftest.mjs                         # + bloque 029
.github/workflows/ci.yml                         # + GOOGLE_OAUTH_* en la configuración "completo"
.env.example                                     # + variables con guía
docs/adr-004-google-app-de-agencia.md            # NUEVO
docs/google-agencia.md                           # NUEVO: guía del operador + verificación
docs/agenda-conectores.md                        # + sección "Conexión por link"
.specify/memory/constitution.md                  # 1.8.0 (al ratificar)
CLAUDE.md, specs/README.md                       # mapa y fila de la 029
```

```text
lanco-ws (C:\G\gApps\LanCo\LanCo-SitioWeb\LanCo-Conect-Coex)
├── data/flota.ts                     # NUEVO: hosts de la flota + nombre del negocio
├── modules/googleCalendar.ts         # NUEVO: funciones puras (link, state, relevo, navegador embebido)
├── pages/GoogleCalendar.tsx          # NUEVO: aterrizaje + página de la app
├── pages/GoogleCalendarCallback.tsx  # NUEVO: relevo
├── App.tsx                           # + dos rutas sin layout
├── data/legalData.ts                 # + sección de datos de Google en la política de privacidad
└── README.md                         # + rutas
```

**Structure Decision**: el adaptador de Google sigue siendo el único que habla HTTP con
Google (`google.ts`); lo nuevo se separa en dos módulos por responsabilidad — el
registro de links (base de datos) y el flujo OAuth (firma, URLs, orquestación con
dependencias inyectables para las pruebas). Las rutas son delgadas.

## Diseño

### Configuración (`src/lib/env.ts`)

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`:
  opcionales en el esquema; en el `superRefine`, **con `AGENDA` encendida**, si alguna
  está, las tres son obligatorias (el error nombra la que falta) y la de redirección
  debe ser `https:` o `http://localhost…`.
- `GOOGLE_ONBOARDING_URL`: opcional, URL; sin barra final.
- `GOOGLE_AUTH_URL`: default `https://accounts.google.com/o/oauth2/v2/auth`.
- `googleLinkAvailable()` (en `google-oauth.ts`) = `agendaEnabled()` && las tres
  presentes, leyendo `process.env` directo como `agendaEnabled()` (preguntar si una
  feature existe no depende de que todo el entorno valide). La configuración
  completa se obtiene de `getEnv()` al usarla.

### Registro de links (`google-link.ts`)

- `issueGoogleLink({ organizationId, userId, now })` → `{ token, expiresAt }`: llave
  de 32 bytes base64url; en transacción revoca pendientes e inserta `{ token_hash:
  sha256(token), expires_at: now + 72 h }`.
- `revokeGoogleLinks(organizationId, now)` → número revocado.
- `pendingGoogleLink(organizationId, now)` → `{ createdAt, expiresAt } | null`.
- `checkGoogleLink(token, now)` → `{ ok: true, link } | { ok: false, motivo:
  "link_invalido" | "link_vencido" | "link_usado" }` (revocado cuenta como
  `link_invalido`: para quien lo abre, ya no es un link válido).
- `consumeLinkAndSaveCredentials({ linkId, organizationId, creds, now })` →
  `boolean`: una transacción; `UPDATE … RETURNING` + upsert de credenciales con los
  valores de `googleCredentialValues()`; limpia la caché del token de Google.

### Flujo OAuth (`google-oauth.ts`)

- `buildGoogleLinkUrl(token)` → con `GOOGLE_ONBOARDING_URL`:
  `{onboarding}?i={host}&t={token}`; sin ella: `{APP_BASE_URL}/api/google/oauth/start?t={token}`.
- `signOAuthState({ organizationId, linkId, nonce, now })` / `verifyOAuthState(jwt,
  now)`: HS256 con `hkdf(sha256, BETTER_AUTH_SECRET, "uniko/029", "google-oauth-state", 32)`;
  claims `ret` (= origen de `APP_BASE_URL`), `sub` (organización), `lnk`, `nh`
  (`sha256(nonce)`), `iat`, `exp` = +15 min, `aud` = origen. `jose.jwtVerify` con
  `currentDate` inyectado.
- `buildGoogleAuthUrl(state)`: parámetros de D6.
- `completeGoogleOAuth(query, { cookieNonce, now, deps })` → `{ motivo, calendario? }`
  siguiendo el orden de D7. `deps` inyectables (canje, prueba, consumir+guardar,
  cambiar conector) para probar cada motivo sin red ni base.
- `MOTIVOS` y sus textos viven en `src/lib/google-link-motivos.ts` (compartido con la
  página, sin código de servidor).

### Adaptador (`google.ts`)

- `exchangeAuthorizationCode({ clientId, clientSecret, redirectUri, code })` →
  `{ refreshToken?, scope, accessToken }` o `ConnectorError` (`isAuthError` para
  `invalid_grant`/401, `status` para 5xx y red). Mismo `GOOGLE_OAUTH_BASE_URL` que el
  refresco.
- La prueba de conexión pide `fields=summary` además de `maxResults=1`: solo el
  nombre del calendario, ni un evento (minimización de datos; ayuda en la
  verificación).

### Rutas

- `settings/google/link`: `withAuth`; 404 si `!googleLinkAvailable()`; POST/DELETE
  exigen `session.role === "owner"` (403 `forbidden`).
- `google/oauth/start`: sin `withAuth`; 404 si no disponible; `checkGoogleLink` →
  302 a `/conectar-google?estado=…` o 302 a Google + cookie del nonce.
- `google/oauth/callback`: sin `withAuth`; 404 si no disponible; `completeGoogleOAuth`
  → 302 a `/conectar-google?estado=…`; borra la cookie del nonce; en `ok` pone la
  cookie del calendario. Nunca 500 hacia el titular: cualquier excepción inesperada
  se registra (sin secretos) y termina en `google_no_respondio`.
- Las redirecciones se construyen sobre `APP_BASE_URL`, no sobre `req.url` (detrás del
  proxy el host de la petición puede ser el interno).

### Página de resultado (`src/app/conectar-google/page.tsx`)

Server component público (fuera del grupo `(app)`, que exige sesión). 404 si no
disponible. Lee `estado` de `searchParams` contra el catálogo cerrado y la cookie del
calendario; marca de la instancia con `getBranding()` como la pantalla de login.

### UI (`google-link-section.tsx`)

Dentro de la tarjeta de Google, arriba de los campos manuales, solo si `GET
/api/settings/google/link` responde 200: explicación de una línea; **Generar link**
(o **Generar otro**, que avisa que invalida el anterior); tras generar, el link en un
campo de solo lectura con **Copiar** y "vence el … · sirve una sola vez"; si hay
pendiente, su vencimiento y **Revocar**; sin `canManage`, los botones deshabilitados
con "solo el dueño de la cuenta". Debajo, los campos manuales bajo el título "¿Usas tu
propia app de Google Cloud?". "Probar" muestra "Conexión correcta — calendario «…»".

### Mocks

- `google-mock` `GET auth`: valida `client_id`, `redirect_uri`, `response_type`,
  `state`, `scope`; según `mock_decision` redirige a `redirect_uri` con `code` de un
  solo uso (atado a `client_id` + `redirect_uri` + decisión) o con
  `error=access_denied|admin_policy_enforced`.
- `google-mock` `POST token` con `grant_type=authorization_code`: código desconocido o
  reutilizado → 400 `invalid_grant`; `redirect_uri`/`client_id` distintos → 400;
  `exchange_down` → 503; `partial` → `scope` sin `calendar.events`; `no_refresh` → sin
  `refresh_token`; `approve` → `refresh_token: "ref-oauth-<n>"` (que el refresco
  acepta). El refresco existente no cambia.
- `lanco-relay-mock`: el algoritmo del contrato §3, con la lista = el host de
  `APP_BASE_URL`; 302 en vez de `location.replace` (el arnés no ejecuta JS).

### Arnés

Bloque "029" en `agendaChecks()`, tras el del conector Google: se salta con aviso si
`GET /api/settings/google/link` da 404 con `AGENDA` encendida (instancia sin app de
agencia) comprobando que las cuatro superficies dan 404. Un `fetch` sin cookies de
sesión y con `redirect: "manual"` hace de navegador del titular, llevando a mano la
cookie del nonce. Casos de quickstart §3.

## Plan de reversión

- **Código**: redesplegar el commit anterior. La tabla `google_link` queda, vacía o
  con links que nadie lee; las conexiones hechas por link siguen funcionando porque
  viven en `google_credentials`, igual que las manuales.
- **Feature**: quitar las tres `GOOGLE_OAUTH_*` de la instancia la apaga (404) sin
  redeploy de código; las conexiones hechas siguen funcionando.
- **Esquema**: nada que revertir en esta entrega. Si algún día sobra la tabla, se
  borra en una entrega posterior.
- **Sitio**: revertir el commit en `lanco-ws` quita las dos páginas; ninguna conexión
  hecha depende de ellas.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principio II.3.4 (credenciales de plataforma central) | La app OAuth de la agencia es lo que evita que cada negocio monte su propio proyecto de Google — el objetivo de la feature | El camino propio (BYO) ya existe y ningún cliente de la flota puede recorrerlo solo; se acota con la enmienda 1.8.0 en vez de relajar el principio entero |
| Tabla nueva (Principio X) | Un link usado no debe revivir y debe poder revocarse (FR-1407..FR-1409) | Las variantes sin estado reviven links al desconectar o cambian la semántica de `DELETE` (research D3) |
