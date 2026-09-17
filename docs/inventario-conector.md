# Conector de inventario (MS-Stock)

Uniko no lleva inventario: lleva conversaciones. El catálogo, las existencias
y los movimientos viven en **MS-Stock**, un microservicio aparte —una instancia
por negocio, con su propia base de datos— que expone una API para el agente y un
portal para la persona. Este conector enlaza las dos piezas sin que el CRM
absorba lógica de inventario, y sigue las mismas reglas que los demás módulos
opcionales ([ADR-001](adr-001-canales-opcionales.md), Principio II).

> Apagado por defecto. Sin `INVENTARIO=on` no hay botón, ni acción del agente,
> ni pestaña de Ajustes, ni una palabra de inventario en el prompt — ni se piden
> sus variables.

## Qué hace, encendido

- **Botón "Inventario"** en la navegación (tras Pipeline y Citas): abre el
  portal de MS-Stock en una pestaña nueva, ya autenticado. Uniko emite un
  **pase** de un solo uso y dos minutos (JWT firmado con un secreto compartido);
  MS-Stock lo verifica, abre su sesión y muestra "<tu nombre> desde Uniko".
  MS-Stock no tiene usuarios: la identidad es la de Uniko.
- **`check_stock` en el agente**: antes de afirmar que hay existencia de algo o
  cuánto cuesta, el agente consulta MS-Stock y responde con lo que devuelve
  (nombre, SKU, existencia con unidad, precio con moneda). El modelo solo aporta
  la frase de entrada; los datos los pega el sistema, así que **no puede
  inventar existencias**. Si no hay coincidencias lo dice; si hay más de cinco,
  pide precisar.
- **Ajustes → Inventario**: a qué instancia apunta y "Probar conexión"
  (Conectado / Llave rechazada / Servicio no disponible).

## Foto del producto

Desde la feature 004 de MS-Stock cada producto trae `image_url`: la dirección
**pública y permanente** de su foto principal (o `null` si no tiene, o si esa
instancia no tiene fotos habilitadas). Cuando el producto que resolvió
`check_stock` trae foto, el agente manda por WhatsApp **un** mensaje de imagen
por URL con el texto del turno como pie (`caption`): el cliente ve la foto y,
debajo, existencia y precio. Reglas:

- **Uniko no descarga, reescala ni proxea la foto**: le pasa la URL a WhatsApp
  (`image.link`) y la sirve quien la aloja (Cloudflare, no MS-Stock). En el hilo
  del Inbox la imagen se pinta desde esa misma URL.
- **La foto nunca bloquea ni retrasa la respuesta**: si WhatsApp rechaza la
  imagen o no contesta en 5 s, sale solo el texto (y el motivo queda en el log como
  `[agente] foto: …`); si la acepta y después la reporta `failed` (no pudo
  descargarla), el texto del pie sale como mensaje de texto, una sola vez. El
  cliente nunca ve un error.
- **A lo sumo una foto por turno**: con varias coincidencias, la del primer
  producto (o ninguna); nunca una ráfaga.
- `image_url` **no llega al modelo** (sería ruido) ni se guarda fuera del mensaje
  enviado: cambia cada vez que el negocio sube una foto nueva y se usa en el turno.
- En Instagram y Messenger (sin imágenes salientes hoy) va solo el texto. Un pie
  más largo de lo que WhatsApp admite (1024 caracteres) sale como texto aparte y la
  foto sin pie.

Con `image_url` en `null`, o con la bandera apagada, nada cambia. Subir,
reemplazar o quitar fotos se hace en el portal de MS-Stock (o por su API), no
desde Uniko.

## Tallas

Desde la feature 005 de MS-Stock un producto puede ser un **modelo con tallas**
("Playera roja" con CH, M, G, XG): cada talla tiene su propio SKU (`PLY-ROJ-G`) y
su propia existencia; el modelo agrupa nombre, precio y foto. La respuesta trae
`variants` (las tallas activas, en el orden del negocio, con su existencia) y, si lo
que se consultó por SKU es una talla, `label` y `parent_sku`.

Como siempre, **el modelo no redacta cifras**: solo separa el nombre base de la
talla (`{"action":"check_stock","query":"playera roja","size":"G"}`) y el sistema
redacta:

- sin talla pedida: `Playera roja (PLY-ROJ) — $219 MXN. Tallas: CH 4, M agotada, G 7, XG 1`;
- con talla pedida: `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN`; agotada:
  `… talla M: agotada — $219 MXN. Con existencia: CH 4, G 7, XG 1`; una talla que el
  modelo no tiene: `… no viene en talla XXG. Tallas: CH 4, M agotada, G 7, XG 1`;
- SKU exacto de una talla: `Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN`.

Las etiquetas son las del negocio (`G`, `38`, `Única`); si el cliente escribe
"grande", "mediana", "chica", "extra grande" o "extra chica" y ninguna etiqueta
coincide literalmente, el motor las equipara a G, M, CH, XG y XCH. La foto de un
modelo es una sola (la misma para todas sus tallas) y nunca se manda dos veces en
un turno. Un producto sin tallas (o un MS-Stock anterior a la 005) se responde
exactamente igual que antes: `variants`, `label` y `parent_sku` ausentes se
toleran.

## Respuesta por talla y fotos por producto (028)

Lo de arriba es para **un** producto. Cuando la pregunta abarca **varios** modelos
("¿tienen playeras en G?", que en un negocio de ropa coincide con todas las
playeras), el agente ya no enumera cada modelo ni manda la foto del primero:

- **Con talla pedida**: solo los modelos que tienen **existencia en esa talla**,
  cada uno en **su propio mensaje**, con **su foto** (si la tiene) y su línea como
  pie: `Playera Negra (PLA-NGO) talla G: 8 pieza — $300 MXN`. Los agotados en esa
  talla y los que no la traen **no se mencionan**. Un producto sin tallas cuenta si
  tiene existencia (es de talla única). Si ninguno tiene existencia: `Por ahora no
  tengo playera en talla 24.`
- **Sin talla pedida**: un mensaje por modelo con existencia, con la línea de sus
  tallas y su foto; los agotados no aparecen. Ninguno con existencia: `Por ahora no
  tengo playera con existencia.`
- **Tope**: se muestran 5 (la búsqueda pide hasta 25 a MS-Stock para poder filtrar);
  si quedan más, o MS-Stock recortó, cierra con `Hay más coincidencias, ¿me dices
  cuál te interesa?`. Nunca más de 5 imágenes por turno ni la misma foto dos veces.
- **Entrega**: los mensajes salen en orden, uno tras otro; la frase de entrada del
  modelo va en el primero. Como Meta entrega cada imagen por URL cuando termina de
  descargarla (y dos fotos seguidas podían llegar invertidas), el motor espera el
  `sent` de la foto anterior —tope 2 s— antes de mandar el siguiente mensaje. Si la
  foto de un modelo falla o tarda más de 5 s, **esa** línea sale como texto y las demás
  siguen con foto; en un canal sin imágenes, o si ningún modelo tiene foto, todo el
  turno sale como un solo texto. El Laboratorio persiste cada mensaje como lo vería el
  cliente.
- **Plural**: el prompt pide el nombre base en singular y MS-Stock además tolera el
  plural ("playeras negras" encuentra "Playera negra"), así que la palabra del cliente
  no lo deja sin respuesta.

Con un solo modelo resuelto nada cambia respecto a la sección anterior. Detalle y
derogaciones de la 026: `specs/028-respuesta-por-talla/`.

## Qué pasa cuando MS-Stock falla

El turno **degrada**: el agente contesta con su frase (o no contesta), la
conversación sigue y el cliente nunca lee "el sistema falló". Cada fallo queda
en el log del servidor como `[agente] inventario: <motivo>` (`unavailable`,
`timeout`, `unauthorized`, `invalid`, `network`). Cada consulta espera como
máximo 3 s y no reintenta. Es la misma regla que la agenda: quedarse mudo es
peor que no dar existencias.

## Variables

| Variable | Valor |
|---|---|
| `INVENTARIO` | `on` para encender (mismos valores que `AGENDA`) |
| `STOCK_BASE_URL` | origen público de la instancia de MS-Stock **de este negocio**, sin barra final (`https://stock.tudominio.com`). Debe ser exactamente su `APP_BASE_URL`: es el destinatario del pase |
| `STOCK_API_KEY` | la llave de esa instancia (su `STOCK_API_KEY`, mínimo 32). Solo la usa el servidor |
| `STOCK_SSO_SECRET` | el secreto compartido para el pase (su `UNIKO_SSO_SECRET`, mínimo 32; `openssl rand -hex 32`, el mismo valor en los dos lados) |

Con la bandera encendida las tres son obligatorias: la instancia **no arranca a
medias** (`/api/health` responde 503 y el despliegue no se da por sano). En
Coolify van como variables de runtime, igual que el resto.

Uniko y MS-Stock conviven bien en la misma red de Docker, pero el pase y el
botón los abre el navegador de la persona: usa el origen **público** de
MS-Stock, no el alias interno.

## Cómo probarlo sin MS-Stock

El entorno de pruebas trae un MS-Stock de mentira (`/api/dev/stock-mock`, solo
con `WA_MOCK_ENABLED=true` y fuera de producción) con un catálogo fijo y modos
infelices (`down`, `unauthorized`, `slow`, `garbage`); `PLY-NEG` y `TAZ-01`
traen foto (un PNG de la propia app) y el resto no. Para el envío de la foto, el
wa-mock tiene su propio modo (`POST /api/dev/wa-mock/media-mode` con `ok`,
`reject` o `slow`). En `.env`:

```bash
INVENTARIO=on
STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock
STOCK_API_KEY=desarrollo-local-stock-key-0123456789abcdef
STOCK_SSO_SECRET=desarrollo-local-sso-secret-0123456789abcdef
```

`pnpm test:e2e` conduce el guion [`tests/e2e/us-inventario.md`](../tests/e2e/us-inventario.md):
el botón con su pase, el agente consultando (feliz e infeliz) y Ajustes. Con la
bandera apagada corre la otra mitad: que nada de esto existe.

## Contra MS-Stock de verdad

Con el repo hermano corriendo en local (`uv run uvicorn app.main:create_app
--factory --port 8000` en `../MS-Sotck`, con su `UNIKO_SSO_SECRET` igual a tu
`STOCK_SSO_SECRET`), apunta `STOCK_BASE_URL=http://127.0.0.1:8000` y usa su
`STOCK_API_KEY`. El botón aterriza en el portal real y el agente responde con
productos reales.

## El contrato manda allá

Lo que Uniko envía y espera está fijado por MS-Stock en
`specs/003-sso-uniko/contracts/uniko-integration.md` (repo `ponwo/ms-stock`).
Si algo no cuadra, se corrige en ese contrato y se cita aquí; nunca se adivina en
Uniko. El único módulo que conoce HTTP de MS-Stock es
`src/server/inventario/client.ts`.

## Lo que NO hace (a propósito)

- No registra ventas ni reserva existencias: `check_stock` es solo lectura.
- No muestra el inventario dentro de Uniko: para eso está el portal de MS-Stock.
- No se configura desde Ajustes (las variables viven en el despliegue).
- No restringe el botón por rol: todo miembro con sesión puede entrar.
