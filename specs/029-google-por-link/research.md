# Research — 029 Conexión de Google Calendar por link (modelo agencia)

**Fecha**: 2026-09-27 · **Spec**: [spec.md](spec.md)

Hechos de Google verificados contra su documentación el 2026-09-27
([OAuth 2.0 para aplicaciones de servidor web](https://developers.google.com/identity/protocols/oauth2/web-server),
[requisitos de verificación](https://support.google.com/cloud/answer/13464321)):

- El permiso de larga duración (refresh token) solo llega con `access_type=offline`,
  y vuelve a llegar a quien ya había autorizado solo si se pide `prompt=consent`.
- La respuesta del canje trae `scope` (los permisos **concedidos**, separados por
  espacio) y `refresh_token`.
- Con varios permisos pedidos, el usuario puede conceder solo algunos (permisos
  granulares): la app debe comprobar `scope`. Aquí se pide uno solo, pero la
  comprobación es barata y cubre cambios futuros de la pantalla de Google.
- Cancelar vuelve con `error=access_denied`; una cuenta de Workspace con apps
  externas bloqueadas, con `admin_policy_enforced`.
- Google rechaza la autorización dentro de navegadores embebidos
  (`disallowed_useragent`): Instagram, Facebook, LINE y similares abren los links en
  uno. No hay configuración que lo evite.
- Verificación de una app con permisos **sensibles**: página principal en un dominio
  verificado que describa la app (no solo un login) y enlace a la política de
  privacidad del mismo dominio, que declare el uso de datos de Google; dominios
  autorizados verificados en Search Console por un propietario del proyecto; video
  de demostración de punta a punta **con la pantalla de consentimiento en inglés**;
  justificación del permiso. `calendar.events` es sensible, no restringido: sin
  evaluación de seguridad de terceros. (Desde el 2026-09-28 la app pide
  `calendar.events.owned`, también sensible: ver D6.)

## D1. Dónde se canjea el permiso: en la instancia

**Decisión**: la instancia recibe la respuesta de Google (directa o a través del
relevo de `lanco.cloud`) y canjea el `code` ella misma con el secreto de SU cliente
OAuth.

**Rationale**: el secreto ya tiene que vivir en la instancia (lo usa en cada
renovación), así que canjear ahí no mueve ningún secreto a ningún sitio nuevo. El
`code` que ve `lanco.cloud` no sirve sin ese secreto. Es la única variante en la que
ni `lanco.cloud` ni una persona tocan un token.

**Alternativas descartadas**:

- *n8n canjea y guarda (como Meta)*: el permiso de cada cliente y los secretos de
  todos viviendo en un sistema central de LanCo, y un humano copiándolos. Descartada
  por el dueño el 2026-09-27.
- *La página muestra el refresh token para pegarlo*: sin almacén central, pero con el
  token en el portapapeles y en la pantalla de alguien, y con los tres datos a pegar
  a mano en Uniko. Peor experiencia y peor postura.
- *Intermediario en runtime* (la instancia pide el acceso a `lanco.cloud`): quita el
  secreto de las instancias pero mete una dependencia central en cada cita.
- *Función de servidor en `lanco.cloud`*: el sitio es estático (Vite + nginx);
  añadirle servidor solo para reenviar no aporta nada que el navegador no haga.

## D2. Un cliente OAuth por negocio, configurado por despliegue

**Decisión**: cada negocio tiene su propio cliente OAuth (tipo *Aplicación web*)
dentro del proyecto LanCo Robotics (`lanco-robotics`), con `https://lanco.cloud/google-calendar/callback`
como único URI de redirección. Su identificador y secreto se configuran en la
instancia como variables de entorno: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Al conectar, se copian a
la fila de credenciales de la 015 (el secreto, cifrado), de modo que **el conector no
cambia**: renueva el acceso exactamente igual que con la conexión manual.

**Rationale**: "una instancia = un negocio", así que la configuración de la instancia
es la del negocio. El operador ya configura así los módulos (`AGENDA`, `STOCK_*`).
Aislar por cliente acota una fuga a un negocio y permite dar de baja a uno borrando
su cliente OAuth: todos sus permisos mueren a la vez, sin tocar a nadie más.

**Alternativas descartadas**:

- *Un solo cliente compartido*: su secreto en todas las instancias; una fuga
  compromete a todos y rotarlo es tocar la flota.
- *Cliente y secreto pegados en la pantalla*: exigiría guardar un secreto antes de
  tener permiso (columna o tabla nueva para un estado "a medias") y expondría el
  secreto de la agencia a cualquier dueño de la cuenta. El operador es quien lo
  maneja; su sitio es la configuración del despliegue.
- *Leer el secreto de la variable en cada renovación* (en vez de copiarlo a la fila):
  la rotación sería transparente, pero el conector tendría dos fuentes de verdad
  según cómo se conectó. Se prefiere que el conector siga sin saber nada de esto; al
  rotar el secreto se manda un link nuevo (Google permite dos secretos vigentes a la
  vez durante la rotación).

## D3. El link: llave opaca de un solo uso en un registro

**Decisión**: 32 bytes aleatorios en base64url (43 caracteres). La instancia guarda
solo su SHA-256 en la tabla `google_link` junto con organización, quién lo generó,
vencimiento (72 h), `used_at` y `revoked_at`. Generar uno revoca los pendientes de la
organización (en la misma transacción). Consumirlo es un `UPDATE … WHERE used_at IS
NULL AND revoked_at IS NULL RETURNING`, que resuelve la carrera de dos pestañas.

**Rationale**: la spec exige que un link usado no reviva nunca (FR-1409), que se pueda
revocar (US3) y que el link se muestre una sola vez (FR-1408). Las tres cosas
necesitan estado. Y una llave opaca es más corta que un JWT (el link viaja por
WhatsApp) y no revela nada al leerla.

**Alternativas descartadas**:

- *JWT sin estado, válido si no hay conexión o si es más nuevo que la última*: al
  desconectar Google la fila se borra y un link ya usado vuelve a ser válido —
  justo el escenario de un link filtrado que alguien usó y el operador desconectó.
  Tampoco permite revocar.
- *JWT + "lápida" al desconectar* (no borrar la fila, marcarla): arregla la
  resurrección cambiando la semántica de `DELETE` y de `getGoogleCredentials`, y un
  `markGoogleError` (que actualiza `updated_at`) mataría links sin que nadie los
  usara. Semántica sutil donde se esconden los fallos.
- *Marca en `organization.metadata`*: es el JSON de la marca; mezclar
  responsabilidades y escribir con leer-modificar-escribir sobre el mismo campo.

**Costo aceptado**: una migración aditiva (tabla nueva) y su ensayo del Principio X.

## D4. El parámetro `state`: firmado, legible por el relevo, atado al navegador

**Decisión**: `state` es un JWT HS256 con `ret` (origen de la instancia), `lnk`
(id del link), `nh` (SHA-256 de un nonce), `iat` y `exp` = 15 min. La clave se deriva
con HKDF-SHA256 de `BETTER_AUTH_SECRET` con propósito propio
(`uniko/029/google-oauth-state`). El nonce va en una cookie `HttpOnly`,
`SameSite=Lax`, `Secure` en HTTPS, con ruta `/api/google/oauth` y 15 min de vida.

**Rationale**: Google solo devuelve `state` (el URI de redirección debe coincidir
exacto, así que no puede llevar parámetros variables), de modo que la dirección de la
instancia tiene que viajar ahí. El relevo lee la carga útil del JWT sin clave
(base64url) y la instancia verifica la firma: manipular `ret` o `lnk` rompe la firma.
La cookie impide que otro navegador termine un flujo ajeno. `SameSite=Lax` viaja en
la navegación de nivel superior que hace el relevo hacia la instancia.

**Alternativas descartadas**: *`state` opaco con registro en base* — el relevo no
podría saber a dónde reenviar; *una variable nueva para la clave* — más configuración
por instancia sin ganancia: HKDF separa el propósito sin tocar el uso actual del
secreto.

## D5. El relevo de `lanco.cloud`

**Decisión**: una ruta estática del sitio (`/google-calendar/callback`) que lee
`state`, decodifica `ret`, exige `https:` y que el host esté en la lista de la flota
(`data/flota.ts` del repo `lanco-ws`) y hace `location.replace(ret +
"/api/google/oauth/callback" + location.search)` — la consulta completa, tal cual,
también cuando trae `error`. Si algo no cuadra, muestra un error y no redirige.

**Rationale**: es lo mínimo que resuelve el problema (un solo URI registrado para
toda la flota) sin servidor, sin almacenamiento y sin secretos. La lista de la flota
evita que el sitio de LanCo sirva de redirector abierto.

**Contrato**: [contracts/relevo-lanco-cloud.md](contracts/relevo-lanco-cloud.md).

## D6. Parámetros de la autorización

**Decisión**: `response_type=code`, `scope=https://www.googleapis.com/auth/calendar.events`,
`access_type=offline`, `prompt=consent`, `state`, sin `include_granted_scopes`.

**Rationale**: el permiso mínimo de la 015; `prompt=consent` garantiza el refresh
token aunque el titular ya hubiera autorizado antes (p. ej. al reconectar).

**Revisión 2026-09-28 — el permiso pasa a `calendar.events.owned`** (decisión del
dueño, al preparar la verificación). Google exige, para verificar un permiso
sensible, «explicar por qué no basta uno más estrecho», y `calendar.events` ya no es
el más estrecho: `calendar.events.owned` («ver, crear, cambiar y borrar eventos en
los calendarios de Google que son tuyos») autoriza las cinco llamadas del conector
—`events.insert` con conferencia, `get`, `patch`, `delete` y `list`— según la
referencia de Calendar API, y encaja con el diseño: autoriza la cuenta dueña del
calendario. Se conserva todo lo demás de la decisión.

- *Qué se pierde*: escribir en un calendario que otra cuenta compartió con quien
  autoriza. El link no ofrece elegir calendario (usa `primary` o conserva el que
  había); un destino conservado ajeno termina en `prueba_fallida` sin guardar nada,
  y el log lo explica. La conexión manual (015) sigue con `calendar.events`.
- *Comprobación del `scope` concedido* (D7): vale `calendar.events.owned` **o**
  `calendar.events`, por comparación exacta (`.owned.readonly` no deja crear nada).
  Aceptar el amplio evita dar por incompleta una concesión que cubre de sobra lo que
  se usa.
- *Descartadas*: seguir con `calendar.events` y argumentar calendarios compartidos
  (el link no los ofrece: la justificación no se sostenía); `calendar.app.created`
  (más estrecho aún, pero las citas vivirían en un calendario secundario creado por
  la app, lejos del calendario donde el dueño planea su día).
- Las conexiones hechas antes con `calendar.events` siguen funcionando: el permiso
  concedido no cambia al cambiar lo que se pide.

## D7. Qué se comprueba antes de guardar, y en qué orden

**Decisión**: firma y vigencia de `state` → cookie → `error` de Google → link todavía
vigente → canje → `scope` alcanza (`calendar.events.owned` o `calendar.events`; ver
D6) → trae `refresh_token` → prueba
de conexión (`events.list`, la misma de "Probar") → **transacción**: consumir el link
+ guardar credenciales → fuera de ella, conector de la agenda a `google`.

**Rationale**: todo lo que puede fallar por culpa de Google o del titular pasa antes
de tocar la base; la transacción garantiza que no hay link consumido sin conexión ni
conexión sin link consumido (FR-1416, FR-1419). El cambio de conector va después
porque reutiliza `upsertSettings` (con sus validaciones) y su fallo —improbable— no
invalida la conexión: se registra y el operador lo ve.

## D8. La página de resultado vive en la instancia

**Decisión**: `/conectar-google?estado=<motivo>` pública, con la marca de la
instancia; el nombre del calendario conectado viaja en una cookie de un solo
propósito (`HttpOnly`, ruta `/conectar-google`, 2 min), nunca en la dirección. Los
motivos son un catálogo cerrado; un valor desconocido muestra el mensaje genérico.

**Rationale**: la instancia es quien sabe qué pasó; mostrarlo en `lanco.cloud`
exigiría pasarle el resultado o volver a depender de él. FR-1421 prohíbe datos
personales en la dirección.

## D9. Configuración: todo o nada, y direcciones de prueba

**Decisión**: con `AGENDA` encendida, las tres `GOOGLE_OAUTH_*` van juntas (una o dos
impiden arrancar, nombrando la que falta); `GOOGLE_OAUTH_REDIRECT_URI` debe ser una
URL `https:` salvo `localhost`. Dos opcionales: `GOOGLE_ONBOARDING_URL` (la página de
aterrizaje; sin ella el link va directo a la instancia) y `GOOGLE_AUTH_URL` (el
endpoint de autorización, por defecto el de Google; se sobreescribe para el mock).

**Rationale**: el mismo trato que `INVENTARIO` (026). Una configuración a medias es un
error de despliegue y se ve en el healthcheck, no en la cara del titular.

## D10. Permisos y conector

- **Generar y revocar: solo el rol `owner`**, como marca, equipo y canales. El link es
  una llave que se comparte fuera.
- **Al conectar por link, el conector pasa a `google`** (FR-1418): la tarjeta de Google
  es donde se genera el link, y una conexión de Google con la agenda en "enlace fijo"
  fue la trampa del 2026-09-23.

## D11. Mocks y arnés

**Decisión**: el `google-mock` gana el endpoint de autorización (`GET …/auth`) y el
canje `authorization_code` en `/token`, con decisiones deterministas por parámetro
(`mock_decision=approve|deny|partial|no_refresh|policy|exchange_down`) y códigos de un
solo uso atados a `client_id` y `redirect_uri`. Un mock nuevo,
`/api/dev/lanco-relay-mock`, implementa el mismo contrato que el relevo de
`lanco.cloud` (con la lista = el propio origen). El arnés recorre el flujo con
`fetch` y redirecciones manuales, como un navegador sin sesión.

**Rationale**: el arnés tiene que ejercer el camino real —incluido el relevo— y los
caminos infelices deterministas, sin Google ni `lanco.cloud`.

## D12. Constitución y ADR

**Decisión**: ADR-004 y enmienda **1.8.0 (MINOR)** del Principio II.3.4. Texto en
[enmienda-constitucional.md](enmienda-constitucional.md).

**Rationale**: la identidad de la app pasa a ser de LanCo, que es lo que la condición
4 prohíbe hoy ("jamás credenciales de una plataforma central"). La enmienda acota la
excepción a lo que esta feature cumple: cliente por negocio, permiso solo en la
instancia, lo central solo en el alta, y el camino propio (BYO) siempre disponible.
MINOR porque amplía con condiciones; ninguna instancia ni spec existente queda fuera.

## D13. Página de aterrizaje: navegadores de apps

**Decisión**: detectar por *user agent* los navegadores embebidos conocidos
(`FBAN`, `FBAV`, `FB_IAB`, `Instagram`, `Line/`, `WhatsApp`, `TikTok`/`musical_ly`,
`Snapchat`, y la marca `; wv)` de WebView en Android) y, en ese caso, pedir abrir en
el navegador del teléfono con botón para copiar el link, en vez del botón de Google.

**Rationale**: Google responde `403 disallowed_useragent` en esos navegadores; es
mejor decirlo antes que dejar al titular frente a un error de Google.

## D14. Verificación de Google: qué entrega esta feature

**Decisión**: en `lanco.cloud`, una página de la app (`/google-calendar` sin
parámetros describe «LanCo Agenda» y enlaza la política) y la cláusula de datos de
Google en la política de privacidad (declaración de uso limitado). La guía
[`docs/google-agencia.md`](../../docs/google-agencia.md) cubre el resto, que es
manual: renombrar la app, verificar `lanco.cloud` en Search Console (registro TXT en
Cloudflare), subir el logo **solo al enviar a verificación** (subirlo antes la mete
al trámite), guion del video con la pantalla en inglés y texto de justificación.
