# Delta al contrato inter-repo — `uniko-integration.md` §4 de MS-Stock

Texto que se aplica en **MS-Stock** (`specs/003-sso-uniko/contracts/uniko-integration.md`,
sección 4 "Acción del agente: `check_stock`") **antes** de programar la 028 en Uniko
(FR-1310). Aquí se cita; la fuente queda allá. Cuatro cambios:

## D1. Ejecución, paso 2: límite y plural

Sustituir

> 2. `GET {STOCK_BASE_URL}/v1/agent/search?q={query}&limit=5` ⇒ …

por

> 2. `GET {STOCK_BASE_URL}/v1/agent/search?q={query}&limit=25` ⇒ `{ "results": [...],
>    "truncated": bool }` (`limit` máximo 25; `q` de 2 a 100 caracteres). Uniko pide el
>    máximo porque filtra del lado suyo (por talla y por existencia) y muestra a lo sumo
>    5 (028). **La búsqueda tolera el plural** de la consulta ("playeras negras" encuentra
>    "Playera negra"; "pantalones", "Pantalón"): cada palabra de cuatro letras o más se
>    prueba también sin su `s` final y, si termina en `es`, sin `es` (ajuste 2026-09-15 a
>    FR-017 de la 001). El orden por relevancia no cambia.

## D2. "Cómo pegarlo al prompt" → "Cómo se redacta al cliente"

Sustituir el bloque completo **"Cómo pegarlo al prompt"** por:

> **Cómo se redacta al cliente** (lo hace el motor de Uniko, nunca el modelo; el modelo
> solo aporta la frase de entrada y separa nombre base y talla). Forma vigente desde la
> 026 (2026-09-12/14) y la 028 (2026-09-15):
>
> - **Producto sin tallas**: `Nombre (SKU): 7 pieza — $199 MXN` (`agotado`; `sin
>   precio` si `price` es `null`).
> - **Modelo con tallas, sin talla pedida**: `Nombre (SKU) — $219 MXN. Tallas: CH 4,
>   M agotada, G 7, XG 1` (en el orden recibido, agotadas incluidas).
> - **Modelo con tallas, talla pedida, un solo producto resuelto**: `Nombre (SKU) talla
>   G: 7 pieza — $219 MXN`; agotada: `… talla M: agotada — $219 MXN. Con existencia: CH
>   4, G 7, XG 1`; talla que no trae: `… no viene en talla XXG. Tallas: CH 4, M agotada,
>   G 7, XG 1`.
> - **Talla consultada por SKU exacto** (`label` no nulo): `Nombre (PLY-NEG-G) talla G: 7
>   pieza — $199 MXN`.
> - **Varios productos resueltos (028)**: solo los que tienen **existencia** —en la
>   talla pedida si la hubo (`variants[i].stock > 0` para esa etiqueta o su
>   equivalencia; un producto sin tallas cuenta si `stock > 0`), o en general si no la
>   hubo (`stock > 0`)—, **una línea y un mensaje por producto**, en el orden recibido,
>   máximo 5; los agotados y los que no traen la talla **no se mencionan**. Ninguno con
>   existencia: `Por ahora no tengo <consulta> en talla <talla>.` (o `… con
>   existencia.`). Si quedaron más de 5 o `truncated`: `Hay más coincidencias, ¿me dices
>   cuál te interesa?` al final.
> - Lista vacía: `No encontré productos para «…».`
> - `image_url` no se pega en ningún texto ni entra al prompt.

## D3. "Foto del producto": de "a lo sumo la del primero" a "una por producto"

Sustituir el tercer punto de la lista de reglas

> - Con varios resultados (`search`), enviar a lo sumo la foto del primero o ninguna;
>   no una ráfaga de imágenes. Con un modelo, la foto es una sola (la misma para todas
>   sus tallas): enviarla a lo más **una vez por turno**, aunque el cliente pregunte por
>   varias tallas.

por

> - Con varios productos mostrados (028): **una imagen por producto** que tenga
>   `image_url`, con la línea de ese producto como pie, en el orden de la respuesta, en
>   serie y con tope de **5 imágenes por turno**; la misma foto nunca dos veces en un
>   turno (la de un modelo es la misma en todas sus tallas). Los productos sin foto van
>   como texto en su posición. Si ninguno tiene foto, o el canal no admite imágenes, todo
>   el turno sale como **un** solo texto. (Hasta la 028 regía "a lo sumo la foto del
>   primero"; la ráfaga acotada la pidió el negocio: el cliente preguntó por una talla y
>   quiere ver lo que sí hay.)

## D4. Prompt: singular

En la lista **"Prompt"**, sustituir el primer punto

> - Buscar por el **nombre base** del producto, sin la talla ("playera negra", no
>   "playera negra grande"): la respuesta trae todas las tallas.

por

> - Buscar por el **nombre base** del producto, **en singular** y sin la talla
>   ("playera negra", no "playeras negras grandes"): la respuesta trae todas las tallas;
>   la talla que pidió el cliente va en `size`. (MS-Stock tolera el plural de todos
>   modos, D1.)

## Fuera del contrato (mismo PR de MS-Stock)

- `specs/001-…/spec.md`: amendment a FR-017 ("… sin distinguir mayúsculas, acentos ni
  el plural de la consulta") con fecha; `specs/001-…/tasks.md`: tareas del ajuste.
- `README.md` y `CLAUDE.md` de MS-Stock: hoja de ruta, "lado Uniko: 028 (respuesta por
  talla y fotos por producto)"; búsqueda tolerante al plural en el mapa del código.
