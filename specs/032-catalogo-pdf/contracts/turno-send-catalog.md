# Contrato — `send_catalog` y el cierre de `check_stock` (032)

**Fuente externa**: `uniko-integration.md` v2 del repo MS-Stock, §4 (cierre de
`check_stock` con más de 10 resultados) y §4b (`send_catalog`). Este documento fija cómo
lo implementa Uniko; si algo no cuadra con el contrato de MS-Stock, se corrige allá
primero.

## 1. Acción del modelo (solo con `INVENTARIO=on`)

```json
{ "action": "send_catalog", "reply": "¡Claro! Manejamos playeras y gorras por modelo y talla." }
```

- `reply` es opcional, una frase de entrada que **no promete el adjunto** (puede salir
  sola si no hay catálogo).
- Con la bandera apagada la acción no existe en el esquema del turno ni en el prompt.

## 2. Ejecución

1. `GET {STOCK_BASE_URL}/v1/agent/catalog` con `x-api-key`, 3 s, sin reintentos.
2. `200` con la forma `{ url, filename, updated_at }` ⇒ envío (§3). Cualquier otra cosa
   (`404`, `401`, `503`, timeout, red, forma inválida) ⇒ `degradeAction`: la frase del
   modelo como texto, o nada. El motivo va al log del servidor sin la llave.

## 3. Envío (lo hace el motor)

Pie (`caption`):

```text
<reply, si lo hay; recortado con «…» si hace falta>

Dime modelo y talla y te confirmo existencia y precio
```

(≤ 1024 caracteres; la frase fija nunca se recorta.)

| Situación | Lo que recibe el cliente |
|---|---|
| WhatsApp | UN mensaje `document` con `link = url`, `filename`, `caption` |
| WhatsApp rechaza o tarda > 5 s | un texto: pie + salto de línea + `url` |
| WhatsApp acepta y después reporta `failed` | un texto: pie + salto de línea + `url`, una sola vez |
| Canal sin documentos (Instagram, Messenger) | un texto: pie + salto de línea + `url` |
| Ventana de 24 h cerrada | escalado a humano (como todo envío del agente) |
| Laboratorio | el documento persistido (nombre, pie, enlace), sin tocar la API; el reporte de la corrida lo muestra como `[Documento: <filename>]` + pie |

El PDF nunca se descarga ni pasa por Uniko; la `url` nunca entra al prompt (en el respaldo
de texto el enlace queda en el hilo, pero se quita del historial que recibe el modelo).

## 4. Cierre de `check_stock` (varios productos)

| Productos con existencia tras el filtro | Recorte de MS-Stock | Catálogo | Cierre |
|---|---|---|---|
| ≤ 5 | no | — | ninguno |
| 6 a 10 | no | (no se consulta) | «Hay más coincidencias, ¿me dices cuál te interesa?» |
| > 10 | — | sí | «Hay más modelos en nuestro catálogo, ¿te lo mando?» |
| > 10 | — | no / falla | «Hay más coincidencias, ¿me dices cuál te interesa?» |
| cualquiera | sí | sí | «Hay más modelos en nuestro catálogo, ¿te lo mando?» |
| cualquiera | sí | no / falla | «Hay más coincidencias, ¿me dices cuál te interesa?» |

La consulta del catálogo para el cierre usa el mismo `getCatalog()` (3 s) y no altera los
5 productos mostrados ni sus fotos.

## 5. Simuladores (`/api/dev/*`, 404 en producción)

### stock-mock

| Ruta | Respuesta |
|---|---|
| `GET /api/dev/stock-mock/v1/agent/catalog` | `200 { url, filename, updated_at }` con catálogo (`url` = `…/catalogo.pdf?v=<n>`); `404 { error: { code: "NOT_FOUND", message: "No hay catálogo." } }` sin él. Llave y modos infelices como el resto de `/v1/agent/*` |
| `GET /api/dev/stock-mock/catalogo.pdf` | un PDF mínimo válido, `application/pdf`, sin llave |
| `POST /api/dev/stock-mock/_catalog` | `{ "present": false }` lo quita; `{ "present": true, "filename": "…" }` lo pone y sube `n` (como un reemplazo real, la URL cambia) |
| `POST /api/dev/stock-mock/_reset` | además, vuelve a «Catálogo de prueba.pdf» con `n = 1` |

Catálogo de productos: además de los actuales, «Calcetín» ×12 (`CAL-01`…`CAL-12`) y
«Sudadera» ×7 (`SUD-01`…`SUD-07`), todos con existencia.

### wa-mock

`POST …/messages` con `type: "document"` y `document: { link, filename, caption }` se
registra en el outbox; el modo de medios (`POST /api/dev/wa-mock/media-mode`, con `link`
opcional) aplica también a documentos (`reject` ⇒ `400` como Meta; `slow` ⇒ tarda más del
tope del motor).

### ai-mock

Con `send_catalog` en el system prompt: «¿qué venden?», «¿qué tienen?», «¿tienes
catálogo?», «mándame el catálogo» ⇒ `send_catalog` (frases ancladas: «¿Qué es lo más
popular que tienen?» o «En el catálogo dice…, ¿cuánto cuesta…?» no la disparan);
«catálogo completo» ⇒ frase de más de 1024 caracteres; tras un «¿te lo mando?» del
asistente, «sí» / «mándamelo» / «dale» ⇒ `send_catalog`. Sin la mención, nunca.
`GET /api/dev/ai-mock/_state` expone `lastPrompt` (el último prompt recibido) para
comprobar que la URL nunca llega al modelo.
