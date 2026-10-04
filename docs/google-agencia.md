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
   - **Logo: al final** (§5.2, paso 5). Subirlo manda la marca a revisión otra
     vez, y con la marca en revisión no se puede editar ni pedir la verificación
     del permiso.
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
   > un minuto). Ábrelo en Chrome o Safari, no dentro de Instagram o Facebook.
   > {link}

   Si el calendario es tuyo, o estás frente a la computadora del titular, no
   hace falta copiarlo: *Conectar mi calendario* lo abre ahí mismo en otra
   pestaña (pasa por `lanco.cloud`) y conecta **la cuenta de Google que se elija
   ahí**. Al volver a *Ajustes*, la sección dice si quedó conectado.
6. **Comprueba.** *Ajustes → Agenda → Probar* debe decir «Conexión correcta —
   calendario «…»». En el calendario principal, ese nombre es el correo de la
   cuenta: si no es la que esperabas, *Desconectar* y manda un link nuevo. Sin
   link a la vista, la sección dice «Último link: usado el…» cuando el
   titular terminó.

## 2. Qué ve el titular

1. `lanco.cloud`: «Conecta tu Google Calendar con {negocio}», qué se autoriza y
   *Continuar con Google* (ya sin aviso de «app no verificada»: Google la verificó
   el 2026-10-04). Si abrió
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

**Verificada: Google aprobó `calendar.events.owned` el 2026-10-04** (proyecto
`lanco-robotics`). Ya no sale el aviso de «app no verificada» ni rige el tope de
100 usuarios. Lo que sigue en esta sección queda como registro de cómo se llegó y
como guía si hay que volver a pasar por esto (un permiso nuevo, o cualquier cambio
a la pantalla de consentimiento, exige otra verificación: la aprobación no se
hereda).

Antes de aprobarse, la app funcionaba igual, pero el titular veía el aviso y
Google aplicaba el tope. `calendar.events.owned` es **sensible**, no restringido:
no hay evaluación de seguridad de terceros.

Son dos revisiones y van **en este orden**: Google no deja pedir la del permiso
sin la marca publicada.

**Historia (2026-09-29 → 10-04)**:

- **Marca**: verificada el 2026-09-29 (un día).
- **Permiso**: pedido el 2026-09-29; tres rondas hasta la aprobación del
  2026-10-04. Lo que Google objetó, y por tanto lo que el video debe mostrar:
  1. *Flujo de consentimiento*: la cuenta de grabación aún tenía acceso concedido,
     y Google mostró «LanCo Agenda ya tiene acceso parcial» en vez de la pantalla
     de otorgamiento, y en español. Se regrabó con el acceso borrado y la cuenta
     en English.
  2. *Mínimo privilegio*: pidió el consentimiento **con el permiso expandido**
     («See access details»), el **efecto en la cuenta de Google** (crear, mover y
     **borrar** un evento, vistos en Calendar), el permiso idéntico al declarado
     en la consola, y **por qué no basta uno más estrecho** (la §5.4 lo
     argumenta). Se respondió **por el hilo del correo** y se actualizó el vínculo
     del video en *Acceso a los datos*.
  3. Aprobada.
- El ID de cliente en la barra de direcciones **no** lo exige Google (su guía no lo
  menciona); no estorba, pero no cuenta como requisito.

**Estado al 2026-09-29** (previo a pedir el permiso):

- Search Console: `lanco.cloud` verificado como propiedad de dominio por
  `ponwo10@gmail.com`, propietario del proyecto ✓.
- Página de la app (`lanco.cloud/google-calendar`) y sección 9 de
  `lanco.cloud/politica-privacidad`, con la declaración de uso limitado ✓.
- **Marca verificada el 2026-09-29** ✓ (revisión manual de un día; la consola
  calculaba de 4 a 6 semanas).
- **Permiso: sin pedir todavía.** El *Centro de verificación* dice «No se
  requiere la verificación» solo porque aún no hay permisos declarados en
  *Acceso a los datos*; al declararlo, la pide (§5.2).

### 5.1 La marca

- **No tocar *Información de la marca*** (nombre, URLs, dominios, logo):
  cualquier cambio la manda a revisión otra vez, y con la marca en revisión no
  se puede editar ni pedir la verificación del permiso.
- Vigilar `contacto@lanco.cloud` (el contacto del desarrollador; también el
  spam) y `ponwo10@gmail.com`. Google escribe ahí, y se le contesta en el mismo
  hilo.

### 5.2 El permiso, y el logo al final

1. Grabar el video (§5.3) y subirlo a YouTube como **No listado** (uno privado
   no lo pueden ver los revisores).
2. *Acceso a los datos* → *Agregar o quitar permisos* →
   `https://www.googleapis.com/auth/calendar.events.owned` (si no aparece en la
   tabla, en *Agregar permisos manualmente*) → *Actualizar* → *Guardar*. Queda
   en «Tus permisos sensibles». Si esa página pide ahí mismo la justificación o
   el video, van la §5.4 y el link.
3. *Centro de verificación* → pedir la verificación del acceso a los datos, con
   la justificación (§5.4) y el link del video. Es sensible, no restringido: no
   hay evaluación de seguridad.
4. Al aprobarse: `APP_VERIFICADA = true` en `modules/googleCalendar.ts` de
   `lanco-ws` (quita el aviso de la página) y desplegar el sitio. Hecho el
   2026-10-04 (ponwo/lanco-ws#16).
5. **El logo, opcional y al final**: cuadrado de 120×120 px, PNG, JPG o BMP,
   máximo 1 MB; el de LanCo, sin nada que se parezca a los logos de Google (ni
   al ícono de Google Calendar). Manda la marca a una revisión más, y la app
   sigue funcionando mientras tanto: la prueba en vivo del 2026-09-28 se hizo
   con la marca en revisión.

### 5.3 El video de demostración

YouTube, **no listado**, de punta a punta. Google exige ver el proceso de
autorización **en inglés**, el nombre «LanCo Agenda» en la pantalla de
consentimiento, el permiso **expandido y legible** («See access details» abierto),
el uso de cada permiso en detalle y su **efecto en la cuenta de Google** (el
evento creado, movido y borrado, visto en Calendar). Lo que aprobó el 2026-10-04
fue el tercer video, con esas piezas.

- **Quitar de verdad el acceso antes de grabar** (*Seguridad → Apps de terceros →
  LanCo Agenda → Eliminar todas las conexiones*) y comprobar que ya no aparece.
  Si no, Google muestra «LanCo Agenda ya tiene acceso parcial» y no la pantalla
  de otorgamiento: fue el primer rechazo.
- Poner en inglés la cuenta de Google del titular mientras se graba (p. ej.
  `lanco.dmd@gmail.com`).
- En la pantalla de consentimiento, **pulsar «See access details»** y dejar el
  permiso expandido unos 5 s.
- Al terminar de grabar, comprobar el video en una ventana de incógnito y
  **responder por el hilo del correo** de Google (no con un correo nuevo),
  actualizando también el vínculo en *Acceso a los datos*.
- Antes del consentimiento sale «Google hasn't verified this app»: es normal
  mientras no aprueben el permiso. *Advanced → Go to LanCo Agenda (unsafe)*, en
  cámara.
- Opcional: clic en la barra de direcciones para que se lea el `client_id`.
- Subtítulos en inglés en cada paso: Uniko está en español.
- Se graba con Win+Shift+R (Recortes) u OBS.
- **El paso 8 de verdad deja a uniko-lanco sin Google**: las citas reales dejan
  de crear su evento. Al terminar, reconectar con un link nuevo — o mostrar el
  botón sin pulsarlo.

| # | Qué se ve | Subtítulo |
|---|---|---|
| 1 | Uniko → *Ajustes → Agenda → Generar link* | The business owner generates a one-time link in Uniko, their WhatsApp CRM. |
| 2 | *Conectar mi calendario* → se abre la página de `lanco.cloud` → *Continuar con Google* | The calendar owner opens the link (here, straight from Uniko). The page on lanco.cloud explains what LanCo Agenda will access. |
| 3 | Elegir la cuenta; «Google hasn't verified this app» → *Advanced*; la pantalla de consentimiento completa; clic en la barra de direcciones; aceptar | Google's consent screen: LanCo Agenda requests a single permission. The OAuth client ID is visible in the address bar. |
| 4 | La página «calendario conectado» | Connected. The grant is stored encrypted on the business's own CRM server. |
| 5 | De vuelta en *Ajustes → Agenda*: «Listo: Google quedó conectado» → *Probar* | The connection check reads only the calendar's name. |
| 6 | Agendar una cita (en Uniko o por WhatsApp con el asistente) → el evento con su Meet en Google Calendar | An appointment booked through WhatsApp creates an event with a Google Meet link in the owner's calendar. |
| 7 | Moverla → el evento se mueve; cancelarla → el evento desaparece | Rescheduling moves the event. Cancelling deletes it. |
| 8 | Cuenta de Google → *Seguridad → Apps de terceros* → LanCo Agenda → *Quitar acceso* | The owner can revoke access at any time from their Google Account. |

### 5.4 Justificación del permiso (en inglés, para pegar)

Esta es la justificación inicial. En la segunda ronda Google pidió explicar «por
qué no basta un permiso más estrecho» en el correo de respuesta; la respuesta que
se aprobó reforzó el último párrafo con las alternativas: los permisos de solo
lectura (`.readonly`, `freebusy`) no pueden escribir; `calendar.events` abarca
calendarios ajenos; `calendar.app.created` separaría las citas en un calendario
secundario, lejos del principal donde el dueño planea su día.

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
