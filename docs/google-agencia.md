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
   - **Logo: todavía no.** Con la app externa y en producción, subir el logo la
     mete al trámite de verificación. Se sube al enviar a verificación (§5).
2. **Público (Audience)**: *Externo* y **En producción**. En modo prueba Google
   revoca el permiso a los 7 días y las citas se quedan sin enlace.
3. **Acceso a los datos (Data access)**: un solo permiso,
   `https://www.googleapis.com/auth/calendar.events` (sensible).

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

Mientras no esté verificada, la app funciona igual pero el titular ve el aviso y
Google aplica un tope de usuarios a las apps sin verificar (irrelevante con el
tamaño de la flota). `calendar.events` es **sensible**, no restringido: no hay
evaluación de seguridad de terceros.

**Ya se puede hacer (no depende del código):**

1. **Search Console**: verificar `lanco.cloud` como propiedad de dominio con el
   registro TXT que da Google, en el DNS de Cloudflare. Tiene que hacerlo una
   cuenta que sea propietaria o editora del proyecto LanCo Robotics
   (`ponwo10@gmail.com`).
2. **Página de la app y política de privacidad**: `lanco.cloud/google-calendar`
   y la sección 9 de `lanco.cloud/politica-privacidad` (declaración de uso
   limitado) — llegan con la PR de `lanco-ws`.

**Cuando el flujo esté en vivo:**

3. **Logo** (cuadrado, 120×120) — se sube al enviar.
4. **Video de demostración** (YouTube, no listado), de punta a punta. **Con la
   cuenta de Google en inglés**: Google exige ver la pantalla de consentimiento
   en inglés. Guion:
   1. Uniko → *Ajustes → Agenda → Generar link*.
   2. Abrir el link: la página de `lanco.cloud`, *Continuar con Google*.
   3. La pantalla de consentimiento completa, con «LanCo Agenda» y el ID de
      cliente visible en la barra de direcciones; aceptar.
   4. La página «calendario conectado».
   5. Agendar una cita en Uniko → el evento con su Meet en Google Calendar;
      moverla → el evento se mueve; cancelarla → el evento desaparece.
   6. Quitar el acceso desde la cuenta de Google.
5. **Justificación del permiso** (en inglés):

   > LanCo Agenda creates, updates and deletes the Google Calendar events of the
   > appointments a business books through its WhatsApp CRM (Uniko), each with a
   > Google Meet link. `calendar.events` is the narrowest scope that allows
   > inserting events with conference data and moving or deleting them;
   > read-only scopes cannot create events. The app never reads the user's
   > other events: the connection check requests only the calendar's `summary`
   > field.

6. Enviar desde *Google Auth Platform → Centro de verificación*.
7. Al aprobarse: `APP_VERIFICADA = true` en `modules/googleCalendar.ts` de
   `lanco-ws` (quita el aviso de la página) y desplegar el sitio.
