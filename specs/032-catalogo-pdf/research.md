# Research — 032 Catálogo PDF del negocio (`send_catalog`)

**Fecha**: 2026-10-05 · **Constitución**: 1.8.0 · Sin dependencias nuevas, sin migración,
sin variables nuevas. Contrato de origen: `uniko-integration.md` v2 del repo MS-Stock
(§4 cierre de `check_stock`, §4b `send_catalog`), desplegado el 2026-10-04 con la 006
de MS-Stock (`GET /v1/agent/catalog` verificado contra R2 real, 18/18).

## R1. Adaptador: `getCatalog()` en `client.ts`, la misma tubería que el resto

- **Decisión**: `src/server/inventario/client.ts` gana `getCatalog()` →
  `GET /v1/agent/catalog` por el `request()` existente (llave en `x-api-key`, 3 s,
  sin reintentos, nunca lanza). Esquema zod: `url` (http/https válida, como
  `toImageUrl`), `filename` (texto no vacío, ≤ 240 caracteres —límite de WhatsApp para el
  nombre de un documento—), `updated_at` (texto; solo informativo). Un 404 ya se mapea a
  `not_found`; cualquier otra forma es `invalid`. Sin caché: cada turno que lo necesita
  lo pide (la dirección cambia en cada reemplazo, contrato §4b).
- **Rationale**: `client.ts` es el ÚNICO módulo que conoce HTTP de MS-Stock (026); los
  motivos tipados (`not_found`, `unauthorized`, `unavailable`, `timeout`, `invalid`,
  `network`) ya cubren todos los casos de degradación del §4b.
- **Alternativas**: un cliente aparte para el catálogo (duplicaría timeout, llave y
  mapeo de errores); cachear la dirección por unos minutos (el contrato lo prohíbe: un
  reemplazo cambiaría la dirección y se enviaría la vieja). Rechazadas.

## R2. Turno: `sendCatalogTurn()` en `agent.ts`; el sistema arma el pie

- **Decisión**: `src/server/inventario/agent.ts` (que ya es "lo que el agente hace con el
  inventario") gana `sendCatalogTurn({ intro })` →
  `{ ok: true, document: { url, filename, caption }, fallbackText }` o `{ ok: false }`.
  - `caption` = `intro` (si no está vacío) + `\n\n` + `CATALOG_FOOTER` («Dime modelo y
    talla y te confirmo existencia y precio»). Si pasa de 1024, se recorta **el intro**
    a lo que quepa y se marca con «…»; la frase fija nunca se toca (FR-1704).
  - `fallbackText` = `caption` + `\n` + `url` (FR-1705/FR-1706).
  - `ok: false` ante cualquier motivo de `getCatalog()`, con `console.error` del motivo
    (sin la llave ni la URL completa), igual que `checkStockTurn` (FR-1708).
- **Rationale**: el modelo solo decide *cuándo*; el sistema compone el pie y la entrega,
  como con `check_stock`. Funciones puras fáciles de probar.

## R3. Cierre de `check_stock`: un umbral y una consulta condicional

- **Decisión**: `selectProducts()` devuelve también `total` (los que quedan tras el
  filtro de existencia y talla). En `checkStockTurn`, el cierre se decide en una función
  `closingFor(total, truncated)`:
  - `total ≤ 5` y sin recorte → sin cierre;
  - `6 ≤ total ≤ 10` y sin recorte → `HAY_MAS` (sin consultar el catálogo);
  - `total > 10` o recorte → `getCatalog()`; `ok` → `OFERTA` («Hay más modelos en
    nuestro catálogo, ¿te lo mando?»); cualquier fallo → `HAY_MAS`.
  Constantes: `CATALOG_OFFER_ABOVE = 10`. La consulta del catálogo ocurre **después** de
  armar los 5 mensajes y nunca los altera (FR-1710). El caso de un solo producto con
  `truncated` usa la misma función (en la práctica no ocurre).
- **Rationale**: el umbral es decisión del dueño (2026-10-04); la consulta extra solo en
  ese caso mantiene igual la latencia de los turnos comunes. Con MS-Stock caído el
  cierre cae a `HAY_MAS` y el turno no se pierde.
- **Alternativas**: consultar el catálogo siempre que haya más de 5 (llamada extra
  innecesaria de 6 a 10); que MS-Stock incluya el catálogo en la búsqueda (cambiaría su
  contrato `/v1/agent/search`). Rechazadas.

## R4. Entrega: `sendDocumentLink()` en `send.ts` y `deliverCatalog()` en `pipeline.ts`

- **Decisión**:
  - `src/server/inbox/send.ts` gana `sendDocumentLink({ conversationId, organizationId,
    link, filename, caption, aiGenerated, signal })`, espejo de `sendImageLink`: un
    mensaje Graph `type: "document"` con `document: { link, filename, caption }`; el
    binario no pasa por Uniko; se persiste el asset `kind: "document"` con
    `payload: { url }`, `fileName` y `caption`, y el mensaje `type: "document"` con el
    pie como `text` (estado `pending` donde hay acuses). Si Graph rechaza, no persiste
    nada y lanza (`SendError`), como la imagen.
  - `src/server/ai/pipeline.ts` gana `deliverCatalog(conversation, turn)` (exportada solo
    para su test): Laboratorio ⇒ persiste el documento (asset + mensaje) sin tocar la
    API (FR-1707); canal con medios ⇒ `sendDocumentLink` con tope de 5 s (el mismo
    `PHOTO_TIMEOUT_MS`); si falla (salvo ventana cerrada) ⇒ `sendText(fallbackText)`
    (FR-1706); canal sin medios ⇒ `sendText(fallbackText)` (FR-1705); ventana cerrada ⇒
    `applyHandoff(…, "ventana")` como `deliverReply`.
- **Capacidad del canal**: se reutiliza `outboundMedia` (hoy solo WhatsApp): quien envía
  imágenes por link envía documentos por link; no hace falta una capacidad nueva.
- **Rationale**: misma forma que la foto de la 026, que ya está probada en vivo; el
  historial del agente guarda el pie como texto (sin la URL), así que la dirección no
  entra al prompt (FR-1709).

## R5. Acción y degradación

- **Decisión**: `inventarioActions` gana `z.object({ action: z.literal("send_catalog"),
  reply: z.string().optional() })`; `degradeAction` la trata como `check_stock` (`reply`
  o `none`). En `pipeline.ts`, rama nueva junto a la de `check_stock`: bandera apagada ⇒
  degradar; `sendCatalogTurn` ok ⇒ `deliverCatalog` + `publish(conversation.updated)`;
  `ok: false` ⇒ degradar (FR-1708).
- Con la bandera apagada el esquema no la incluye: si el modelo la nombra igual, falla el
  parseo como hoy con cualquier acción desconocida (camino ya probado, US4).

## R6. Prompt

- **Decisión**: con `inventario`, `prompts.ts` agrega la línea de acción
  `{"action":"send_catalog","reply":"..."}` — «enviar el catálogo PDF del negocio cuando
  el cliente pregunta en general qué venden o pide el catálogo, o acepta que se lo
  mandes (reply es solo una frase de entrada y no debe prometer el adjunto)» — y tres
  reglas: «Para preguntas generales (qué venden, qué tienen, catálogo) → send_catalog»;
  «Si el sistema ofreció el catálogo (¿te lo mando?) y el cliente acepta → send_catalog»;
  «NUNCA describas, resumas ni cites el catálogo: no lo ves. Existencia y precio solo con
  check_stock; si algo del catálogo no coincide con el inventario, manda el inventario».
- La dirección del PDF nunca se escribe en el prompt (no está en ningún dato que el
  prompt reciba).

## R7. Simuladores

- **stock-mock**: estado `catalog: { filename, updatedAt } | null` (por defecto presente:
  «Catálogo de prueba.pdf»); `POST _catalog` (`{ present: boolean, filename? }`) para
  conmutarlo; `GET v1/agent/catalog` (bajo la misma llave y los mismos modos infelices
  que el resto de `/v1/agent/*`) ⇒ `{ url, filename, updated_at }` o `404 NOT_FOUND
  "No hay catálogo."`; `GET catalogo.pdf` sirve un PDF mínimo válido (sin llave, como las
  fotos públicas); `_reset` vuelve al catálogo presente. Catálogo de productos ampliado:
  una categoría con 12 modelos con existencia («Calcetín …») y otra con 7 («Sudadera …»)
  para el cierre de FR-1710, sin tocar las búsquedas que el arnés ya usa.
- **wa-mock**: acepta `type: "document"` con `document.link` (lo registra en el outbox
  como cualquier envío) y le aplica `mediaModeFor(link)` (rechazo o lentitud) igual que a
  la imagen, para ejercitar FR-1706.
- **ai-mock**: si el system prompt menciona `send_catalog` y el mensaje del cliente
  pregunta en general (`qué venden`, `qué tienen`, `catálogo`) o acepta tras un
  ofrecimiento («¿te lo mando?» en el último mensaje del asistente y «sí», «mándamelo»,
  «dale»), devuelve `{"action":"send_catalog","reply":"¡Claro!"}`; la regla va **antes**
  que la de `check_stock`. Sin la mención, nunca la propone (FR-1714).

## R8. Bandeja y Laboratorio

- **Decisión**: `message-thread.tsx` generaliza `linkedImageUrl` a `linkedUrl` para
  `image` **y** `document`: un documento enviado por URL se abre desde esa URL (no desde
  `/api/media/…`, donde no hay archivo). El nombre (`fileName`) y el pie (texto del
  mensaje) ya se pintan.
- **Rationale**: sin esto, el documento de la bandeja tendría un enlace roto; es el mismo
  ajuste que la 026 hizo para la foto. (El Laboratorio no pinta hilos sino transcripts: ver
  R12.1.)

## R9. Pruebas

- **Unit (Vitest)**: `getCatalog` (forma válida, 404, forma inválida, URL no http,
  timeout); `buildCatalogCaption` (con y sin intro, recorte con «…» y frase fija
  intacta, ≤ 1024); `sendCatalogTurn` (ok y cada fallo ⇒ `ok: false`); cierre de
  `checkStockTurn` (5, 6–10, 11 con y sin catálogo, recorte, catálogo caído, los 5
  mensajes intactos); esquema de acciones (solo con la bandera) y `degradeAction`;
  prompt (líneas solo con la bandera, sin URL); `deliverCatalog` (Laboratorio persiste
  documento; WhatsApp manda documento; rechazo ⇒ texto con enlace; canal sin medios ⇒
  texto); stock-mock (ruta del catálogo con y sin, PDF servido, categorías nuevas);
  wa-mock (documento por link y rechazo); ai-mock (propone solo con la mención; acepta
  el ofrecimiento).
- **Arnés** (`scripts/e2e-selftest.mjs`, sección «032», solo con `INVENTARIO=on`):
  «¿qué venden?» ⇒ un mensaje de documento con nombre y pie en el outbox del wa-mock;
  sin catálogo ⇒ solo la frase; stock-mock `down` ⇒ degrada en < 5 s; categoría de 12 ⇒
  5 + ofrecimiento; aceptar ⇒ documento; categoría de 7 ⇒ «Hay más coincidencias»; 12
  sin catálogo ⇒ «Hay más coincidencias»; documento rechazado por el wa-mock ⇒ texto con
  enlace; Laboratorio ⇒ documento persistido. Con la bandera apagada, la corrida
  existente sin cambios.

## R10. Documentación y trazabilidad

- `docs/inventario-conector.md`: sección «Catálogo PDF (032)».
- `tests/e2e/us-inventario.md`: casos nuevos de la 032.
- `specs/028-respuesta-por-talla/spec.md`: marca DEROGADO EN PARTE junto a FR-1308 y la
  mención «029» del catálogo corregida a «032» (FR-1711, Principio VII).
- `CLAUDE.md`: la fila del inventario menciona `send_catalog` y el cierre con catálogo.
- Memoria del repo: nota de la 032 al cerrar.

## R11. Verificación en vivo y despliegue

- Local: gate + arnés con `INVENTARIO=on` y apagada; luego contra MS-Stock local (stub
  S3) con un PDF real.
- Instancia de pruebas: merge a `main` ⇒ `uniko-lanco` (con `INVENTARIO=on`) contra
  `stock.lanco.cloud`. Se sube un catálogo de prueba por la API de MS-Stock, se ejerce
  en el Laboratorio de la instancia desplegada (sin tocar WhatsApp) y se pide al dueño
  la prueba por WhatsApp (SC-006). Al terminar se quita el catálogo de prueba si el
  dueño no sube el suyo.
- **Promoción a `production`**: señal aparte del dueño, con la puerta de la constitución
  (llega a NuriaAndrea, que tiene `INVENTARIO=on`).

## R12. Ajustes al bajar a tareas (2026-10-05)

Al detallar las tareas contra el código salieron seis huecos del diseño. Se resuelven así,
sin tocar el contrato de MS-Stock:

1. **El Laboratorio enseña transcripts, no hilos** (`src/components/lab/lab-client.tsx`;
   las conversaciones de prueba no se abren en la bandeja). Para que el reporte muestre el
   documento con su nombre (US1-5) y el juez sepa que se envió, `src/server/lab/runner.ts`
   arma el transcript con una función pura `transcriptDe`: un saliente `document` se ve
   como `[Documento: <fileName>]` + salto de línea + pie. El ajuste de `message-thread.tsx`
   (R8) es para la bandeja. La prueba automática del Laboratorio va en
   `scripts/e2e-lab.mjs`, con un escenario propio como el de la 026.
2. **`failed` tardío del documento**: Meta puede aceptar el link y reportar `failed`
   después (no pudo descargarlo). `src/server/inbox/status.ts` ya manda el pie de una foto
   como texto en ese caso (FR-1120); para el documento manda pie + salto + URL (el texto de
   FR-1706), una sola vez (estados monotónicos).
3. **`/api/media/<asset>` de un documento por URL**: hoy solo redirige imágenes; un
   documento sin archivo local respondería 410. Pasa a redirigir (302) también `document`
   con `payload.url` http(s).
4. **La URL del respaldo no entra al prompt** (FR-1709, SC-004): el texto de respaldo
   queda en el hilo con el enlace (es lo que recibió el cliente), pero al armar el
   historial del prompt `stripCatalogLink` quita la línea del enlace que sigue a la frase
   fija. Corrige el invariante que decía lo contrario en [data-model.md](data-model.md).
5. **El ai-mock registra el último prompt** (`lastPrompt` en
   `src/server/dev/ai-mock-state.ts`, junto a `lastModel`) para que el arnés compruebe
   SC-004 en vez de suponerlo. Al implementarlo salió un defecto latente de la 015: el
   estado vivía en una variable de módulo y en `next dev` la ruta `_state` tenía su
   propia copia (tras cientos de turnos seguía en `lastModel: null`; el check de
   `AGENDA_MODEL` nunca lo notó porque solo corre con esa variable). Pasa a
   `globalThis`, como el wa-mock y el stock-mock.
6. **Simuladores más precisos**: las frases que disparan `send_catalog` en el ai-mock van
   ancladas (la persona del Laboratorio «¿Qué es lo más popular que tienen?» no debe
   dispararla, y «En el catálogo dice…, ¿cuánto cuesta…?» sigue siendo `check_stock`);
   «catálogo completo» devuelve una frase de más de 1024 caracteres para ejercitar FR-1704
   en el arnés; la URL del catálogo del stock-mock lleva `?v=<n>`, que cambia con cada
   `_catalog` presente, como un reemplazo real.

**Canal sin documentos**: el arnés de Instagram (`scripts/e2e-instagram.mjs`) no conduce
turnos del agente, así que FR-1705 se prueba en unit (`deliver-catalog.test.ts`), como
permite FR-1715 («si el arnés lo permite»).
