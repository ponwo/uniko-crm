# Quickstart — probar el motor de agenda universal de punta a punta

Feature: `015-motor-agenda-universal`. Cómo se ejercita TODO el alcance en
localhost con los mocks, sin tocar proveedores reales (Constitución IX: local
primero, nube después).

## 1. Entorno

```bash
# .env (además de lo habitual: DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY…)
AGENDA=on                                   # la bandera de esta feature
CHANNELS=whatsapp                           # (o whatsapp,instagram para la config "todo encendido")
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
BOT_API_KEY=una-llave-de-al-menos-16-chars
ZOOM_BASE_URL=http://localhost:3000/api/dev/zoom-mock
ZOOM_OAUTH_BASE_URL=http://localhost:3000/api/dev/zoom-mock
GOOGLE_CAL_BASE_URL=http://localhost:3000/api/dev/google-mock
GOOGLE_OAUTH_BASE_URL=http://localhost:3000/api/dev/google-mock
```

App viva con BD migrada (`pnpm db:migrate` en dev; en contenedor migra al
arranque).

## 2. La bandera, primero apagada

1. Arranca SIN `AGENDA` → `GET /api/calendar/settings`, `GET /api/bookings`,
   `GET /api/bot/availability` y `POST /api/bot/bookings` responden **404**;
   la navegación no muestra "Citas"; Ajustes no muestra "Agenda"; el prompt del
   agente (Laboratorio) no menciona agendar.
2. Arranca con `AGENDA=on` → todo lo anterior existe; la migración no cambió
   (ya estaba aplicada: es inerte apagada).

## 3. Camino feliz sin terceros (conector `enlace-fijo`)

1. Ajustes → Agenda: horario L-V 09:00-18:00, cita 30 min, zona
   `America/Mexico_City`, link `https://meet.ejemplo.com/mi-sala`.
2. `GET /api/bot/availability?conversationId=cv_…&limit=12&perDay=3&days=5` →
   huecos repartidos entre días, etiquetas con día en palabras.
3. `POST /api/bot/bookings` con un `startUtc` ofrecido → **`201`** con
   `meetingLink` = la sala fija y `linkPending: false`.
4. La cita aparece en "Citas"; el hueco desapareció de la disponibilidad; el
   lead avanzó de etapa (bitácora registra el movimiento).

## 4. Las dos garantías (contra la app viva, no con mocks unitarios)

- **No ofrecido**: `POST /api/bot/bookings` con un instante libre pero jamás
  ofrecido → `409` con `error.code = "slot_not_offered"` y `slots` = lo que sí
  se ofreció.
- **La carrera**: ofrece a dos conversaciones el mismo hueco; reserva con la
  primera (201); reserva con la segunda → `409 slot_taken` con alternativas
  frescas, y `GET /api/bookings` muestra UNA sola cita en ese instante.
  Reservar la alternativa de inmediato → 201 (ya estaba registrada como
  oferta).
- **Códigos exactos**: los checks comparan `status === 201` / `=== 409` y la
  forma anidada del sobre — nunca `res.ok`.

## 5. Conector Zoom (mock)

1. Ajustes → Agenda → conector Zoom: pega Account ID / Client ID / Client
   Secret cualquiera → **Probar** pega al zoom-mock y pasa; con secret
   terminado en `-invalid` → 422 y NO se guarda.
2. Agenda una cita → `201` con `meetingLink` `https://zoom.mock/j/…`;
   `GET /api/dev/zoom-mock/_state` muestra la reunión creada con tema, inicio y
   duración.
3. Reprograma (`PATCH /api/bot/bookings`) → 200, mismo link; el `_state`
   muestra el PATCH con el mismo id.
4. Cancela desde "Citas" → el `_state` muestra el DELETE; cancelar de nuevo →
   200 sin cambios.

## 6. Fallo del proveedor ⇒ link pendiente ⇒ reintento

1. Con el mock en modo fallo (o credenciales rotas a propósito), agenda →
   **`201` igualmente**, con `meetingLink: null` y `linkPending: true` — la
   conversión no se pierde.
2. "Citas" muestra la cita marcada "sin enlace" con **Reintentar enlace**.
3. Repara el mock y reintenta → el link aparece y `linkPending` vuelve a
   `false`.
4. Si el fallo fue 401: Ajustes muestra la tarjeta de reconexión
   (`status: "error"`).

## 7. Conector Google (mock)

Igual que Zoom con el google-mock: conectar valida antes de guardar; agendar
crea el evento con petición de Meet; reprogramar mueve el evento; cancelar lo
borra; refresh token inválido → error claro + estado de reconexión.

## 8. Sandbox del Laboratorio

Corre una conversación del Laboratorio hasta agendar: la cita nace `is_test`,
visible marcada de prueba, y los `_state` de los mocks de conectores quedan
**vacíos** — ni crear, ni reprogramar, ni cancelar tocan proveedor alguno para
citas de prueba (y la app real, jamás: los mocks solo existen con
`WA_MOCK_ENABLED=true` fuera de producción).

## 9. Gate y arnés

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test   # el piso
pnpm test:e2e                                            # el arnés, con la app viva
```

`pnpm test:e2e` incluye la sección de agenda (guion `tests/e2e/us-agenda.md`):
bandera apagada/encendida, camino feliz, las dos garantías con códigos exactos,
la carrera, link pendiente + reintento, y sandbox. Sale distinto de cero si
algo falla. En CI, los gates corren en la matriz de dos configuraciones: todo
apagado (default) y todo encendido (`AGENDA=on` + canales) — FR-021.

## 10. Citas presenciales (modalidad, 2026-09-30) y su ensayo del Principio X

El negocio elige en Ajustes → Agenda → «Cómo atiendes» si sus citas son **en
línea** (lo de siempre) o **presenciales** (sin enlace, con dirección; con Google,
evento sin Meet). Zoom deja de ofrecerse en Ajustes. Guía:
[docs/agenda-conectores.md](../../docs/agenda-conectores.md#citas-en-línea-o-presenciales);
guion E2E: `tests/e2e/us-agenda.md` (`modalidadChecks()`).

Migración `0017_agenda_modalidad`: **solo agrega** cuatro columnas, todas con
`IF NOT EXISTS` — `calendar_settings.meeting_mode` (`NOT NULL DEFAULT 'virtual'`),
`calendar_settings.location`, `booking.meeting_mode` y `booking.location`.

**Fuera de orden.** La [PR #54](https://github.com/ponwo/uniko-crm/pull/54) se
mergeó el 2026-10-01 (`ef4ccc0`) antes del ensayo, que el Principio X pide ANTES
de `main`. La migración corrió en uniko-lanco sin problema (`[migrate]
migraciones aplicadas`, `/api/health` en `ef4ccc0`) y el dueño la probó ahí con
uso real. El ensayo con los respaldos de los clientes seguía siendo **requisito
de la puerta de promoción a `production`**, y se hizo antes de llevarla a ellos.

**Registro (2026-10-01, código de `main` en `ef4ccc0`):**

- **Contra qué datos**: los respaldos de los **dos clientes**, que siguen en
  `production` (`bd0cb82`) y por lo tanto **por detrás de la migración**. El dueño
  los bajó del panel de Coolify («Back up now» del 2026-10-01):
  - **I Love The Universe**: `pg-dump-uniko-1790863580.dmp`, 14:06 UTC,
    **114 093 bytes**;
  - **NuriaAndrea**: `pg-dump-uniko-1790863669.dmp`, 14:07 UTC, **221 139 bytes**.

  Los dos tamaños se verificaron byte a byte contra lo que reporta Coolify
  **antes** de restaurar.
- **Bases desechables** en el PostgreSQL 16 local: `uniko_ensayo_iltu_20261001` y
  `uniko_ensayo_nuriaandrea_20261001`. Nunca `uniko_dev` ni una instancia.
- **Restauración** limpia en las dos (código 0, nada en stderr): 992 ms y 1066 ms.
  - ILTU: 26 conversaciones, 75 mensajes, 26 contactos; **1 fila en
    `calendar_settings`** y 0 citas.
  - NuriaAndrea: 84 conversaciones, 1070 mensajes, 84 contactos; 0 filas en
    `calendar_settings` y 0 citas.
  - Las dos con **17 migraciones** en el diario de Drizzle (hasta la `0016`) y
    ninguna de las cuatro columnas.
- **`pnpm db:migrate`** desde un worktree con el árbol idéntico a `ef4ccc0`, solo
  migraciones: código 0, **4.8 s y 2.9 s** con el arranque de drizzle-kit
  incluido, y solo el ruido esperado (`NOTICE` de `CreateSchemaCommand` y
  `transformCreateStmt`). La última entrada del diario es el `sha256` de
  `0017_agenda_modalidad.sql`.
- **Aditiva, medido y no supuesto.** Inventario del esquema entero antes y
  después (tablas con sus filas, columnas, índices, restricciones y diario),
  comparado línea por línea. Idéntico en las dos bases:

  | | Antes | Después |
  |---|---|---|
  | Tablas | 34 | 34 |
  | Columnas | 358 | 362 (las 4 de la `0017`) |
  | Índices | 86 | 86 |
  | Restricciones | 95 | 95 |
  | **Filas** | 218 / 1813 | **218 / 1813** |
  | Diario de Drizzle | 17 | 18 |

  Las únicas líneas que cambian son las cuatro columnas nuevas y el contador del
  diario. La fila de `calendar_settings` de ILTU quedó con `meeting_mode =
  'virtual'` y `location` nula: exactamente el comportamiento de siempre.
- **Re-ejecutable.** La `0017` corrida otra vez a mano (`psql -f`) sobre cada copia
  ya migrada: código 0, cuatro `NOTICE` «ya existe, omitiendo», y el inventario
  quedó **idéntico** al de después de migrar.
- **La app de `main` arrancó contra cada copia** (build de producción, `next start
  -p 3100`): `/api/health` → `{"ok":true,"version":"1.0.0"}`. El manifiesto sirvió
  la marca real de cada cliente: «I Love The Universe — CRM de WhatsApp»
  (`#0fafff`) y «NuriaAndrea CRM — CRM de WhatsApp» (`#0d5bff`). En el log, solo el
  aviso de Next por los dos lockfiles (el worktree vive dentro del repo; no pasa
  en el contenedor).
- **Tirado todo**: las dos bases, con `dropdb --force` (en el PostgreSQL local no
  queda ninguna `*ensayo*`), y los archivos de trabajo del ensayo. Los volcados
  bajados los borra el dueño de su carpeta; los originales siguen en el VPS con la
  retención de Coolify (14 días).

Lo que este ensayo no mide es el volumen, como advierte la 020. La migración solo
agrega columnas: tres nullable sin default y una con default constante, que en
PostgreSQL 11+ no reescribe la tabla. Su costo no crece con los datos del cliente.

**PROMOVIDA a `production` en `ef4ccc0` el 2026-10-01** por señal del dueño («haz
la promoción»), con la puerta completa: CI verde en las dos configuraciones para
ese commit, LanCo corriendo `ef4ccc0`, uso real y self-test declarados por el dueño
(su prueba en uniko-lanco), este ensayo, y la reversión declarada (redesplegar
`bd0cb82`; el código viejo ignora las cuatro columnas). Viajaron 2 commits
(`5244b3b` y el merge `ef4ccc0`), `bd0cb82..ef4ccc0` con `git push origin
<sha>:refs/heads/production` (avance directo). `verify-fleet.sh` 3/3 en `ef4ccc0`,
y `[migrate] migraciones aplicadas` en el arranque de ILTU y NuriaAndrea, sin
errores. Durante el relevo, NuriaAndrea alternó un minuto entre el contenedor viejo
y el nuevo; se dio por buena con cuatro lecturas seguidas en `ef4ccc0` y el
despliegue de Coolify en `finished`. En los clientes la agenda sigue apagada:
las columnas quedan inertes.
