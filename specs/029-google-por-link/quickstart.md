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
- el relevo se niega a reenviar a un origen fuera de su lista.

Con la agenda encendida **sin** la app de agencia, el bloque verifica las cinco
superficies en 404 y termina. Con la agenda apagada, las cinco en 404.

**Registro (2026-09-27, local, `next dev`, base desechable por corrida)**:

| Configuración | Arnés completo | Bloque 029 |
|---|---|---|
| `AGENDA=on` + app de agencia contra los mocks | **249/249** | 37/37: feliz, siete infelices con la conexión previa intacta, controles del dueño, relevo |
| `AGENDA=on` sin `GOOGLE_OAUTH_*` | **217/217** | 5/5 superficies en 404; el conector manual de la 015 sigue verde |
| sin `AGENDA` | **169/169** | 5/5 superficies en 404 |

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

**Registro**: _(pendiente)_

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

## 6. En vivo en uniko-lanco (con el dueño)

Lo que solo puede hacer el dueño va marcado con **(dueño)**.

1. **(dueño)** En la consola de Google (`agendamiento-lanco`): renombrar la app a
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

**Registro**: _(pendiente)_
