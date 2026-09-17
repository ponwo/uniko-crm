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
9. "¿tienen playera?" (varios resultados) → **(reescrito por la 028)** un mensaje
   por modelo **con existencia**, en orden, cada uno con su foto (o texto si no la
   tiene) y su línea como pie; la blanca (agotada) no aparece; máximo 5 y, si hay
   más, `Hay más coincidencias, ¿me dices cuál te interesa?`. (Hasta la 028: una
   imagen, la del primero, con todas las líneas en el pie; FR-1119 derogado en
   parte.)
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

13. **Tallas (2026-09-14)** "¿tienen playera roja?" → una sola línea del modelo
    con precio y la existencia de cada talla en orden, agotadas marcadas:
    `Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1`.
14. "¿tienen playera roja en G?" → el modelo manda `query` = "playera roja" y
    `size` = "G"; el cliente recibe `Playera roja (PLY-ROJ) talla G: 7 pieza —
    $219 MXN`.
15. "¿tienen playera roja en M?" → `talla M: agotada … Con existencia: CH 4, G 7,
    XG 1`; "… en XXG" → `no viene en talla XXG. Tallas: …`.
16. "¿cuánto cuesta la PLY-ROJ-G?" → el SKU de la talla se consulta exacto:
    `Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN`.
17. Los casos 1–5 responden exactamente igual que antes (productos sin tallas).
18. **028 (2026-09-15)** "¿tienen playeras en G?" (plural) → solo los modelos con
    existencia en G, uno por mensaje con su foto y su precio: `image` negra (simple,
    talla única) con pie `Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199
    MXN`, `text` `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN` (sin foto),
    `image` gris `Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN`; ningún texto
    menciona "agotad", "no viene" ni otra talla.
19. "¿tienen playeras en M?" → negra y verde (`talla M: 10 pieza — $200 MXN`); roja
    y gris (M agotada), azul y amarilla (sin M) ausentes. "… en extra chica" → negra y
    azul (`talla XCH: 1 pieza — $800 MXN`, equivalencia).
20. "¿tienen pantalones en 40?" → un solo texto: `Déjame revisar.\nPor ahora no
    tengo pantalones en talla 40.`; "¿… en 32?" → `image` Pantalón azul (`talla 32:
    4 pieza — $650 MXN`) y `text` Pantalón negro (`talla 32: 1 pieza — $650 MXN`).
21. Un solo modelo se contesta como en 13–16 ("¿tienen playera roja en M?" →
    `agotada — … Con existencia: CH 4, G 7, XG 1`).
22. "¿tienen playeras?" (sin talla, 6 con existencia) → 5 mensajes (negra img, roja
    txt, azul img, verde img, gris img) + `Hay más coincidencias…`; nunca más de 5
    `image` ni un `link` repetido.
23. wa-mock `media-mode {reject, link:"m=grs"}` + "¿tienen playeras en G?" →
    `image` negra · `text` roja · `text` gris, en ese orden; el hilo no tiene
    `failed`; `[agente] foto:` en el log. `{slow, link:"m=vrd"}` + "… en M" → la
    verde como texto dentro del límite.
24. Laboratorio: "¿tienen playeras en M?" → dos mensajes `image` persistidos con la
    URL y el pie, sin tocar Graph.
25. **Orden de llegada (ajuste 2026-09-17, FR-1314/FR-1315)**: tras «¿tienen
    playeras en G?» las imágenes del hilo quedan `sent` (el wa-mock emite el estado
    como Meta) y el motor no mandó la roja hasta tener el `sent` de la negra; con el
    estado ausente, el tope de 2 s manda el siguiente igual (test unitario).

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
