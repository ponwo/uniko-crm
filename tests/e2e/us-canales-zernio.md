# E2E 014/017 — Instagram y Messenger por Zernio

Guion de comportamiento (Constitución IX) de los canales opcionales cuando
llegan por la API unificada de Zernio. La parte automatizada vive en
`scripts/e2e-instagram.mjs` (tolera la bandera apagada: entonces afirma que el
canal no existe) y `scripts/e2e-messenger.mjs` (exige `messenger` encendido).

Entorno: app con `WA_MOCK_ENABLED=true`, `ZERNIO_BASE_URL` apuntando a
`/api/dev/zernio-mock`, y `CHANNELS=whatsapp,instagram,messenger`.

## Canal apagado (ADR-001)

| Comportamiento | Check |
|---|---|
| La API de ajustes no existe | "GET/PUT /api/settings/instagram → 404" |
| La pantalla y la pestaña no existen | "la pantalla /settings/instagram no existe" + "la pestaña Instagram no aparece" |
| El webhook no existe | "el webhook de Instagram → 404" |
| La URL de callback no se ofrece | "la URL de callback de Instagram va en null" |

## Conectar por Zernio (Configuración → Instagram / → Messenger)

| Comportamiento | Check |
|---|---|
| La pantalla existe y enseña la URL de callback con el segmento secreto | "GET /settings/instagram → 200" + "…lleva el segmento secreto" |
| Una API key que Zernio rechaza no se guarda | "…NO se guarda → 422" |
| Llave válida pero sin el Inbox de Zernio contratado → mensaje que lo dice (no "llave inválida") | "…→ 422 inbox_required" |
| El accountId es de otra plataforma / no es de esa llave | "…→ 422 platform_mismatch" + "…→ 422 account_not_found" |
| El nombre de la cuenta se rellena desde `/accounts` | "el nombre de la cuenta sale de /accounts de Zernio" |
| Sin `accountId` no hay a quién enrutar | "sin accountId no se puede enrutar → 422" |
| En Zernio no hace falta IG_ID (Zernio no lo expone) | "PUT con API key válida y sin IG_ID → 200" |
| El token nunca sale entero | "el token solo enseña su cola" |

## Webhook de Zernio

| Comportamiento | Check |
|---|---|
| Segmento secreto equivocado → 404 sin efectos | "segmento secreto equivocado → 404" |
| Con secreto configurado, sin firma o mal firmada → 401 | "sin firma … → 401" + "firma inválida → 401" |
| `account.accountId` (canónico) y `account.id` (heredado) enrutan igual | "firma válida → 200" + "un evento con solo `account.id` sigue enrutando" |
| Reentregas no duplican; `outgoing` no se ingiere | "el evento repetido NO duplica" + "un `outgoing` … no se ingiere" |
| Un solo webhook para todas las plataformas: Facebook por la URL de IG aterriza como Messenger | "un evento de Facebook por la URL de Instagram → 200" + "…aterriza en la bandeja como Messenger" |

## Salida

| Comportamiento | Check |
|---|---|
| Responde en la conversación opaca de Zernio con su `accountId` | "a la conversación del evento…" |
| Lleva `Idempotency-Key` (un reintento no manda dos veces) | "con Idempotency-Key" |
| Dentro de la ventana sin etiqueta; el saliente queda `sent` | "…NO va etiquetado" + "el saliente queda como 'sent'" |
