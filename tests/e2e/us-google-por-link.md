# E2E — Conexión de Google Calendar por link (029)

Guion de comportamiento observable. Automatizado en la sección `029` de
`scripts/e2e-selftest.mjs` (`googleLinkChecks()`): con la app viva y los mocks
encendidos, `pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación** (`specs/029-google-por-link/quickstart.md` §1): app en
`localhost` con `WA_MOCK_ENABLED=true`, `AGENDA=on`, los conectores apuntando a
`google-mock` (`GOOGLE_CAL_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`) y la app de agencia
contra los mocks: `GOOGLE_AUTH_URL` → `…/api/dev/google-mock/auth`,
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y
`GOOGLE_OAUTH_REDIRECT_URI` → `…/api/dev/lanco-relay-mock` (el relevo de
`lanco.cloud` de mentira). Las mismas variables, exportadas en la shell del
arnés. Contrato del otro lado: `contracts/relevo-lanco-cloud.md`.

El "navegador" del titular es un `fetch` **sin la sesión del operador**, con su
propio tarro de cookies y las redirecciones a mano. Los caminos infelices se
eligen con `mock_decision` en la URL de Google.

---

## US5 — Sin la app de agencia (o sin agenda), no existe

1. `GET/POST /api/settings/google/link`, `GET /api/google/oauth/start`,
   `GET /api/google/oauth/callback` y `GET /conectar-google` responden **404**.
2. La conexión manual de Google (bloque 015) sigue igual.

## US1 — El titular conecta su calendario con un link

1. El dueño genera un link: **201**, llave opaca de 43 caracteres, vence a las
   72 horas. `GET` del link muestra el pendiente y su vencimiento, **nunca la
   llave**, y `usedAt` nulo.
2. Un miembro que no es dueño ve la sección sin poder manejarla y recibe **403**
   al generar o revocar.
3. Recorrido sin sesión: inicio → Google (mock) → relevo (mock) → retorno →
   `/conectar-google?estado=ok`. La página dice «quedó conectado» y el nombre del
   calendario, que llegó por cookie: **ninguna redirección lo lleva**.
4. A Google se le pidió `calendar.events.owned` (solo los calendarios propios
   de quien autoriza), `access_type=offline`, `prompt=consent`, con el cliente y
   el URI de la configuración; la respuesta pasó por el relevo.
5. La conexión quedó con el cliente de la agencia; **ninguna respuesta** lleva el
   secreto ni el refresh token (solo los últimos 4 del secreto). «Probar» pasa y
   nombra el calendario; la agenda quedó entregando por Google.
6. Una cita por la API de servicio crea su evento con Meet en el mock — y el
   contador del relevo **no se mueve**: la operación no pasa por `lanco.cloud`.
7. El mismo link otra vez → `link_usado`, y ya no hay link pendiente; el `GET`
   dice cuándo se usó (`usedAt`).
8. `/conectar-google?estado=<script>…` muestra el mensaje genérico, sin eco.

### En la pantalla: abrir el link ahí mismo (FR-1429)

Lo recorre el navegador de vista previa (el arnés no conduce la pantalla):

1. *Ajustes → Agenda → Google Calendar + Meet → Generar link*: junto al link y
   *Copiar*, **Conectar mi calendario** con su aviso: «Se abre `lanco.cloud` en
   otra pestaña…» con página de aterrizaje, «Se abre Google…» sin ella. Es un
   enlace a otra pestaña (`target=_blank`, `rel="noopener noreferrer"`).
2. En la otra pestaña, el recorrido termina en «quedó conectado».
3. De vuelta en la primera pestaña, sin recargar: el link desaparece, la sección
   dice «Listo: Google quedó conectado», la tarjeta muestra la conexión
   (*Actualizar*, *Desconectar*) y *Probar* nombra el calendario. Al recargar:
   «Último link: usado el…».
4. Si en la otra pestaña se cancela en Google, al volver el link sigue a la
   vista: sigue sirviendo.

## US2 — Si algo sale mal, nada se rompe

Con una conexión manual previa guardada (`manual-previo…`), el mismo link
recorrido con cada decisión termina en su motivo **y la conexión previa sigue
intacta**:

| Decisión | Motivo |
|---|---|
| cancelar en Google | `cancelado` |
| desmarcar el permiso de calendario | `permiso_incompleto` |
| política de la empresa | `politica_empresa` |
| Google caído en el canje | `google_no_respondio` |
| Google sin refresh token | `prueba_fallida` |
| terminar en otro navegador (sin la cookie) | `otro_navegador` |
| `state` manipulado | `link_invalido` |

Después de los siete, el link **sigue pendiente**.

**El calendario destino es de otra cuenta.** El permiso de la app solo alcanza
los calendarios propios de quien autoriza. Con la conexión manual previa
apuntando a un calendario compartido (`compartido@group.calendar.google.com`,
que el acceso manual `calendar.events` del mock sí alcanza), el link termina en
`prueba_fallida` y la conexión previa —con su calendario— sigue intacta.

De vuelta al calendario principal, el mismo link todavía conecta, reemplazando la
conexión previa.

## US3 — El operador controla sus links

1. Generar otro invalida el anterior (`link_invalido`).
2. Revocar el pendiente → `revoked: 1`, y ese link queda `link_invalido`; el
   `GET` no lo toma por usado (`usedAt` nulo).
3. Desconectar Google no revive un link usado: sigue `link_usado` (FR-1409).

## US4 — El relevo solo reenvía dentro de la flota

El mock del relevo responde **400 sin `Location`** a un `state` cuyo `ret` es un
origen fuera de la lista o trae una ruta colada. (El sitio real se verifica
aparte: `npm run build` y el recorrido de `quickstart.md` §5.)
