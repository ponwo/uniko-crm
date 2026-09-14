# E2E — Conector INVENTARIO (026)

Guion de comportamiento observable. Automatizado en la sección `026` de
`scripts/e2e-selftest.mjs` (`inventarioChecks()`): con la app viva y los mocks
encendidos, `pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock,
`STOCK_BASE_URL` → `http://localhost:3000/api/dev/stock-mock`, `STOCK_API_KEY` y
`STOCK_SSO_SECRET` (≥ 32) y la BD migrada. La bandera `INVENTARIO` decide qué mitad
del guion corre: ambas se ejercitan en la matriz de CI. Contrato del otro lado:
`../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md`.

---

## US0 — La instancia decide si el conector existe

Con `INVENTARIO` ausente:

1. `GET /api/inventario/sso` y `GET /api/inventario/status` responden **404**,
   con o sin sesión.
2. La página `/settings/inventario` responde 404; la navegación y Ajustes no
   mencionan "Inventario".
3. Un cliente pregunta "¿tienen playera negra?" y el agente responde como
   siempre (el eco del ai-mock): el esquema del turno no conoce `check_stock` y
   el prompt no lo menciona.

Con `INVENTARIO=on`, todo lo de abajo.

## US2 — El agente consulta existencias reales antes de afirmarlas

1. "¿tienen playera negra?" → la respuesta saliente contiene
   `Playera negra (PLY-NEG): 7 pieza — $199 MXN` (los datos los pega el
   sistema; el modelo solo aportó "Déjame revisar.").
2. "¿tienen gorra?" → `Gorra (GOR-01): 3 pieza — sin precio`; la gorra inactiva
   (`GOR-02`) no aparece.
3. "¿tienen playera blanca?" → `agotado`.
4. "¿tienen zapatos?" → `No encontré productos para «zapatos».`
5. "¿cuánto cuesta la PLY-NEG?" → el SKU se consulta exacto y responde `$199`.
6. **Degradación** — con el stock-mock en modo `down`, `unauthorized`, `slow` y
   `garbage`, la misma pregunta recibe **solo** "Déjame revisar." (la frase del
   modelo) dentro del tiempo de coalescencia + 6 s, sin `error`, `503`,
   `unauthorized` ni `timeout` en el texto; el servidor registra
   `[agente] inventario: <motivo>`.

**Foto del producto** (extensión 2026-09-13; contrato §4 "Foto del producto").
El stock-mock devuelve `image_url` para `PLY-NEG` (`{origen}/icon-192.png`) y
`null` para el resto; el wa-mock tiene un modo para las imágenes por link
(`POST /api/dev/wa-mock/media-mode` → `ok | reject | slow`).

7. "¿tienen playera negra?" → sale **un solo** mensaje, de tipo `image`, con
   `image.link` = la `image_url` del producto (Uniko no descarga ni proxea) y
   `image.caption` = el texto completo del turno ("Déjame revisar." + la línea
   del producto). No sale ningún mensaje de texto aparte; la URL no aparece en
   ningún texto.
8. "¿tienen gorra?" (sin foto) → solo texto, como siempre.
9. "¿tienen playera?" (dos resultados) → **una** imagen (la del primero) con
   las dos líneas en el pie; nunca una ráfaga.
10. En el hilo del Inbox el mensaje queda como `image` con `media.payload.url`
    = la URL pública, el pie como `text`, marcado IA y sin `failed`;
    `GET /api/media/{assetId}` responde **302** a esa URL (no sirve bytes).
11. **Meta rechaza el link** (modo `reject`) → sale solo el texto, dentro del
    mismo tiempo, y el hilo no enseña ningún mensaje fallido. **Meta tarda**
    (modo `slow`, más de 5 s) → el texto sale solo antes de coalescencia + 5 s
    + margen.
12. **Meta acepta y después reporta `failed`** (`POST /api/dev/wa-mock/status`
    con el `waMessageId` de la foto y `errorCode: 131053`) → el pie sale como
    mensaje de texto, generado por IA, **una sola vez** (un `failed` repetido
    no lo manda de nuevo); en el hilo la foto queda `failed` con su motivo y
    el texto de respaldo después.

## US1 — Abrir el inventario desde Uniko sin llave

1. Sin sesión, `GET /api/inventario/sso` → **401** y no emite pase.
2. Con sesión → **302** a `${STOCK_BASE_URL}/portal/sso?token=…`; seguir la
   redirección muestra "<nombre> desde Uniko" y `_state.lastSso` trae `sub` =
   id del usuario, `name` = su nombre, `aud` = `STOCK_BASE_URL`, `iss` =
   `APP_BASE_URL`, `exp − iat = 120`.
3. Dos clics → dos `jti` distintos (un pase por clic, nunca se reutiliza).
4. `?next=/portal/products/PLY-NEG` viaja en el pase; `?next=https://evil.example`
   no.
5. En el navegador: el renglón **Inventario** aparece tras Pipeline (y Citas con
   `AGENDA=on`), abre pestaña nueva, y no existe con la bandera apagada.

## US3 — Saber si el conector está bien conectado

1. `GET /api/inventario/status` → `{ baseUrl, status: "connected" }` en < 5 s.
2. Con el mock en `unauthorized` → `"unauthorized"`; en `down` → `"unavailable"`.
3. Ni `STOCK_API_KEY` ni `STOCK_SSO_SECRET` aparecen en esa respuesta ni en el
   HTML de `/settings/inventario`.
4. En el navegador: Ajustes → Inventario muestra la dirección y "Probar
   conexión" → "Conectado" / "Llave rechazada" / "Servicio no disponible".
