# Data Model — 028 Respuesta por talla y fotos por producto

Sin tablas ni migraciones. Lo que cambia es la **forma del turno** que `agent.ts` le
devuelve al pipeline y las **reglas** con las que se construye.

## Tipos del turno (`src/server/inventario/agent.ts`)

```ts
/** Un mensaje que hay que mandar, en orden. */
export type StockMessage = {
  /** Texto (o pie, si hay foto). Nunca vacío. */
  text: string;
  /** Foto por URL del producto de esta línea, o null (⇒ texto). */
  imageUrl: string | null;
};

export type StockTurn = {
  ok: boolean;                 // false ⇒ el conector falló; el pipeline degrada (FR-1112)
  messages: StockMessage[];    // vacío solo si ok=false y no había frase de entrada
};
```

Entradas: `{ query: string; size?: string; intro?: string }` (sin cambio; `size` ya
existe desde la 026-tallas).

Constantes: `SHOW_LIMIT = 5` (productos mostrados), `MAX_PHOTOS = 5` (imágenes por
turno). En `client.ts`: `SEARCH_LIMIT` pasa de 5 a **25** (lo que se pide a MS-Stock).

## Reglas de construcción

Sea `P` la lista de productos resueltos (SKU exacto ⇒ `P = [uno]`; búsqueda ⇒ hasta
25) y `truncated` el aviso de MS-Stock.

1. **`|P| = 0`** → `[{ text: "No encontré productos para «q»." }]`.
2. **`|P| = 1`** → `[{ text: formatProduct(P[0], size), imageUrl: P[0].image_url }]`
   — idéntico a la 026 (FR-1302, FR-1304, FR-1307 último inciso).
3. **`|P| ≥ 2`** → `shown = P.filter(conExistencia(size)).slice(0, SHOW_LIMIT)` donde
   - con `size`: `conExistencia = p => p.variants.length === 0 ? p.stock > 0 :
     (matchVariant(p.variants, size)?.stock ?? 0) > 0`;
   - sin `size`: `conExistencia = p => p.stock > 0`.
   - `shown` vacío → `[{ text: size ? "Por ahora no tengo q en talla size." : "Por
     ahora no tengo q con existencia." }]`.
   - si no: un mensaje por `p ∈ shown` con `text = lineaDe(p, size)` y `imageUrl` según
     la regla de fotos; y si `filtrados.length > SHOW_LIMIT || truncated`, un mensaje
     final `{ text: "Hay más coincidencias, ¿me dices cuál te interesa?" }`.
4. **Frase de entrada** (`intro` no vacía) → se antepone con `\n` al `text` del primer
   mensaje. Nunca genera un mensaje propio.

`lineaDe(p, size)`:

| Producto | `size` | Línea |
|---|---|---|
| sin tallas | cualquiera | `Nombre (SKU): 7 pieza — $199 MXN` (o `agotado`, `sin precio`) — la de siempre |
| con tallas | sí | `Nombre (SKU) talla G: 7 pieza — $219 MXN` (la etiqueta del negocio, no lo que escribió el cliente) |
| con tallas | no | `Nombre (SKU) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1` — la vigente |

En el caso 3 nunca aparecen las redacciones "agotada — Con existencia: …" ni "no viene
en talla X": esas quedan solo para `|P| = 1` (`formatProduct`).

## Regla de fotos (caso 3)

```
usadas = Set<string>; fotos = 0
para cada p en shown (en orden):
  if p.image_url && !usadas.has(p.image_url) && fotos < MAX_PHOTOS:
      imageUrl = p.image_url; usadas.add(...); fotos++
  else imageUrl = null
```

## Entrega (`src/server/ai/pipeline.ts`)

```
deliverReplies(conversation, messages):
  conFoto = messages.some(m => m.imageUrl) && (conversation.isTest || capabilities(channel).outboundMedia)
  if (!conFoto): deliverReply(conversation, messages.map(m => m.text).join("\n"))   // un solo texto, como hoy
  else: for m of messages: await deliverReply(conversation, m.text, { imageUrl: m.imageUrl })
```

`deliverReply` no cambia: pie si `text.length ≤ 1024`, si no texto + foto sin pie;
foto rechazada o > 5 s ⇒ texto solo y motivo al log; `is_test` ⇒ `persistTestOutbound`
(imagen persistida con la URL y el pie); `window_closed` ⇒ `applyHandoff` y fin.

## Invariantes

- Un producto ⇒ texto **byte a byte** igual al de la 026 (SC-002).
- Con varios productos, ningún mensaje contiene "agotad", "no viene" ni tallas
  distintas de la pedida.
- `messages.filter(m => m.imageUrl).length ≤ 5` y sin URLs repetidas (SC-004).
- El orden de `messages` es el de MS-Stock (relevancia: SKU exacto, prefijo de SKU,
  prefijo de nombre, después nombre).
- `image_url` no aparece en ningún `text` ni en el prompt.
- Con la bandera apagada, nada de esto se ejecuta.

## Estado del wa-mock (`src/server/dev/wa-mock-state.ts`)

```ts
type WaMockState = {
  …
  mediaMode: "ok" | "reject" | "slow";
  /** 028 — si está definido, mediaMode aplica solo a imágenes cuyo link lo contenga. */
  mediaLink?: string;
};
```

`POST /api/dev/wa-mock/media-mode` `{ mode, link? }`; `DELETE` deja `ok` y borra
`link`.

## Estado del stock-mock (`src/server/dev/stock-mock-state.ts`)

`MockProduct` no cambia de forma; el catálogo crece con las filas de research R9 y
`searchActive` acepta también los candidatos en singular de la consulta (misma regla
que MS-Stock R7).
