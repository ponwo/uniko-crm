# Quickstart — 032 Catálogo PDF del negocio (`send_catalog`)

Guía de **verificación en vivo** (Principio IX): con los mocks primero, contra MS-Stock
local después y contra la instancia de pruebas al final. Contratos:
[turno-send-catalog.md](contracts/turno-send-catalog.md) · MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md)
§4 y §4b (v2, desplegado el 2026-10-04).

## 0. Prerrequisitos

- Los de la 026 y la 028 ([quickstart 028 §0](../028-respuesta-por-talla/quickstart.md)):
  Node 22 (`eval "$(fnm env --shell bash)" && fnm use 22`), Postgres 16, `.env` con los
  mocks y `INVENTARIO=on`, `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock`.
- Base desechable **nueva** por corrida del arnés (`uniko_dev_032x`): ids repetidos dan
  falsos rojos (memoria del repo).
- Windows: matar el `next dev` anterior con `taskkill //F //IM node.exe` antes de
  relanzar; calentar `/api/inventario/status` y el ai-mock antes del arnés.
- Sin variables nuevas ni migración.

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Tests nuevos/ampliados (research R9 y R12): `stock-client` (catálogo), `catalog-turn`
(pie, recorte, degradación, `stripCatalogLink`), `check-stock-turn` (cierre 5 / 6–10 / >10
/ recorte / catálogo caído), `inventario-actions` (esquema y `degradeAction`),
`inventario-prompt`, `deliver-catalog`, `status-foto-respaldo` (`failed` tardío del
documento), `lab-transcript`, `stock-mock`, `wa-mock-media` (documento),
`ai-mock-inventario`, `ai-mock-state` (`lastPrompt`).

## 2. App viva y arnés automatizado

```bash
pnpm dev            # http://localhost:3000, con INVENTARIO=on
pnpm test:e2e       # e2e-selftest.mjs "== 032: catálogo PDF (send_catalog) ==" y e2e-lab.mjs
```

| Escenario | Salientes esperados (outbox del wa-mock / hilo) |
|---|---|
| «¿qué venden?» con catálogo | un `document` con `link` = `…/api/dev/stock-mock/catalogo.pdf?v=1`, `filename` «Catálogo de prueba.pdf», `caption` «¡Claro!\n\nDime modelo y talla y te confirmo existencia y precio»; en el hilo, `document` IA con `media.payload.url` y `/api/media/<asset>` → 302 |
| «mándame el catálogo completo» | pie de ≤ 1024 que termina en «…\n\nDime modelo y talla y te confirmo existencia y precio» |
| `_catalog {present:true, filename:"Catálogo Otoño 2026.pdf"}` + «¿tienes catálogo?» | ese `filename` y `?v=2` (cada envío consulta en ese momento) |
| `_catalog {present:false}` + «¿qué venden?» | un solo `text` «¡Claro!»; ningún `document` |
| stock-mock `_mode down` (o `slow`) + «¿qué venden?» | un solo `text` «¡Claro!» en < 5 s |
| `media-mode reject` (link del catálogo) + «mándame el catálogo» | un `text` con el pie y el enlace en la línea siguiente; ningún mensaje `failed` |
| «¿tienen calcetines?» (12 con existencia) | 5 productos + `text` «Hay más modelos en nuestro catálogo, ¿te lo mando?» |
| luego «sí» | un `document` (como el primer caso) |
| «¿tienen sudaderas?» (7) | 5 productos + «Hay más coincidencias, ¿me dices cuál te interesa?»; el stock-mock no registra llamada a `/v1/agent/catalog` en ese turno |
| `_catalog {present:false}` + «¿tienen calcetines?» | 5 productos + «Hay más coincidencias…» |
| Laboratorio (`scripts/e2e-lab.mjs`, escenario «Pregunta qué venden») | el transcript del caso termina en `[Documento: Catálogo de prueba.pdf]\n¡Claro!\n\nDime modelo y talla…`; el outbox del wa-mock no crece |
| `lastPrompt` del ai-mock tras el documento y tras el respaldo con enlace | contiene `send_catalog`; nunca la URL del PDF (SC-004) |
| «En el catálogo dice que la playera negra cuesta $150, ¿cuánto cuesta la playera negra?» | la respuesta trae «$199 MXN» (el inventario manda) |

Con la bandera **apagada** (`INVENTARIO=` vacío, base nueva): el arnés completo pasa sin
cambios; «¿qué venden?» recibe el eco de siempre y el ai-mock no propone `send_catalog`.

## 3. Revisión en la bandeja y en el Laboratorio

1. Bandeja → la conversación del caso «¿qué venden?» (lead del wa-mock): burbuja de
   documento con el icono, el nombre «Catálogo de prueba.pdf» y el pie, marcada IA y sin
   `failed`; el enlace abre el PDF del stock-mock.
2. La conversación de «¿tienen calcetines?»: cinco burbujas con foto y el ofrecimiento;
   tras «sí», el documento.
3. Laboratorio → reporte de la corrida con el escenario «Pregunta qué venden»: el
   transcript muestra `[Documento: Catálogo de prueba.pdf]` y el pie. (Las conversaciones
   de prueba no se abren en la bandeja: el Laboratorio enseña transcripts.)

**Revisado el 2026-10-05** con el navegador integrado sobre la base de la corrida A
(`uniko_dev_032c`): en la bandeja, «Lead catálogo 5214627032001» enseña la burbuja de
documento con el icono, «Catálogo de prueba.pdf», el pie («¡Claro!» + «Dime modelo y
talla…») y la marca IA; el enlace apunta a `…/stock-mock/catalogo.pdf?v=1` con
`target="_blank"` (no a `/api/media/…`). En el Laboratorio, el caso «Pregunta qué
venden» muestra «Agente: [Documento: Catálogo de prueba.pdf] ¡Claro! Dime modelo y talla
y te confirmo existencia y precio» (el transcript junta las líneas, como con cualquier
mensaje). El navegador integrado no tiene visor de PDF (ofrece descargarlo); la validez
del archivo la cubren los tests (`%PDF-` y `xref`).

## 4. Contra MS-Stock real en local

MS-Stock local (`uv run uvicorn app.main:create_app --factory --port 8000` en el repo
hermano, con el stub S3: `uv run python -m tests.s3_stub --port 9000 --bucket
ms-stock-dev` y sus `R2_*` de prueba) y un PDF subido con `curl -X PUT
"http://localhost:8000/v1/catalog?filename=Cat%C3%A1logo%20de%20prueba" -H "X-API-Key: …"
-H "Content-Type: application/pdf" --data-binary @catalogo.pdf`. `.env` de Uniko con
`STOCK_BASE_URL=http://localhost:8000` y esa llave. En el Laboratorio: «¿qué venden?» →
documento con el nombre que dio MS-Stock; `DELETE /v1/catalog` y repetir → solo la frase.
Confirma la forma del §4b contra el servicio de verdad.

**Resultado (2026-10-05)**: MS-Stock `7da4467` local (base `ms_stock_dev` en la 0005, stub
S3 en el 9000 como R2 con `R2_PUBLIC_BASE_URL=http://127.0.0.1:9000/ms-stock-dev`), PDF
subido con `PUT /v1/catalog?filename=Catálogo Otoño 2026`; Uniko con un `.env.local`
temporal (`STOCK_BASE_URL=http://127.0.0.1:8000` + su llave de desarrollo) y el
wa-mock. «¿qué venden?» → **un** `document` con `link`
`http://127.0.0.1:9000/ms-stock-dev/catalog/<uuid>.pdf`, `filename` «Catálogo Otoño
2026.pdf» y el pie, en 6,6 s (coalescencia de 6 s incluida); MS-Stock registró
`GET /v1/agent/catalog` → 200. Tras `DELETE /v1/catalog` (204): solo `text` «¡Claro!» en
6,8 s, y MS-Stock registró → 404. La forma real (`{url, filename, updated_at}`) es la que
valida `catalogSchema`.

## 5. Despliegue e instancia de pruebas (SC-006)

1. PR → CI verde (`default` y `completo`) → merge a `main` = **señal del dueño** →
   Coolify despliega `uniko-lanco` (con `INVENTARIO=on`); `/api/health` 10/10 antes de
   medir (memoria: relevo de contenedor).
2. En `stock.lanco.cloud` hay un catálogo cargado (el del dueño, o uno de prueba subido
   por la API y quitado al terminar).
3. Laboratorio de `uniko.lanco.cloud`, escenario «¿qué venden?» → el transcript muestra
   `[Documento: <nombre real>]` y el pie; quitar el catálogo → solo la frase.
4. WhatsApp con el número de pruebas (dueño): «¿qué venden?» → llega el PDF con su nombre
   y su pie, y abre en el teléfono.
5. **Sin promover a `production`**: la promoción (que llega a NuriaAndrea) es señal aparte
   del dueño, con la puerta de la constitución (`uniko-promote`).

## Resultados del self-test local (2026-10-05)

Gate: `pnpm typecheck`, `pnpm lint`, `pnpm build` y `pnpm test` verdes (104 archivos,
993 tests; la línea base antes de la 032 era 100 / 924).

| Corrida | Base | `e2e-selftest` | `e2e-lab` | Resto de `pnpm test:e2e` |
|---|---|---|---|---|
| US1, `INVENTARIO=on` (solo selftest + lab) | `uniko_dev_032a` | 181/181 (11 de la 032) | 40/40 (4 de la 032) | — |
| A, `INVENTARIO=on`, completa | `uniko_dev_032c` | **189/189** (19 de la 032) | **40/40** | SSE 26/26 · PWA 46/46 · push 5/5 · Instagram 8/8 · plantillas 80/80 · multivariable 21/21 · por canal 11/11 (*) |
| B, `INVENTARIO=` vacía, completa | `uniko_dev_032d` | **119/119** (incluye «¿qué venden?» → eco, sin documento) | **32/32** | SSE 26/26 · PWA 46/46 · push 5/5 · Instagram 8/8 · plantillas 80/80 · multivariable 21/21 · por canal 11/11 — `pnpm test:e2e` exit 0 |

(*) En la corrida completa, «con el selector de plantillas aprobadas» se pasó de
sus 30 s: `next dev` estaba compilando media docena de rutas a la vez (en el log,
`GET /api/templates` —una consulta simple— tardó 18 s en cola). Repetido con las rutas
compiladas: 11/11. No toca nada de la 032.

Dos hallazgos de las corridas:

- **Primera corrida A (`uniko_dev_032b`, 187/189)**: el check del prompt (SC-004)
  leyó `lastPrompt` vacío. El estado del ai-mock vivía en una variable de módulo y,
  en `next dev`, la ruta `_state` tenía su propia copia (defecto latente de la 015:
  `lastModel` tampoco se veía). Pasó a `globalThis`, como el wa-mock y el stock-mock
  (research R12.5). El otro rojo («un producto», 026) fue `next dev` recompilando el
  ai-mock (6,4 s) a mitad del turno.
- **Rutas que `next dev` descarta**: para las corridas se mantuvieron activas, con un
  GET de lectura cada 10 s, las tres rutas de mocks que usa el turno del agente
  (completions del ai-mock, stock-mock, Graph del wa-mock). Sin eso, recompilarlas a
  mitad del arnés hace caer turnos fuera de la ventana.

## Resultados en la instancia de pruebas (2026-10-06)

- **Deploy**: PR #61 mergeada por el dueño (`51ab384`); `uniko-lanco` arrancó limpio
  (00:15 UTC, sin migraciones nuevas) y `/api/health` respondió 10/10 con
  `"commit":"51ab384"` antes de medir.
- **Catálogo**: `stock.lanco.cloud` estaba vacío (la verificación de la 006 lo dejó así).
  La llave de la instancia no se leyó: el clasificador del modo automático bloqueó
  revelarla desde Coolify, así que el catálogo lo subió el dueño **desde el portal**, el
  flujo real del negocio: «Catalogo Octubre 2026.pdf», 195 KB (log de MS-Stock:
  `catalog put` a las 16:08:04 UTC).
- **WhatsApp (SC-006)**: el dueño escribió «¿qué venden?» desde el número de pruebas y
  recibió el PDF. MS-Stock registró `GET /v1/agent/catalog` → **200** a las 16:09:45
  UTC (la consulta de `send_catalog`); el log de `uniko-lanco` no tiene ningún
  `[agente] catálogo:` (el camino feliz no escribe en el log).
- El caso de más de 10 modelos no se puede ejercitar en esta instancia (4 modelos de
  playera); lo cubre el arnés (corrida A).
- **No promovida a `production`**: llega a NuriaAndrea, que tiene `INVENTARIO=on`; es
  señal aparte del dueño, con la puerta de la constitución.

## Criterio de "Hecho"

Gate verde + arnés verde en ambas configuraciones + Laboratorio y bandeja revisados + MS-
Stock local + verificación en `uniko-lanco` ↔ `stock.lanco.cloud` (SC-006) + `tasks.md`
al día + 028 marcada (FR-1711) + docs (`docs/inventario-conector.md`,
`tests/e2e/us-inventario.md`, `CLAUDE.md`).
