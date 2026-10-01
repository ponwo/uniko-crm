# Conectores de agenda

Un **conector** es la forma en que una cita del CRM se convierte en una reunión
de verdad. El motor de agenda no sabe de proveedores: sabe *cuándo* atiende el
negocio y *quién* reservó. Entregar la reunión es trabajo del conector.

Esa separación es lo que hace que agregar Teams, Outlook, CalDAV o Cal.com en
tu fork sea escribir un archivo y una tabla — no pelearte con el motor.

> Los conectores que hablan con un servicio externo existen bajo cinco
> condiciones constitucionales (Principio II, v1.4.0): apagados por defecto,
> aislados tras su adaptador, con un camino sin dependencia que funcione igual,
> credenciales cifradas del negocio, y probados en CI encendidos y apagados. Un
> conector que no las cumpla no entra al core. Desde la 1.8.0, la condición de
> las credenciales admite la **app del operador de la flota** (modelo agencia,
> [ADR-004](adr-004-google-app-de-agencia.md)) solo con un cliente por negocio,
> el permiso únicamente en la instancia, nada central en runtime y el camino
> propio siempre disponible — es lo que usa la conexión de Google por link.

## Los que vienen incluidos

### Enlace fijo (`enlace-fijo`) — el default

Tu sala de siempre. Pegas la URL una vez en Ajustes → Agenda y cada cita la
reparte. No habla con nadie, no pide credenciales y no puede fallar. Si lo
dejas vacío, las citas se agendan igual y sin enlace: nadie promete lo que no
tiene.

Es también la razón de que encender la agenda no te obligue a conectar nada.

### Zoom (`zoom`)

> **Oculto en Ajustes desde el 2026-09-30** (por ahora se trabaja solo con
> Google). El adaptador, su mock y su suite de contrato siguen vivos; quien ya
> lo tenía elegido lo sigue viendo y operando. Volver a ofrecerlo es poner
> `listed: true` en su ficha de `src/lib/agenda-connectors.ts`.

Cada cita crea su propia reunión de Zoom. Reprogramar la mueve conservando el
mismo enlace; cancelar la borra.

**Qué necesitas**: una app **Server-to-Server OAuth** en el Marketplace de Zoom
(la crea el negocio, en su propia cuenta). De ahí salen los tres datos que se
pegan en Ajustes → Agenda: *Account ID*, *Client ID* y *Client Secret*.

**Los cuatro permisos (scopes)**:

```text
meeting:write:meeting     crear la reunión
meeting:update:meeting    moverla al reprogramar
meeting:delete:meeting    borrarla al cancelar
user:read:user            leer tu usuario
```

> ⚠️ El cuarto se olvida siempre. Es el que usa el botón **Probar**: sin él, la
> conexión falla aunque tus credenciales sirvan perfectamente para crear
> reuniones, y el mensaje de error no lo dice.

### Google Calendar + Meet (`google`)

Cada cita crea un evento en tu calendario con su enlace de Meet. Su
diferencial: la cita aparece donde ya miras tu día.

Hay dos formas de conectarlo, y el conector es el mismo en las dos:

- **Por link** (029) — si la instancia tiene configurada una app de Google (la
  del operador de la flota o la tuya): el dueño genera un link en Ajustes →
  Agenda, el titular del calendario lo abre, autoriza con su cuenta y queda
  conectado. Nadie copia tokens. Ver [Conexión por link](#conexión-por-link-029).
- **A mano, con tu propia app** — lo de abajo: los tres datos pegados en la
  pantalla. Es el camino que siempre existe, con o sin link.

**Qué necesitas (a mano)**: un proyecto en Google Cloud **del propio negocio** con la
API de Calendar activada, y de ahí *Client ID*, *Client Secret* y un *refresh
token* con el permiso `calendar.events`. El calendario destino es `primary`
salvo que pongas otro. (La conexión por link pide `calendar.events.owned`, más
estrecho; a mano, `calendar.events` deja además apuntar a un calendario que
otra cuenta compartió contigo.)

**Cómo obtenerlos, paso a paso** (en la cuenta de Google cuyo calendario
recibirá las citas; ~20 minutos, una sola vez):

1. [Google Cloud Console](https://console.cloud.google.com) → un proyecto del
   negocio (nuevo o existente).
2. *APIs y servicios → Biblioteca* → habilitar **Google Calendar API**.
3. *Pantalla de consentimiento OAuth*: **Interno** si la cuenta es Google
   Workspace (sin verificación, sin caducidad). Si es Gmail normal: **Externo**
   y **publicar en producción** (ver la advertencia de abajo). El scope
   `calendar.events` es "sensible": sin verificar, Google enseña un aviso de
   "app no verificada" al autorizar — aceptable, porque solo autoriza el propio
   dueño (*Avanzado → Ir a la app*).
4. *Credenciales → Crear credenciales → ID de cliente OAuth*, tipo **Aplicación
   web**, con URI de redirección `https://developers.google.com/oauthplayground`.
   Anota *Client ID* y *Client Secret*.
5. El refresh token, con [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   ⚙️ → *Use your own OAuth credentials* (pega ID y secreto) → en el paso 1
   escribe el scope `https://www.googleapis.com/auth/calendar.events` →
   *Authorize APIs* (con la cuenta del calendario) → *Exchange authorization
   code for tokens* → copia el **Refresh token**. (La 015 dejó un botón
   "Conectar con Google" con redirect como mejora futura, research D6; la 029 lo
   hizo realidad como la conexión por link de abajo.)
6. Uniko → *Ajustes → Agenda* → **Google Calendar + Meet** → pega los tres
   datos (y el ID del calendario si no es el principal) → **Probar** →
   **Conectar**. Se valida contra Google antes de guardar.

> El botón **Probar** usa `events.list`, no `calendars.get`: ningún permiso de
> eventos (`calendar.events`, ni el `calendar.events.owned` de la conexión por
> link) autoriza el segundo, y un token perfectamente válido fallaba con 403
> justo al conectar (corregido el 2026-09-17).

> ⚠️ **Publica tu app OAuth "en producción".** Si la dejas en modo prueba,
> Google **revoca el refresh token a los 7 días** y tus citas dejarán de generar
> enlace sin previo aviso. Cuando pasa, el CRM marca la conexión como rota y te
> lo muestra en Ajustes — pero la semana perdida no se recupera.

Dos detalles que este conector resuelve por dentro, y que conviene conocer si
escribes uno parecido: la conferencia de Meet se crea **de forma asíncrona** (la
respuesta de crear el evento puede venir sin enlace), así que el conector
re-lee el evento; y si aun así no llegó, la cita se entrega con el evento
creado y el enlace pendiente — reintentarlo **re-lee ese mismo evento**, nunca
crea uno duplicado en tu calendario.

### Conexión por link (029)

Con tres variables de despliegue, la instancia puede conseguir el permiso ella
misma, sin que nadie pegue un refresh token:

```bash
GOOGLE_OAUTH_CLIENT_ID=…            # un cliente OAuth "Aplicación web"
GOOGLE_OAUTH_CLIENT_SECRET=…
GOOGLE_OAUTH_REDIRECT_URI=…         # el ÚNICO URI de redirección de ese cliente
GOOGLE_ONBOARDING_URL=…             # opcional: página que explica al titular qué autoriza
```

Van las tres o ninguna (con `AGENDA=on`, una o dos impiden arrancar), y sin
ellas la superficie del link no existe (404). Con ellas, *Ajustes → Agenda →
Google* muestra **Conectar por link**: el dueño genera un link de **un solo uso
que vence a las 72 horas**, se lo manda al titular del calendario, y este
autoriza con su cuenta de Google **sin sesión en Uniko**. La instancia pide el
permiso `calendar.events.owned` —ver, crear, cambiar y borrar eventos solo en los
calendarios **propios** de quien autoriza—, lo canjea con su propio cliente,
comprueba que se concedió (una concesión de `calendar.events` también vale),
prueba la conexión y solo entonces la guarda — cifrada, en la misma fila que la
conexión manual — y deja la agenda entregando por Google. Si algo falla (el
titular cancela, desmarca el permiso, cambia de navegador, Google no
responde…), la página de resultado dice qué hacer y **ninguna conexión previa
se toca**. Al reconectar se conserva el calendario destino que ya había: si es
de otra cuenta, la prueba falla y hay que autorizar con la cuenta dueña de ese
calendario (o desconectar para volver a `primary`).

**Modelo agencia (la flota de LanCo)**: el cliente OAuth es del proyecto de
LanCo —uno por negocio— y el URI de redirección es el relevo de `lanco.cloud`,
que devuelve la respuesta de Google a la instancia sin guardar nada. Guía
completa del operador, con la verificación de Google:
[google-agencia.md](google-agencia.md).

#### Self-hoster: tu propia app con el mismo link

No necesitas `lanco.cloud` ni ninguna página de aterrizaje. En **tu** proyecto de
Google Cloud, crea un cliente *Aplicación web* con URI de redirección
`https://<tu-dominio>/api/google/oauth/callback` y configura:

```bash
GOOGLE_OAUTH_CLIENT_ID=<tu cliente>
GOOGLE_OAUTH_CLIENT_SECRET=<su secreto>
GOOGLE_OAUTH_REDIRECT_URI=https://<tu-dominio>/api/google/oauth/callback
```

Sin `GOOGLE_ONBOARDING_URL`, el link lleva directo a tu instancia, y Google
vuelve directo a ella. Es el mismo código; el relevo es solo la forma de que un
proyecto sirva a muchos dominios sin verificarlos todos.

## Citas en línea o presenciales

En Ajustes → Agenda → **Cómo atiendes**, el negocio elige una vez para todas
sus citas (no se decide cita por cita):

- **En línea** (el default, lo de siempre): el conector entrega el enlace y se
  le manda al cliente al confirmar.
- **Presencial**: nadie recibe enlace. Con **Google**, el evento se crea igual
  en tu calendario, pero **sin Meet** y con la dirección como ubicación. Con el
  **enlace fijo** (o Zoom), no se llama al conector: la cita queda en Citas. Al
  cliente se le manda la **dirección** («Te esperamos en: …») si la
  configuraste; si no, solo la confirmación.

La cita copia la modalidad y la dirección con las que nació (columnas
`booking.meeting_mode` y `booking.location`): cambiar de modalidad no toca las
ya confirmadas. Para un cerebro externo, `POST /api/bot/bookings` devuelve
`location` junto a `meetingLink` y `linkPending`.

## Qué pasa cuando el proveedor falla

Nada que te cueste una cita. El orden es deliberado: **primero se escribe la
verdad en el CRM, después se habla con el proveedor**. Si el proveedor está
caído, rechaza las credenciales o simplemente tarda:

1. La cita **se crea igual** y se responde `201`, con `linkPending: true` y sin
   enlace.
2. Quien confirma al cliente dice que el enlace llega en un momento, en vez de
   prometer uno que no existe.
3. La cita aparece en **Citas** marcada "sin enlace", con un botón para
   **reintentar**.
4. Si el fallo fue de autenticación, la conexión queda marcada como rota en
   Ajustes, con su tarjeta de reconexión.
5. Una cita **cancelada** no se reintenta (`422`): crearía una reunión —o un
   evento en tu calendario— para algo que ya no va a pasar.

En una cita **presencial** no hay enlace que esperar: si Google falla, la cita
se crea igual, el cliente recibe su dirección y `linkPending` sigue en `false`
(nadie promete un enlace). Lo que falta es el **evento en tu calendario**: la
cita aparece en Citas marcada **"sin evento"**, con un botón para **reintentar
el evento**, que lo crea sin Meet y con la dirección (`eventPending` en
`GET /api/bookings`). Los puntos 4 y 5 aplican igual.

## Escribe tu conector

El contrato son **cuatro operaciones** (más una opcional). No es un mínimo
prudente: es exactamente lo que el uso real necesitó en un CRM en producción
durante meses.

```ts
// src/server/agenda/connectors/types.ts
createMeeting(creds, { topic, startUtc, durationMinutes, timezone, notes? })
  → { externalId, joinUrl }
updateMeeting(creds, externalId, { startUtc, durationMinutes, timezone })
  → void                      // al reprogramar; conserva el enlace
deleteMeeting(creds, externalId) → void   // al cancelar; un 404 es ÉXITO
testConnection(creds) → { ok: true } | { ok: false, error }

// Opcional, solo si tu proveedor genera el enlace de forma asíncrona:
refreshMeeting?(creds, externalId) → { externalId, joinUrl }
```

Reglas que hace cumplir el motor, no tú:

- **Best-effort.** Una excepción tuya jamás revierte ni bloquea la cita.
- **Sandbox.** Una cita del Laboratorio nunca llega a un conector: la aserción
  vive antes de elegir cuál. No compruebes `is_test`; no te toca.
- **Idempotencia.** Borrar algo que ya no está es objetivo cumplido.
- **Sin free/busy.** El contrato no lee disponibilidad ajena, a propósito: la
  disponibilidad se calcula local, en una query, y meter al proveedor ahí
  acoplaría su latencia a la pantalla que más se usa. Si tu fork lo necesita,
  es una extensión — no un hueco.

### Los seis archivos que tocas

1. `src/lib/agenda-connectors.ts` — tu id y tu ficha (etiqueta, descripción,
   capacidades). Es lo que la pantalla de Ajustes muestra.
2. `src/server/agenda/connectors/<id>.ts` — el adaptador.
3. `src/server/agenda/connectors/<id>-credentials.ts` + `src/lib/db/schema.ts`
   y una migración aditiva — TU tabla, con TU forma. Tabla explícita, no un
   jsonb genérico: unas credenciales tienen forma fija y así conservan tipado e
   índices. Cifra con `@/lib/crypto`, como todos.
4. `src/server/agenda/connectors/index.ts` — una rama en el `switch`.
5. `src/app/api/settings/<id>/route.ts` (+ `test/`) — pegar credenciales,
   **validar contra el proveedor antes de guardar**, exponer solo los últimos 4.
6. `src/app/api/dev/<id>-mock/` — tu mock, con `_state`, `_reset` y un camino
   infeliz determinista.

Cero archivos del motor. Si te encuentras editando `service.ts` o
`availability.ts` para que tu conector funcione, algo se salió del contrato:
levanta un issue antes de forzarlo.

### Cómo sabes que funciona

`tests/unit/connectors.test.ts` es una suite de contrato **compartida**: la
misma para todos. Agrega tu conector ahí y haz que pase — es la definición de
"está bien escrito", y evita descubrir en producción que tu `deleteMeeting`
revienta con un 404 o que tu enlace no sobrevive a un reprogramado.
