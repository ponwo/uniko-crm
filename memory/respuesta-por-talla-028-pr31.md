---
name: respuesta-por-talla-028-pr31
description: "028 (respuesta por talla y fotos por producto en check_stock): PR #31 mergeada y desplegada en uniko-lanco el 2026-09-16 (4d3662f), verificada por WhatsApp con los 4 modelos reales el 2026-09-17 (cierra la T057 de la 026); pendiente de decidir: orden de llegada de las fotos (Meta reordena imágenes por URL); NO promovida a production"
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

Estado 2026-09-17: **mergeada y desplegada** (`4d3662f`, `/api/health` 10/10) y
verificada por el dueño por WhatsApp con los 4 modelos reales: «tienes playeras talla
grande» → Negra y roja, cada una con su foto y su línea (`talla G: 8 pieza — $300 MXN` /
`talla G: 7 pieza — $219 MXN`); «y en talla m» → Negra y verde; «y en rojo talla m» →
la roja sola con la redacción de la 026. Cierra la T057 de la 026. **No promovida a
`production`** (señal aparte del dueño).

Hallazgo en vivo (pendiente de decidir, fuera de la 028): Meta entrega cada imagen por
URL cuando termina de descargarla, así que dos fotos seguidas pueden llegar
**invertidas** (la verde apareció antes que la Negra, que llevaba la frase de entrada).
Opciones: esperar el estado `sent` del mensaje anterior (tope ~2 s) antes del siguiente,
o una pausa fija corta. No proponerlo como hecho: el dueño decide.

**Why:** la feature está cerrada de punta a punta; lo único abierto es una decisión de
UX sobre el orden de llegada que no estaba en la spec.
**How to apply:** si el dueño pide arreglar el orden, es un ajuste pequeño en
`deliverReplies` (`src/server/ai/pipeline.ts`) con su test y su caso en el arnés; si
pide promover, seguir la puerta de promoción de la constitución. Ver [[tallas-026-pr29]]
y [[conector-inventario-consume-el-contrato-de-ms-stock]].
