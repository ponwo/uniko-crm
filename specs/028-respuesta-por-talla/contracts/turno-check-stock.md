# Contrato interno — turno `check_stock` (028)

Lo que `src/server/inventario/agent.ts` le entrega al pipeline y lo que los mocks del
self-test exponen. Complementa [conector-inventario.md](../../026-conector-inventario/contracts/conector-inventario.md)
y [stock-mock.md](../../026-conector-inventario/contracts/stock-mock.md) de la 026, que
siguen vigentes en todo lo que aquí no se nombra.

## 1. Forma del turno

```ts
checkStockTurn({ query, size?, intro? }) → Promise<StockTurn>
StockTurn = { ok: boolean; messages: { text: string; imageUrl: string | null }[] }
```

- `ok: false` ⇒ el conector falló (motivo tipado en el log `[agente] inventario: …`);
  `messages` lleva la frase de entrada si la hubo, para que el pipeline degrade igual
  que hoy (FR-1112).
- `messages` está en el orden de envío. El primer `text` lleva la frase de entrada
  (`intro + "\n" + línea`), los demás solo su línea.
- Redacción exacta por caso: [data-model.md](../data-model.md) §Reglas. Ejemplos con
  el catálogo del stock-mock (§3):

| Pregunta (ai-mock ⇒ acción) | `messages` |
|---|---|
| "¿tienen playeras en G?" ⇒ `{query:"playeras", size:"G"}` | `[img NEG] Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN` · `[txt] Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN` · `[img GRS] Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN` |
| "¿tienen playeras en M?" | `[img NEG] …Playera negra (PLY-NEG): 7 pieza — $199 MXN` · `[img VRD] Playera verde (PLA-VRD) talla M: 10 pieza — $200 MXN` |
| "¿tienen playeras en XCH?" | `[img NEG] …` · `[img AZL] Playera azul (PLA-AZL) talla XCH: 1 pieza — $800 MXN` |
| "¿tienen pantalones en 40?" | `[txt] Déjame revisar.\nPor ahora no tengo pantalones en talla 40.` |
| "¿tienen pantalones en 32?" | `[img PAN-AZ] …Pantalón azul (PAN-AZ) talla 32: 4 pieza — $650 MXN` · `[txt] Pantalón negro (PAN-NG) talla 32: 1 pieza — $650 MXN` |
| "¿tienen playeras?" (sin talla; 6 con existencia) | 5 mensajes (NEG img, ROJ txt, AZL img, VRD img, GRS img) + `[txt] Hay más coincidencias, ¿me dices cuál te interesa?` |
| "¿tienen playera roja en M?" (un producto) | `[txt] Déjame revisar.\nPlayera roja (PLY-ROJ) talla M: agotada — $219 MXN. Con existencia: CH 4, G 7, XG 1` (sin cambio; la roja del mock no tiene foto) |
| "¿tienen playera negra?" (un producto) | `[img NEG] Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN` (sin cambio) |

## 2. Entrega (`pipeline.ts`)

- `deliverReplies(conversation, messages)`: si ningún mensaje tiene foto enviable
  (todas `null`, o el canal no tiene imágenes salientes y no es conversación de
  prueba) ⇒ **un** `deliverReply` con todos los `text` unidos por `\n` (idéntico a la
  026). Si no, un `deliverReply(text, { imageUrl })` por mensaje, **en serie y en
  orden**.
- Por mensaje rigen las reglas de la 026: pie si ≤ 1024 caracteres; imagen rechazada,
  `failed` o > 5 s ⇒ ese texto solo (motivo en `[agente] foto: …`); `is_test` ⇒ se
  persiste imagen+pie sin tocar Graph; `window_closed` ⇒ `applyHandoff` y se detiene
  la serie.
- Un solo `publish({ type: "conversation.updated" })` al terminar.

## 3. stock-mock (`/api/dev/stock-mock/*`)

Rutas y modos sin cambio. Catálogo (los seis últimos son nuevos, al final):

| SKU | Nombre | Precio | Existencia / tallas | `image_url` |
|---|---|---|---|---|
| PLY-NEG | Playera negra | 199 | 7 (sin tallas) | `{origin}/icon-192.png` |
| PLY-BLA | Playera blanca | 199 | 0 | — |
| GOR-01 | Gorra | — | 3 | — |
| TAZ-01 | Taza | 89 | 12 | `{origin}/icon-512.png` |
| GOR-02 | Gorra vieja (inactiva) | 50 | 1 | `{origin}/icon-192.png` |
| PLY-ROJ | Playera roja | 219 | CH 4, M 0, G 7, XG 1 | — |
| PLA-AZL | Playera azul | 800 | XCH 1, CH 5, XG 2 | `{origin}/icon-512.png?m=azl` |
| PLA-VRD | Playera verde | 200 | CH 2, M 10, XG 10 | `{origin}/icon-192.png?m=vrd` |
| PLA-GRS | Playera gris | 250 | M 0, G 3, XG 4 | `{origin}/icon-512.png?m=grs` |
| PLA-AMA | Playera amarilla | 150 | CH 1 | `{origin}/icon-192.png?m=ama` |
| PAN-AZ | Pantalón azul | 650 | 30 2, 32 4, 34 0 | `{origin}/icon-512.png?m=pan` |
| PAN-NG | Pantalón negro | 650 | 32 1, 34 3, 36 2 | — |

- `search` acepta `limit` hasta 25 (ya lo hacía) y **tolera el plural** de la consulta
  con la misma regla que MS-Stock (palabra ≥ 4 letras terminada en `s` ⇒ también sin
  `s`; terminada en `es` ⇒ también sin `es`): `playeras` ⇒ 7 modelos; `pantalones` ⇒ 2.
- Los SKU de talla (`PLA-GRS-G`, `PAN-AZ-32`) responden la talla con `label` y
  `parent_sku`, como en la 026.

## 4. wa-mock — `media-mode` por link

```
POST /api/dev/wa-mock/media-mode  { "mode": "ok" | "reject" | "slow", "link"?: string }
GET  /api/dev/wa-mock/media-mode  → { mode, link, modes }
DELETE /api/dev/wa-mock/media-mode → { ok: true, mode: "ok" }   // borra también link
```

Con `link`, el modo aplica **solo** a los envíos `type: "image"` cuyo `image.link`
contenga esa subcadena (p. ej. `m=grs`); los demás se aceptan. Sin `link`, aplica a
todas (comportamiento de la 026). El rechazo sigue siendo un 400 con la forma de Meta
(`(#100) Param image['link'] is not a valid URL`); `slow` tarda 7 s y **sí** registra
el mensaje en el outbox, como Meta.

## 5. ai-mock

Sin cambios: ya separa `query`/`size` de "… en G", "… talla G", "… en talla G" y pasa
la palabra tal como la escribió el cliente (en plural si así vino), que es lo que hace
falta para ejercitar la tolerancia al plural del stock-mock.
