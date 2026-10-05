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

## 4. Contra MS-Stock real en local

MS-Stock local (`uv run uvicorn app.main:create_app --factory --port 8000` en el repo
hermano, con el stub S3: `uv run python -m tests.s3_stub --port 9000 --bucket
ms-stock-dev` y sus `R2_*` de prueba) y un PDF subido con `curl -X PUT
"http://localhost:8000/v1/catalog?filename=Cat%C3%A1logo%20de%20prueba" -H "X-API-Key: …"
-H "Content-Type: application/pdf" --data-binary @catalogo.pdf`. `.env` de Uniko con
`STOCK_BASE_URL=http://localhost:8000` y esa llave. En el Laboratorio: «¿qué venden?» →
documento con el nombre que dio MS-Stock; `DELETE /v1/catalog` y repetir → solo la frase.
Confirma la forma del §4b contra el servicio de verdad.

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

## Criterio de "Hecho"

Gate verde + arnés verde en ambas configuraciones + Laboratorio y bandeja revisados + MS-
Stock local + verificación en `uniko-lanco` ↔ `stock.lanco.cloud` (SC-006) + `tasks.md`
al día + 028 marcada (FR-1711) + docs (`docs/inventario-conector.md`,
`tests/e2e/us-inventario.md`, `CLAUDE.md`).
