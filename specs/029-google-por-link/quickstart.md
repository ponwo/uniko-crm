# Quickstart — Verificar la 029 (conexión de Google por link)

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Guía del operador**:
[docs/google-agencia.md](../../docs/google-agencia.md)

## 1. En local, contra los mocks

Base desechable y `.env.local` temporal (gitignored; ver las memorias
`worktree-y-arneses-en-la-maquina-de-desarrollo` y
`agenda-e2e-local-necesita-urls-de-mocks`):

```bash
DATABASE_URL=postgresql://…/uniko_dev_e2e029   # pnpm db:dev la crea y migra
WA_MOCK_ENABLED=true
AGENDA=on
ZOOM_BASE_URL=http://localhost:3000/api/dev/zoom-mock
ZOOM_OAUTH_BASE_URL=http://localhost:3000/api/dev/zoom-mock
GOOGLE_CAL_BASE_URL=http://localhost:3000/api/dev/google-mock
GOOGLE_OAUTH_BASE_URL=http://localhost:3000/api/dev/google-mock
# 029 — la app de agencia, contra los mocks
GOOGLE_AUTH_URL=http://localhost:3000/api/dev/google-mock/auth
GOOGLE_OAUTH_CLIENT_ID=cli-agencia.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=secreto-agencia-de-prueba
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/dev/lanco-relay-mock
```

Exportar las mismas variables en la shell del arnés. Sin `GOOGLE_ONBOARDING_URL` el link
va directo a la instancia; el relevo se ejercita igual, porque el URI de redirección
apunta al mock del relevo.

## 2. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

## 3. Arnés

```bash
pnpm test:e2e
```

El bloque **"029: conexión de Google por link"** debe salir entero en OK:

- dueño genera link (201, forma del link, vencimiento a 72 h) y la pantalla ve el
  pendiente sin la llave;
- un miembro que no es dueño recibe 403;
- recorrido completo sin sesión: `start` → mock de Google → mock del relevo →
  `callback` → `/conectar-google?estado=ok`, con la cookie del calendario;
- la conexión quedó guardada con el cliente de la agencia, "Probar" pasa, el conector
  es `google` y una cita crea su evento en el mock;
- el mismo link otra vez → `link_usado`; y tras desconectar Google, sigue `link_usado`;
- regenerar revoca el anterior; revocar a mano deja el link en `link_invalido`;
- cancelar en Google → `cancelado` y el link sigue sirviendo;
- permiso incompleto → `permiso_incompleto`; política de empresa →
  `politica_empresa`; canje caído → `google_no_respondio`; sin refresh token →
  `prueba_fallida` — y en todos la conexión previa intacta;
- `callback` sin la cookie → `otro_navegador`; `state` manipulado → `link_invalido`;
- *(desde el 2026-09-28)* a Google se le pide `calendar.events.owned`, y un
  calendario destino conservado que es de otra cuenta (el compartido del mock) →
  `prueba_fallida`, con la conexión previa y su calendario intactos;
- el relevo se niega a reenviar a un origen fuera de su lista.

Con la agenda encendida **sin** la app de agencia, el bloque verifica las cinco
superficies en 404 y termina. Con la agenda apagada, las cinco en 404.

**Registro (2026-09-27, local, `next dev`, base desechable por corrida)**:

| Configuración | Arnés completo | Bloque 029 |
|---|---|---|
| `AGENDA=on` + app de agencia contra los mocks | **251/251** | 39/39: feliz, siete infelices con la conexión previa intacta, controles del dueño, dos links generados a la vez (tras la revisión de código), relevo |
| `AGENDA=on` sin `GOOGLE_OAUTH_*` | **217/217** | 5/5 superficies en 404; el conector manual de la 015 sigue verde |
| sin `AGENDA` | **169/169** | 5/5 superficies en 404 |
| **2026-09-28, permiso `calendar.events.owned`** (research D6): `AGENDA=on` + app de agencia contra los mocks | **253/253** | 41/41: lo anterior, más a Google se le pide `calendar.events.owned` y un calendario destino ajeno termina en `prueba_fallida` con la conexión previa y su calendario intactos |
| **2026-09-29, abrir el link desde la pantalla** (FR-1429): `AGENDA=on` + app de agencia contra los mocks | **254/254** | 42/42: lo anterior, más el `GET` del link con `usedAt` nulo mientras está pendiente, con fecha tras usarse, y nulo tras revocar |

En la revisión del 2026-09-28 no se repitieron las dos configuraciones sin app de
agencia: el cambio no toca esas superficies (siguen en 404), y el conector manual
de la 015, que sí comparte el mock, salió verde en la corrida completa. Gate
técnico de esa revisión: typecheck, lint, 883/883 unitarios y build en verde. La
página de resultado con `estado=permiso_incompleto` muestra el texto nuevo.

Recorrido en el navegador de vista previa (Principio IX), con la primera
configuración: *Ajustes → Agenda → Google → Generar link* muestra el link con
«Copiar», el vencimiento y «sirve una sola vez», más «Generar otro» y «Revocar»,
sobre la alternativa manual. Abrir el link en el navegador recorrió inicio →
Google (mock) → relevo (mock) → retorno y aterrizó en «Listo: tu calendario
quedó conectado — Calendario de prueba». Reabrirlo: «Este link ya se usó».
Después, la tarjeta de Google aparece sola (el conector quedó en Google) y
«Probar» dice «Conexión correcta — calendario «Calendario de prueba»». Sin
errores de consola. En móvil (375 px) la tarjeta se lee bien; el campo del link
recibió `min-w-0` para no empujar el botón fuera de la tarjeta.

**Recorrido del 2026-09-29 (FR-1429)**, con la primera configuración, sin y con
`GOOGLE_ONBOARDING_URL`:

- Tras *Generar link*: *Conectar mi calendario* junto a *Copiar*, con `href`
  igual al link, `target=_blank` y `rel="noopener noreferrer"`. Aviso sin página
  de aterrizaje: «Se abre Google en otra pestaña para que autorices con la cuenta
  que elijas: esa es la que recibirá las citas. Si el calendario es de otra
  persona, mándale el link.» Con
  `GOOGLE_ONBOARDING_URL=https://lanco.cloud/google-calendar`: «Se abre
  lanco.cloud en otra pestaña y de ahí Google te pide permiso…», y el enlace va
  a `lanco.cloud/google-calendar?i=localhost:3000&t=…` (llave de 43).
- El panel del navegador de vista previa ignora `target=_blank` y abrió el link en
  la misma pestaña, que terminó en «conectado» (con el cliente de la agencia y
  `usedAt` guardado). La vuelta se probó con dos pestañas:
  - el link se generó en la primera, con la conexión borrada antes, y se usó en
    la segunda: «Listo: tu calendario quedó conectado — Calendario de prueba»;
  - en la primera, el evento de volver, `visibilitychange` y `focus` a la vez
    como al cambiar de pestaña, se atendió **una vez**: un `GET` del link y una
    relectura de la conexión. El link desaparece y sale «Listo: Google quedó
    conectado. «Probar» te dice qué calendario.». La tarjeta pasa de *Conectar*
    a *Actualizar*/*Desconectar* con el cliente de la agencia, aparece «Último
    link: usado el 29 sep 2026, 2:23 p.m.», y *Probar* da «Conexión correcta —
    calendario «Calendario de prueba»».
- Volver sin haberlo usado: el link sigue a la vista. Revocarlo desde otra sesión
  y volver: «Ese link ya no sirve.», sin «Último link» (un revocado no pasa por
  usado).
- El texto del link pendiente decía «vence el … p.m.. Si…», porque la fecha en
  es-MX ya termina en punto. Ahora dice «Hay un link pendiente (vence el 2 oct
  2026, 2:25 p.m.). Si lo perdiste…».
- En móvil (375 px), el botón y el aviso caben en la tarjeta, sin scroll
  horizontal. En la consola, solo los cortes de la conexión en tiempo real al
  reiniciar el servidor.
- Después del recorrido se agregó un resguardo contra una carrera: si al volver a
  la pestaña se pulsa *Generar otro* antes de que responda la consulta, esa
  respuesta vieja se descarta. Sin ese resguardo borraría de la pantalla el link
  nuevo, que solo se ve una vez. Los caminos recorridos no cambian; el gate
  completo salió en verde después del cambio.

**En vivo en uniko-lanco (`284c925`, 2026-09-29, T069).** Con ponwo/uniko-crm#48
mergeada, `/api/health` dio 10/10 en el commit nuevo. En la sesión del dueño se
hizo *Generar link* y apareció *Conectar mi calendario*:

- lleva a `https://lanco.cloud/google-calendar` con `i` = el host de la instancia;
- abre otra pestaña con `noopener noreferrer`;
- el `href` es el mismo link que muestra el campo;
- el aviso dice «Se abre lanco.cloud en otra pestaña y de ahí Google te pide
  permiso…».

No se pulsó *Continuar con Google*: eso queda para el video. El link se revocó
enseguida y el `GET` volvió con `pending: null, usedAt: null` (el campo nuevo, en
producción). La conexión de Google siguió intacta (`connected`, `primary`).

## 4. Ensayo del Principio X (toca `drizzle/`)

Procedimiento: el de
[`specs/020-notificaciones-push/quickstart.md`](../020-notificaciones-push/quickstart.md)
(parte 1), con base `uniko_ensayo_029_<fecha>` y el respaldo diario de una instancia
real descargado del panel de Coolify (*Backups → Executions*).

Qué mirar además de que aplique:

```sql
select count(*) from google_link;                       -- 0: tabla nueva, vacía
select indexname from pg_indexes where tablename = 'google_link';
select count(*) from google_credentials;                -- el mismo que antes
```

Y que la app (build de producción, `pnpm start -p 3100`) arranque contra la copia con
`/api/health` en `{"ok":true}`. Tirar la base y el volcado al terminar.

**Fuera de orden.** La PR #42 se mergeó el 2026-09-28 (`6aff0d3`) antes del
ensayo, que el Principio X pide ANTES de `main`. La migración corrió en uniko-lanco
sin problema (`[migrate] migraciones aplicadas`, `/api/health` 10/10). Aun así el
ensayo con un respaldo real era **requisito de la puerta de promoción a
`production`**, y se hizo antes de llevar la 029 a los clientes, con los respaldos
de los dos.

**Registro (2026-09-29, código de `main` en `0bf191e`):**

- **Contra qué datos**: los respaldos de los **dos clientes**, que van en
  `production` y por lo tanto **por detrás de la migración**. Contra LanCo no se
  prueba nada: sigue `main` y ya tiene la `0016`. El dueño los bajó del panel de
  Coolify: ejecuciones del 2026-09-29, «Back up now».
  - **I Love The Universe**: `pg-dump-uniko-1790720650.dmp`, 22:24 UTC,
    **110 593 bytes**;
  - **NuriaAndrea**: `pg-dump-uniko-1790720608.dmp`, 22:23 UTC, **217 303 bytes**.

  Los dos tamaños se verificaron byte a byte contra lo que reporta Coolify **antes**
  de restaurar.
- **Bases desechables** en el PostgreSQL 16 local: `uniko_ensayo_iltu_20260929` y
  `uniko_ensayo_nuriaandrea_20260929`. Nunca `uniko_dev` ni una instancia.
- **Restauración** limpia en las dos: 636 ms y 598 ms.
  - ILTU: 26 conversaciones, 75 mensajes, 26 contactos.
  - NuriaAndrea: 83 conversaciones, 1063 mensajes, 83 contactos.
  - Las dos con **16 migraciones** en el diario de Drizzle (hasta la `0015`) y sin
    `google_link`.
- **`pnpm db:migrate`** desde un worktree en `0bf191e`, solo migraciones: código 0,
  **3.1 s y 2.2 s** con el arranque de drizzle-kit incluido, y solo el ruido
  esperado (`NOTICE` de `CreateSchemaCommand` y `transformCreateStmt`). La última
  entrada del diario es el `sha256` de `0016_google_link.sql`.
- **Aditiva, medido y no supuesto.** Inventario del esquema entero antes y después
  (tablas con sus filas, columnas, índices, restricciones y diario), comparado
  línea por línea. Idéntico en las dos bases:

  | | Antes | Después |
  |---|---|---|
  | Tablas | 33 | 34 (`google_link`, vacía) |
  | Columnas | 350 | 358 (las 8, todas de `google_link`) |
  | Índices | 83 | 86 (llave primaria, `google_link_token_uq`, `google_link_org_idx`) |
  | Restricciones | 92 | 95 |
  | **Filas** | 214 / 1798 | **214 / 1798** |
  | Diario de Drizzle | 16 | 17 |

  De lo que existía no cambió **ninguna** línea del inventario, salvo el contador
  del diario. Las 16 líneas nuevas son todas de `google_link` o del diario.
  `google_credentials`: 0 filas antes y después en las dos, porque ningún cliente
  tiene Google conectado.
- **La app de `main` arrancó contra cada copia** (build de producción, `next start
  -p 3100`): `/api/health` → `{"ok":true,"version":"1.0.0"}`. El manifiesto sirvió
  la marca real de cada cliente: «I Love The Universe — CRM de WhatsApp»
  (`#0fafff`) y «NuriaAndrea CRM — CRM de WhatsApp» (`#0d5bff`). En el log, solo el
  aviso de Next por los dos lockfiles, que sale porque el worktree vive dentro del
  repo y no pasa en el contenedor.
- **Tirado todo**: las dos bases, con `dropdb --force`, y los volcados de la
  carpeta temporal, más el de LanCo que también se había bajado. En el PostgreSQL
  local no queda ninguna base `*ensayo*`, y en *Descargas* ningún `pg-dump`. Los
  originales siguen en el VPS con la retención de Coolify (14 días).

Lo que este ensayo no mide es el volumen, como advierte la 020. La migración solo
crea una tabla vacía con sus índices y no toca filas existentes, así que su costo no
crece con los datos del cliente.

## 5. `lanco.cloud` en local (repo `lanco-ws`)

```bash
npm install && npm run dev   # http://localhost:3000
```

- `/google-calendar` sin parámetros → página de la app, con enlaces a privacidad y
  términos.
- `/google-calendar?i=uniko.lanco.cloud&t=<43 caracteres>` → nombre del negocio y
  botón que apunta a `https://uniko.lanco.cloud/api/google/oauth/start?t=…`.
- `?i=otro.example.com&t=…` → error, sin botón.
- Con un *user agent* de Instagram → pide abrir en el navegador.
- `/google-calendar/callback?state=<jwt con ret de la flota>&code=x` → redirige a
  `https://<host>/api/google/oauth/callback?state=…&code=x`; con `ret` fuera de la
  lista, o `http:`, o con ruta → error y ninguna redirección.
- `npm run build` en verde.

**Registro (2026-09-27, rama `feat/google-calendar-onboarding`, `f1fc59a`)**:
`tsc --noEmit` limpio y `npm run build` en verde. En el navegador (Vite en
3001): la página de la app sin parámetros, con enlaces a privacidad y términos;
el aterrizaje con `i=uniko.ilovetheuniverse.mx` nombra a «I Love The Universe»
(de `data/flota.ts`), su botón apunta a
`https://uniko.ilovetheuniverse.mx/api/google/oauth/start?t=…` y la página lleva
`noindex` y `no-referrer`; un host ajeno da «Este link no es de LanCo» y una
llave corta «El link está incompleto», los dos sin botón; el relevo con un `ret`
ajeno se queda en «No pudimos continuar» sin redirigir. El caso positivo del
relevo (que llevaría el navegador a una instancia de producción) se probó con el
módulo real empaquetado en Node: consulta completa reenviada, cinco negativos y
la detección de navegadores de apps (Instagram, Facebook, WebView de Android sí;
Chrome y Safari no). La política de privacidad muestra la sección 9 con la
declaración de uso limitado.

**Registro en producción (2026-09-28, `lanco.cloud` en `9a0519a`: feature 004 de
`lanco-ws`, ponwo/lanco-ws#4)**. Desde la 004, el build prerenderiza las páginas
que revisa Google y Nginx las sirve con `try_files $uri $uri.html …`.

- **Sin JavaScript:**
  - `/google-calendar` responde 200 directo, sin redirección, con el título, el `h1`,
    las cuatro secciones, el permiso `calendar.events.owned`, los enlaces a
    privacidad y términos y el canonical, sin `noindex`;
  - `/politica-privacidad` trae en el HTML la sección 9 nueva: el permiso, lo que
    guarda el CRM de cada cita, el Meet por WhatsApp, lo del entrenamiento de IA
    (la privacidad de OpenRouter quedó sin entrenamiento) y el uso limitado.
- **En el navegador, sin tocar botones:**
  - el aterrizaje con un link válido para uniko.lanco.cloud muestra «Conecta tu
    Google Calendar con LanCo», con `noindex` y `no-referrer`, y el botón hacia
    `https://uniko.lanco.cloud/api/google/oauth/start?t=…`;
  - un host ajeno da «Este link no es de LanCo»;
  - el relevo con `state` ajeno, `http:`, con ruta o basura se queda en «No
    pudimos continuar», sin redirigir.
- El resto del sitio sigue igual (guiones 001 A, 003 A/F/G de `lanco-ws`).

Registro completo en `lanco-ws`: `specs/004-verificacion-lanco-agenda/quickstart.md`
(ponwo/lanco-ws#5).

## 6. En vivo en uniko-lanco (con el dueño)

Lo que solo puede hacer el dueño va marcado con **(dueño)**.

1. **(dueño)** En la consola de Google (proyecto LanCo Robotics): renombrar la app a
   «LanCo Agenda» y crear el cliente OAuth `Uniko · LanCo` (Aplicación web) con URI
   de redirección `https://lanco.cloud/google-calendar/callback`.
2. **(dueño)** Mergear la PR de `lanco-ws` → `lanco.cloud` se despliega solo; comprobar
   que `/google-calendar` responde.
3. **(dueño)** Ratificar la enmienda 1.8.0 y mergear la PR de Uniko a `main` →
   uniko-lanco se despliega solo. Esperar `/api/health` 10/10 con el commit nuevo
   (memoria `relevo-de-contenedor-en-coolify`).
4. Configurar en uniko-lanco `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REDIRECT_URI=https://lanco.cloud/google-calendar/callback` y
   `GOOGLE_ONBOARDING_URL=https://lanco.cloud/google-calendar`; reiniciar.
5. *Ajustes → Agenda → Google → Generar link* como dueño; comprobar la forma del link.
6. **(dueño)** Abrir el link en el teléfono, autorizar con la cuenta del calendario de
   LanCo y ver "conectado" con el nombre del calendario.
7. Comprobar en *Ajustes → Agenda* la conexión, "Probar" con el nombre del calendario,
   y una cita real que crea su evento con Meet — y cancelarla para no dejar basura.
8. Reabrir el mismo link → "ya se usó".

**Registro (2026-09-28, uniko-lanco en `6aff0d3` y luego en `2fa2947`)**:

1. Consola: la app de **LanCo Robotics** pasó de `agendamiento-lanco` a «LanCo
   Agenda». El dueño **reutilizó el cliente OAuth que LanCo ya tenía** (el de su
   conexión manual del 23) y le añadió el redirect de `lanco.cloud`. Encaja con
   ADR-004 porque es el cliente propio de ese negocio; no hacía falta uno nuevo.
2. ponwo/lanco-ws#1 mergeada → `lanco.cloud/google-calendar` y la sección 9 de la
   privacidad en vivo; ponwo/lanco-ws#2 → la página de la app sin `noindex`.
3. ponwo/uniko-crm#42 mergeada (enmienda 1.8.0 ratificada) → `6aff0d3` 10/10,
   `[migrate] migraciones aplicadas`. Sin las variables, el inicio, el retorno y
   `/conectar-google` respondieron **404** desde fuera (comprobado).
4. Con las cuatro variables en Coolify (revisadas por MCP: runtime, y las dos URLs
   exactas) y redesplegada, un link falso pasó a `302 →
   /conectar-google?estado=link_invalido` y la página respondió 200 con «Este link
   no es válido».
5. El dueño generó el link en *Ajustes → Agenda*.
6. **(dueño)** Lo abrió en el teléfono, autorizó y aterrizó en «conectado» con el
   calendario de LanCo.
7. Desde la sesión del panel:
   - `GET /api/settings/google` → `connected`, `primary`, el cliente
     `559667449083-…` (proyecto LanCo Robotics);
   - el conector sigue en `google`;
   - el link ya no está pendiente;
   - «Probar» contra Google real → ok, calendario **`lanco.dmd@gmail.com`**
     (`fields=summary` validado contra Google).

   Con uniko-lanco ya estable en `2fa2947` (10/10), una cita **real** con el
   contacto del dueño, sin mensajes ni invitados:
   - **crear** (mar 29 sep 09:00) → 201 con Meet real
     `meet.google.com/svk-kejk-dhg` y sin enlace pendiente;
   - **mover** a las 10:00 → el mismo enlace;
   - el dueño la vio en su Google Calendar a las 10:00;
   - **cancelar** → la cita queda `cancelada`, el log de la instancia sin errores,
     y **el dueño confirmó que el evento desapareció de su Google Calendar**.
8. Reabrir el link: cubierto por el arnés (`link_usado`). No se repitió en vivo
   para no gastar un link más.

### 6.1 Permiso `calendar.events.owned` (revisión 2026-09-28, research D6)

La conexión actual de LanCo se hizo con `calendar.events` y sigue funcionando; esto
comprueba que una conexión NUEVA con el permiso estrecho hace todo lo que el
conector necesita contra Google real.

1. **(dueño)** Mergear la PR → uniko-lanco se despliega solo. Esperar
   `/api/health` 10/10 con el commit nuevo.
2. *Ajustes → Agenda → Google → Generar link* como dueño.
3. **(dueño)** Abrir el link y autorizar con `lanco.dmd@gmail.com`: la pantalla de
   Google nombra «LanCo Agenda» y pide **un solo** permiso, el de los eventos de
   los calendarios **propios**. Aterrizar en «conectado».
4. `GET /api/settings/google` → `connected`, `primary`; «Probar» → ok con el nombre
   del calendario.
5. Una cita real: **crear** con Meet, **mover**, **cancelar** — y el dueño lo ve en
   su Google Calendar.

**Registro (2026-09-28, uniko-lanco en `423e46a`)**:

1. ponwo/uniko-crm#45 mergeada → uniko-lanco en `423e46a`, `/api/health` 10/10.
2. El dueño generó el link, autorizó en su teléfono con `lanco.dmd@gmail.com` y
   aterrizó en «conectado». No leyó el texto de la pantalla de Google; que el
   permiso concedido es el estrecho se deduce de que la instancia pide solo
   `calendar.events.owned` (cubierto por unitarios y arnés) y Google no concede
   más de lo pedido. La pantalla se verá en el video de la verificación.
3. Desde la sesión del panel:
   - `GET /api/settings/google` → `connected`, `primary`, el cliente
     `559667449083-1lt9…`;
   - el conector sigue en `google`, y el link quedó usado;
   - «Probar» → ok, calendario **`lanco.dmd@gmail.com`**.
4. Una cita **real** con el contacto del dueño (manual: sin mensajes ni
   invitados), toda con la conexión nueva:
   - **crear** (mié 30 sep 09:00) → 201 con Meet real `meet.google.com/yrs-pogr-cuq`,
     sin enlace pendiente;
   - **mover** a las 10:00 → 200, el mismo enlace; **el dueño la vio a las 10:00**
     en su Google Calendar;
   - **cancelar** → 200, la cita queda `cancelada`, y **el dueño confirmó que el
     evento desapareció**.
5. El log de la instancia, sin advertencias en todo el recorrido.
6. Para leer a qué dirección de Google manda el inicio del link se generó otro
   link de prueba; la extensión del navegador no deja leer la llave, así que se
   revocó enseguida (`revoked: 1`). No queda ninguno pendiente.

La concesión de la mañana (`calendar.events`) sigue viva en Google hasta que se
quite el acceso de LanCo Agenda en esa cuenta; el guion del video
([google-agencia.md §5.3](../../docs/google-agencia.md)) empieza quitándolo.
