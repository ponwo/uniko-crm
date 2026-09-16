---
name: respuesta-por-talla-028-pr31
description: "028 (respuesta por talla y fotos por producto en check_stock): PR #31 abierta el 2026-09-16 con gate, arnés en ambas configuraciones y verificación contra MS-Stock real en local verdes; merge = señal del dueño; luego SC-007 con los 4 modelos reales y cierre de la T057 de la 026"
metadata:
  type: project
---

Estado 2026-09-16: rama `028-respuesta-por-talla` →
[PR #31](https://github.com/ponwo/uniko-crm/pull/31). Gate verde (`pnpm test` 744),
`e2e-selftest.mjs` **163/163** con `INVENTARIO=on` y **112/112** apagada; contra
MS-Stock real en local (stub S3 como R2, réplica de los 4 modelos) las respuestas son
las de la spec. MS-Stock ya tiene mergeado y desplegado el contrato §4 y la búsqueda
tolerante al plural (`f4f29c4`, 2026-09-16). Sin variables ni migración.

Decisiones del dueño (2026-09-15, no reabrir): con varios modelos y talla pedida, solo
los que tienen existencia en esa talla, uno por mensaje con su foto y su precio;
agotados y modelos sin la talla **se omiten del todo** (con 20 modelos sería
invasivo); **tope 5** fotos por turno como paso inicial; un solo producto se contesta
como en la 026; el catálogo general es la 029 (PDF hecho por el negocio, en R2, subido y
renombrado desde el portal de MS-Stock; Uniko lo envía con `send_catalog`).

Diseño (no reabrir): el turno es una **lista de mensajes** (`agent.ts`), la entrega en
serie vive en `deliverReplies` (`pipeline.ts`) con colapso a un solo texto cuando no hay
foto enviable; se piden 25 a MS-Stock y se muestran 5; deroga en parte FR-1110/1111/
1119/1124/1125 de la 026 (marcadas en su spec, Principio VII).

Gotchas del arnés en esta máquina (además de `taskkill` para `next dev`):
- Cada corrida del arnés necesita base **nueva** (`uniko_dev_028x`): leads y
  `wa_message_id` repetidos → 26 falsos rojos.
- `next dev` compila cada ruta al primer uso: calentar `/api/inventario/status` y
  `POST /api/dev/ai-mock/v1/chat/completions` antes de correr, o el primer
  `check_stock` (o el check «status en < 5 s») se sale del límite.
- `DELETE /api/dev/wa-mock/outbox` reinicia el contador de wamids del mock: sobre una
  base con mensajes, las imágenes nuevas chocan con `message_wa_message_id_unique` y
  salen como texto (falso rojo). Un guion propio debe generar wamids únicos por corrida
  (idempotencia) y no resetear el outbox.
- Better Auth exige `origin` en los endpoints de auth (sign-up 403 sin él).

Pendiente (T039–T040): merge (dueño) → deploy de `uniko-lanco` → `/api/health` 10/10 →
por WhatsApp o Laboratorio de `uniko.lanco.cloud` contra `stock.lanco.cloud`: «¿tienen
playeras en G?» → Negra y roja con foto; «en M» → Negra y verde; «en XCH» → solo roja;
«en 24» → frase; «playera roja en M» → 026 intacta → registrar en `quickstart.md` de la
028 y cerrar la T057 de la 026 con la misma evidencia. **No promover a `production`**.

**Why:** el trabajo quedó a una señal del dueño; la verificación en la instancia de
pruebas necesita el deploy.
**How to apply:** empezar por la PR #31 (rebase si `main` avanzó), no por el código.
Ver [[tallas-026-pr29]] y [[conector-inventario-consume-el-contrato-de-ms-stock]].
