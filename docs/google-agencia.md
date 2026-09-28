# Google Calendar por link — guía del operador (modelo agencia)

Cómo darle Google Calendar + Meet a un negocio de la flota **sin que el negocio
toque Google Cloud**: el operador (LanCo) le manda un link, el titular del
calendario autoriza con su cuenta de Google y su Uniko queda conectado. Nadie
copia tokens.

Por qué es así y no de otra forma: [ADR-004](adr-004-google-app-de-agencia.md).
Qué hace exactamente: [spec 029](../specs/029-google-por-link/spec.md). Lo que
ata Uniko con `lanco.cloud`:
[contrato del relevo](../specs/029-google-por-link/contracts/relevo-lanco-cloud.md).

```text
Uniko (dueño)  ──genera link──▶  titular abre el link
                                   │
lanco.cloud/google-calendar  ◀─────┘   (explica qué autoriza)
        │ Continuar con Google
        ▼
instancia /api/google/oauth/start ──▶ Google (LanCo Agenda) ──▶ lanco.cloud/google-calendar/callback
                                                                     │ reenvía, no guarda nada
instancia /api/google/oauth/callback ◀───────────────────────────────┘
   canjea con SU cliente OAuth, prueba, guarda cifrado ──▶ /conectar-google «conectado»
```

Una vez conectada, la instancia habla con Google directo: `lanco.cloud` no está
en el camino de ninguna cita.

---

## 0. Una sola vez: el proyecto de Google

El proyecto es **LanCo Robotics** (`lanco-robotics`, propiedad de
`ponwo10@gmail.com`): el mismo con el que LanCo conectó su propia agenda el
2026-09-23, y esa conexión sigue funcionando. Su app se llamaba
`agendamiento-lanco`; el 2026-09-28 pasó a **LanCo Agenda**. La Google Calendar
API ya está activada. En la
[consola](https://console.cloud.google.com) → *Google Auth Platform*:

1. **Marca (Branding)**
   - Nombre de la app: **LanCo Agenda** — es lo que verá el titular en la
     pantalla de permisos.
   - Página principal: `https://lanco.cloud/google-calendar`
   - Política de privacidad: `https://lanco.cloud/politica-privacidad`
   - Términos: `https://lanco.cloud/terms-and-conditions`
   - Dominio autorizado: `lanco.cloud` (ya está).
   - Contacto del desarrollador: `contacto@lanco.cloud` — ahí escribe Google
     durante las verificaciones.
   - **Logo: no por ahora.** Con la app externa y en producción, subir el logo
     la mete al trámite de verificación de marca, y la marca no se puede editar
     mientras ese trámite está abierto (§5).
2. **Público (Audience)**: *Externo* y **En producción**. En modo prueba Google
   revoca el permiso a los 7 días y las citas se quedan sin enlace.
3. **Acceso a los datos (Data access)**: un solo permiso,
   `https://www.googleapis.com/auth/calendar.events.owned` (sensible): ver,
   crear, cambiar y borrar eventos en los calendarios **propios** de quien
   autoriza. Se declara al pedir la verificación del permiso (§5.2).

## 1. Por cada negocio (~10 minutos)

1. **Su cliente OAuth.** *Google Auth Platform → Clientes → Crear cliente* →
   tipo **Aplicación web** → nombre `Uniko · <Negocio>` → *URI de redirección
   autorizados*: `https://lanco.cloud/google-calendar/callback` (exacto, sin
   barra final) → Crear. Copia el **ID de cliente** y el **secreto**.
   - **Uno por negocio, jamás reutilizado.** Es lo que acota una fuga a un
     negocio y lo que permite darlo de baja sin tocar a nadie (ADR-004).
   - Google no tiene API para esto: es a mano.
2. **La lista de la flota en `lanco.cloud`.** Si el host del negocio no está en
   `data/flota.ts` del repo `lanco-ws`, añádelo con su nombre visible y
   despliega el sitio (push a `main` = despliegue). Sin eso, la página de
   aterrizaje y el relevo se niegan a llevar a esa instancia.
3. **Las variables de la instancia** (Coolify → la aplicación del negocio →
   *Environment Variables*, en runtime):

   ```bash
   AGENDA=on
   GOOGLE_OAUTH_CLIENT_ID=<ID de cliente del paso 1>
   GOOGLE_OAUTH_CLIENT_SECRET=<secreto del paso 1>
   GOOGLE_OAUTH_REDIRECT_URI=https://lanco.cloud/google-calendar/callback
   GOOGLE_ONBOARDING_URL=https://lanco.cloud/google-calendar
   ```

   Reinicia y espera `/api/health` 10/10 (el relevo de contenedores alterna
   viejo y nuevo un minuto). Con `AGENDA=on`, las tres `GOOGLE_OAUTH_*` van
   juntas: con una o dos la instancia no arranca y el log nombra la que falta.
4. **El link.** En el Uniko del negocio, como **dueño**: *Ajustes → Agenda →
   Google Calendar + Meet → Conectar por link → Generar link → Copiar*. Se ve
   una sola vez; vence en 72 horas y sirve una sola vez. Generar otro invalida
   el anterior, y *Revocar* lo mata antes de que se use.
5. **Mándalo al titular** por su canal de siempre. Un texto que funciona:

   > Para que las citas lleguen a tu Google Calendar con su enlace de Meet,
   > abre este link y autoriza con la cuenta de Google de ese calendario (toma
   > un minuto). Si Google te dice que la app no está verificada, toca
   > *Avanzado* → *Ir a LanCo Agenda*. Ábrelo en Chrome o Safari, no dentro de
   > Instagram o Facebook. {link}

6. **Comprueba.** *Ajustes → Agenda → Probar* debe decir «Conexión correcta —
   calendario «…»». En el calendario principal, ese nombre es el correo de la
   cuenta: si no es la que esperabas, *Desconectar* y manda un link nuevo.

## 2. Qué ve el titular

1. `lanco.cloud`: «Conecta tu Google Calendar con {negocio}», qué se autoriza, el
   aviso de app sin verificar (mientras dure) y *Continuar con Google*. Si abrió
   el link dentro de una app, le pide abrirlo en el navegador (Google no deja
   autorizar desde ahí: `403 disallowed_useragent`).
2. Google: elige la cuenta y acepta el permiso de «LanCo Agenda».
3. Su CRM (`/conectar-google`): «Listo: tu calendario quedó conectado» con el
   nombre del calendario, o qué pasó y qué hacer.

## 3. Problemas frecuentes

| Lo que ve | Qué pasó | Qué hacer |
|---|---|---|
| «Este link ya se usó / venció / no es válido» | Un solo uso, 72 horas; generar otro revoca el anterior | Generar uno nuevo |
| «Cancelaste la autorización» / «Falta el permiso del calendario» | No aceptó en Google | Reabrir **el mismo** link: no se consumió |
| «Hay que terminar en el mismo navegador» | Cambió de navegador o tardó más de 15 min | Reabrir el mismo link y terminar ahí |
| «Tu empresa no permite esta conexión» | Workspace con apps externas bloqueadas | El admin de Workspace permite la app por su ID de cliente (*Consola de administración → Seguridad → Controles de API → Control de acceso de apps*), o usar otra cuenta |
| «La conexión no pasó la prueba» | Canje o prueba fallidos | Ver el log de la instancia (`[google-link] …`): un `401` es el secreto mal copiado en la variable |
| «La conexión no pasó la prueba» al reconectar un negocio que apuntaba a otro calendario (el log dice «el calendario destino no es `primary`…») | El permiso de LanCo Agenda solo alcanza los calendarios **propios** de la cuenta que autoriza, y el destino guardado es de otra cuenta | Autorizar con la cuenta dueña de ese calendario, o *Desconectar* (el destino vuelve a `primary`) y mandar un link nuevo |
| Error de Google `redirect_uri_mismatch` | El URI del cliente no es idéntico a `GOOGLE_OAUTH_REDIRECT_URI` | Igualarlos (sin barra final) |
| Google `403 disallowed_useragent` | Link abierto dentro de una app | Abrirlo en Chrome o Safari |
| En Ajustes, la conexión aparece rota | El titular quitó el acceso, o se rotó el secreto | Mandar un link nuevo |

## 4. Rotar el secreto y dar de baja

- **Rotar**: en el cliente OAuth, *Añadir secreto* → actualizar
  `GOOGLE_OAUTH_CLIENT_SECRET` → reiniciar → mandar un link nuevo (la conexión
  guardada lleva copia del secreto con el que se hizo) → deshabilitar el secreto
  viejo cuando el titular haya reconectado.
- **Baja de un negocio**: borrar su cliente OAuth (todos sus permisos mueren a la
  vez, sin tocar a nadie más), quitar su host de `data/flota.ts` y las tres
  variables de su instancia.

## 5. Verificación de Google (quita el aviso de «app no verificada»)

Mientras no esté verificada, la app funciona igual, pero el titular ve el aviso y
Google aplica un tope de 100 usuarios, de por vida, a las apps sin verificar
(irrelevante con el tamaño de la flota). `calendar.events.owned` es **sensible**,
no restringido: no hay evaluación de seguridad de terceros.

Son dos revisiones y van **en este orden**: Google no deja pedir la del permiso
sin la marca publicada.

**Estado al 2026-09-28** (consola revisada):

- Search Console: `lanco.cloud` verificado como propiedad de dominio por
  `ponwo10@gmail.com`, propietario del proyecto ✓.
- Página de la app (`lanco.cloud/google-calendar`) y sección 9 de
  `lanco.cloud/politica-privacidad`, con la declaración de uso limitado ✓.
- **Revisión de marca en curso, manual**: la privacidad ya pasó (2026-09-28); la
  página principal y los lineamientos de marca, en revisión. La consola calcula
  de 4 a 6 semanas, con el primer correo en 3 a 5 días.

### 5.1 Mientras revisan la marca

- **No tocar *Información de la marca*.** No se puede editar durante la
  revisión: habría que cancelarla. Eso incluye el logo.
- Vigilar `contacto@lanco.cloud` (el contacto del desarrollador; también el
  spam) y `ponwo10@gmail.com`. Google escribe ahí, y se le contesta en el mismo
  hilo.
- Grabar el video (§5.3) con el permiso definitivo ya desplegado.

### 5.2 Cuando la marca quede publicada

1. *Acceso a los datos* → *Agregar o quitar permisos* →
   `https://www.googleapis.com/auth/calendar.events.owned` → Guardar.
2. *Centro de verificación* → pedir la verificación del acceso a los datos, con
   la justificación (§5.4) y el link del video.
3. Al aprobarse: `APP_VERIFICADA = true` en `modules/googleCalendar.ts` de
   `lanco-ws` (quita el aviso de la página) y desplegar el sitio.

### 5.3 El video de demostración

YouTube, **no listado**, de punta a punta. Google exige ver el proceso de
autorización **en inglés**, el nombre «LanCo Agenda» en la pantalla de
consentimiento, el **ID de cliente en la barra de direcciones** y el uso de cada
permiso en detalle.

- Poner en inglés la cuenta de Google del titular mientras se graba (p. ej.
  `lanco.dmd@gmail.com`), y quitarle antes el acceso a LanCo Agenda para que el
  recorrido salga completo.
- En la pantalla de consentimiento, hacer clic en la barra de direcciones para
  que se lea el `client_id`.
- Subtítulos en inglés en cada paso: Uniko está en español.
- Se graba con Win+Shift+R (Recortes) u OBS.

| # | Qué se ve | Subtítulo |
|---|---|---|
| 1 | Uniko → *Ajustes → Agenda → Generar link* | The business owner generates a one-time link in Uniko, their WhatsApp CRM. |
| 2 | El link abre la página de `lanco.cloud` → *Continuar con Google* | The calendar owner opens the link. The page explains what LanCo Agenda will access. |
| 3 | Elegir la cuenta; la pantalla de consentimiento completa; clic en la barra de direcciones; aceptar | Google's consent screen: LanCo Agenda requests a single permission. The OAuth client ID is visible in the address bar. |
| 4 | La página «calendario conectado» | Connected. The grant is stored encrypted on the business's own CRM server. |
| 5 | *Ajustes → Agenda → Probar* | The connection check reads only the calendar's name. |
| 6 | Agendar una cita (en Uniko o por WhatsApp con el asistente) → el evento con su Meet en Google Calendar | An appointment booked through WhatsApp creates an event with a Google Meet link in the owner's calendar. |
| 7 | Moverla → el evento se mueve; cancelarla → el evento desaparece | Rescheduling moves the event. Cancelling deletes it. |
| 8 | Cuenta de Google → *Seguridad → Apps de terceros* → LanCo Agenda → *Quitar acceso* | The owner can revoke access at any time from their Google Account. |

### 5.4 Justificación del permiso (en inglés, para pegar)

> LanCo Agenda creates, updates and deletes the Google Calendar events of the
> appointments that a business books through its WhatsApp CRM (Uniko), each with
> a Google Meet link, so the appointments appear on the calendar the business
> owner already uses to plan their day.
>
> We request only `calendar.events.owned`: the narrowest scope that allows
> inserting events with conference data and moving or deleting them, limited to
> calendars the user owns. `calendar.events` would also reach calendars that
> other people share with the user, which the app does not need. Read-only
> scopes cannot create events. `calendar.app.created` would confine the
> appointments to a secondary calendar created by the app, away from the owner's
> own calendar, where they see and plan their day.
>
> The app never reads the user's other events: the connection check requests
> only the calendar's `summary` field (its name). The refresh token is stored
> encrypted on the business's own CRM server and is deleted when the user
> disconnects.
