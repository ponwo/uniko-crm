# Research — 028 Respuesta por talla y fotos por producto

Decisiones de diseño con su motivo y las alternativas descartadas. Todas parten del
código real de la 026 (`src/server/inventario/agent.ts`, `client.ts`,
`src/server/ai/pipeline.ts`) y del catálogo real de `stock.lanco.cloud` (2026-09-15).

## R1. El turno devuelve una lista de mensajes, no un texto con una foto

**Decisión**: `checkStockTurn` pasa a devolver `{ ok, messages: StockMessage[] }` con
`StockMessage = { text: string; imageUrl: string | null }`, uno por producto mostrado
(o uno solo para las frases "no encontré", "por ahora no tengo…", el caso de un
producto y el cierre "Hay más coincidencias…"). La frase de entrada del modelo se
antepone al `text` del primer mensaje. `text` e `imageUrl` siguen siendo los únicos
campos: el pipeline no aprende de inventario.

**Rationale**: la 026 acopló "un turno = un texto (+ una foto)" y esa forma no puede
expresar "una foto por producto". Una lista ordenada es la forma mínima que sí lo
expresa y deja la entrega (pie, respaldo, colapso) en el pipeline, donde ya vive.

**Alternativas**: (a) devolver `{ text, imageUrls[] }` y mandar el texto + N fotos sin
pie — rompe la asociación foto↔producto, que es justo lo que pidió el dueño; (b) que
`agent.ts` mande los mensajes — mezclaría redacción con canal y perdería el sandbox
del Laboratorio (`persistTestOutbound`) y la regla de la ventana cerrada.

## R2. Selección del conjunto: una función pura con cuatro casos

**Decisión**: `selectProducts(products, size)` devuelve `{ shown, none }` y la
redacción se decide por **número de productos resueltos**:

| Caso | Regla | Redacción por producto |
|---|---|---|
| 0 productos | — | `No encontré productos para «…».` (igual que hoy) |
| 1 producto | se muestra siempre (con o sin `size`, con o sin existencia) | `formatProduct(p, size)` **sin cambios** (FR-1302, FR-1304) |
| ≥ 2, con `size` | se muestran los que tienen existencia en esa talla (`matchVariant(...).stock > 0`) y los **sin tallas** con existencia (`variants.length === 0 && stock > 0`) | con tallas: `Nombre (SKU) talla G: 7 pieza — $219 MXN`; sin tallas: la línea de siempre |
| ≥ 2, sin `size` | se muestran los que tienen existencia (`stock > 0`) | la línea vigente (`… — precio. Tallas: …` o la simple) |

Con ≥ 2 y `shown` vacío: `Por ahora no tengo <query> en talla <size>.` o `Por ahora no
tengo <query> con existencia.`; `query` y `size` se imprimen como los mandó el modelo
(recortados). Se muestran a lo sumo `SHOW_LIMIT = 5`; si quedaron más, o MS-Stock marcó
`truncated`, se añade un último mensaje de texto `Hay más coincidencias, ¿me dices cuál
te interesa?`.

**Rationale**: "un producto" es el único caso en el que la alternativa útil es el
mismo producto en otra talla (decisión del dueño); en el resto, lo que no tiene lo
pedido es ruido. Reutilizar `formatProduct` tal cual para un producto garantiza la
regresión cero de la 026 (SC-002) sin duplicar redacción.

**Alternativas**: (a) aplicar el filtro también con un producto — el dueño quiere la
redacción rica ahí; (b) mostrar los agotados en una línea — rechazado explícitamente
(invasivo con 20 modelos); (c) omitir los productos sin tallas en preguntas con talla —
ocultaría lo único que hay ("¿gorra en G?" con gorras de talla única).

## R3. El adaptador pide 25 y el motor muestra 5

**Decisión**: `lookup` llama a `search` con `limit = 25` (máximo de MS-Stock) siempre;
`SHOW_LIMIT = 5` vive en `agent.ts`. `truncated` de MS-Stock se propaga y se OR-ea con
"quedaron más de 5 con existencia".

**Rationale**: al filtrar del lado Uniko, de 5 recortados podrían quedar 0 con la
talla pedida aunque existan (FR-1308). El JSON de 25 modelos con hasta 30 tallas cada
uno sigue siendo pequeño (< 100 KB) y una sola llamada. Pedir 25 siempre (no solo con
`size`) evita dos caminos y sirve para omitir agotados sin talla.

**Alternativas**: (a) `size=` en la búsqueda de MS-Stock — acopla la regla de
redacción al inventario y exige un despliegue coordinado; (b) paginar — más llamadas
por turno y más latencia por nada.

## R4. Una foto por producto mostrado, tope 5, sin repetir, pie = su línea

**Decisión**: cada `StockMessage` lleva `imageUrl = p.image_url` si el producto la
trae y no se ha usado ya en el turno (dedupe por URL; en la práctica equivale a por
modelo porque cada modelo tiene su clave propia en R2) y si aún no se alcanzó
`MAX_PHOTOS = 5`; de lo contrario `imageUrl = null` y la línea va como texto. Como
`SHOW_LIMIT = 5`, el tope de fotos nunca deja sin foto a un producto mostrado: existe
como guardarraíl explícito (SC-004) y para el caso de que un día se muestren más.

**Rationale**: es la petición literal del dueño ("las fotos de cada uno de esos
productos que sí tienen existencia en esa talla") con una cota que sustituye a la
prohibición de la 026 y que el arnés verifica.

**Alternativas**: un álbum/carrusel — WhatsApp Cloud API no ofrece álbumes salientes;
`interactive product` requiere catálogo de Meta, fuera de alcance.

## R5. Entrega secuencial en el pipeline, reutilizando `deliverReply` por mensaje

**Decisión**: `deliverReplies(conversation, messages)` recorre la lista **en orden y
en serie** y llama a `deliverReply(conversation, text, { imageUrl })` por mensaje: así
cada uno hereda la regla de la 026 (pie si ≤ 1024, si no texto + foto sin pie; foto
rechazada o > 5 s ⇒ texto solo, motivo al log; `is_test` ⇒ `persistTestOutbound`).
**Colapso**: si ningún mensaje tiene `imageUrl` enviable (todos `null`, o el canal no
tiene `outboundMedia`), se manda **un solo** texto con todas las líneas unidas por
`\n`, exactamente como hoy (FR-1306). `SendError` `window_closed` en cualquier
mensaje ⇒ `applyHandoff` y se detiene la serie (los siguientes tampoco saldrían). Un
solo `publish(conversation.updated)` al final.

**Rationale**: el pipeline ya sabe todo lo difícil (pie, respaldo, sandbox, ventana);
solo faltaba iterar. El colapso conserva el comportamiento de los canales sin imágenes
y de los productos sin foto (un texto), que es lo que hoy verifican los tests.

**Alternativas**: enviar en paralelo (`Promise.all`) — pierde el orden de llegada en
WhatsApp y dispara N llamadas simultáneas a Graph; no vale el ahorro (las fotos por
link responden en < 1 s normalmente).

## R6. Prompt: "en singular"

**Decisión**: la línea de la acción dice `"query":"<nombre base del producto, en
singular y sin la talla, o su SKU>"` y la regla añade "Escribe el nombre en singular
(playera, no playeras)". Nada más cambia en el prompt; `size` sigue igual.

**Rationale**: capa de defensa adicional al plural tolerado en MS-Stock (R7); barata
y explícita. El test del prompt comprueba la palabra.

## R7. MS-Stock: la búsqueda tolera el plural (repo hermano, antes que este código)

**Decisión**: en `app/services/products.py::_matches`, además del `needle`
normalizado se prueban **candidatos en singular** de la frase completa: cada palabra
de ≥ 4 letras que termina en `s` pierde la `s`; la que termina en `es` genera además la
forma sin `es` ("playeras negras" → "playera negra"; "pantalones" → "pantalone" y
"pantalon"). Los candidatos se OR-ean con `LIKE '%…%'` sobre `name_search` (a lo sumo 3
términos). El orden por relevancia usa el `needle` original. Se registra como
amendment de FR-017 en `specs/001-…/spec.md` + tareas en su `tasks.md`, con tests en
`tests/contract/test_agent_search.py` (plural simple, plural en `-es`, frase mixta, un
nombre ya plural sigue encontrándose en singular por "contiene"). Sin cambio de
contrato: mismo endpoint, misma forma.

**Rationale**: la dirección nombre-singular/consulta-plural es la única que "contiene"
no cubre ("playera" ⊂ "playeras" sí; al revés no). Resolverlo en MS-Stock beneficia
también al portal y a cualquier consumidor, y se verifica con su propio gate contra
Postgres real. El stock-mock de Uniko replica la misma regla para que el arnés la
ejercite (R9).

**Alternativas**: (a) solo el prompt — depende del modelo; (b) reintentar en Uniko con
la palabra singularizada si hubo 0 resultados — dos llamadas por fallo y lógica de
idioma en el CRM; (c) `pg_trgm`/similaridad — cambia el ranking y exige extensión;
desproporcionado para un plural.

## R8. Derogaciones en la 026 (Principio VII)

**Decisión**: en el PR de implementación, `specs/026-conector-inventario/spec.md`
recibe, junto a FR-1110, FR-1111, FR-1119, FR-1124 y FR-1125, el tachado **solo de la
parte derogada** y un bloque `**DEROGADO** (parcial, 028 — <PR>)` con el motivo; las
menciones en `data-model.md`, `research.md`, `quickstart.md` y `tasks.md` de la 026 (una
cada uno) reciben una nota `(028: …)`. El caso 9 de `tests/e2e/us-inventario.md` se
reescribe; el check "a lo sumo UNA imagen (la del primero)" del arnés se sustituye por
la regla nueva. Los comentarios del código que citan esos FR (`agent.ts`, `pipeline.ts`,
`client.ts`, tests) se actualizan a FR-13xx donde la regla cambió.

**Rationale**: la constitución exige las dos anotaciones y la propagación a todos los
artefactos, en el mismo PR. Son pocas menciones (10 en specs, 8 en código/tests).

## R9. Mocks: réplica del catálogo real en el stock-mock y rechazo por link en el wa-mock

**Decisión**:

- **stock-mock** (`STOCK_MOCK_CATALOG`, añadidos al final para no mover el orden que
  los tests de la 026 esperan; cada foto con URL distinta vía query string sobre los
  dos íconos de `public/`):

  | SKU | Nombre | Precio | Tallas | Foto |
  |---|---|---|---|---|
  | `PLA-AZL` | Playera azul | $800 | XCH 1, CH 5, XG 2 | `/icon-512.png?m=azl` |
  | `PLA-VRD` | Playera verde | $200 | CH 2, M 10, XG 10 | `/icon-192.png?m=vrd` |
  | `PLA-GRS` | Playera gris | $250 | M 0, G 3, XG 4 | `/icon-512.png?m=grs` |
  | `PLA-AMA` | Playera amarilla | $150 | CH 1 | `/icon-192.png?m=ama` |
  | `PAN-AZ` | Pantalón azul | $650 | 30 2, 32 4, 34 0 | `/icon-512.png?m=pan` |
  | `PAN-NG` | Pantalón negro | $650 | 32 1, 34 3, 36 2 | — |

  Con los existentes (`PLY-NEG` simple con foto, `PLY-BLA` simple agotada, `PLY-ROJ`
  con tallas sin foto), "playera" resuelve a **7** modelos (6 con existencia ⇒ prueba
  el tope 5 + "Hay más"); "en G" ⇒ NEG (simple, foto), ROJ (texto), GRS (foto);
  "en M" ⇒ NEG, VRD; "en XCH" ⇒ NEG, AZL; "pantalones en 40" ⇒ ninguno (frase, y
  ejercita el plural); "pantalones en 32" ⇒ PAN-AZ (foto), PAN-NG (texto).
  `searchActive` tolera el plural con la misma regla que R7.
- **wa-mock**: `media-mode` acepta `{ mode, link? }`; con `link`, el modo `reject`/`slow`
  aplica solo a las imágenes cuyo `image.link` contenga esa subcadena; sin `link`, a
  todas (comportamiento actual). Se resetea con el `DELETE` existente.

**Rationale**: los escenarios de la spec necesitan tallas cruzadas, un modelo sin foto
en la lista, una talla que nadie tiene y más de cinco con existencia; y US4 necesita
que falle **una** imagen y no todas. Añadir al final conserva intactos los textos que
la 026 verifica.

**Alternativas**: sustituir el catálogo del mock por el real — rompería los 17 casos y
la promesa de regresión cero.

## R10. Pruebas

**Decisión**: unit — `check-stock-turn.test.ts` (selección por caso, orden, tope,
dedupe, frases, un producto idéntico a la 026, `truncated`), `stock-client.test.ts`
(`limit=25`), `inventario-prompt.test.ts` (singular), `stock-mock.test.ts` (catálogo,
plural, talla por SKU), `wa-mock-media.test.ts` (rechazo por link). Arnés: caso 9
reescrito + sección "028" con US1 (G, M, XCH, 24/40, plural, sin foto, equivalencia),
US3 (7 modelos ⇒ 5 fotos + "Hay más"), US4 (rechazo de la segunda imagen, orden),
Laboratorio (hilo con N imágenes). CI en `default` (nada cambia) y `completo`.

## R11. Contrato inter-repo primero

**Decisión**: el delta de §4 ([contracts/forma-exacta-delta.md](contracts/forma-exacta-delta.md))
se aplica en MS-Stock (junto con R7) en un PR propio del repo hermano **antes** de
tocar `agent.ts`; esta feature lo cita. El README/CLAUDE.md de MS-Stock anotan "lado
Uniko: 028".

**Rationale**: regla de la casa ("se cambia ahí, nunca a ojo en Uniko") y FR-1310.
