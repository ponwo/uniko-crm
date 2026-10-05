# Data Model — 032 Catálogo PDF del negocio

**Fecha**: 2026-10-05. **Sin cambios en `drizzle/`**: el tipo de mensaje `document` y el
adjunto `kind: "document"` ya existen (008); la 032 solo los usa para un documento
enviado por URL. Todo lo demás vive en el turno, en memoria.

## Lo que devuelve MS-Stock (contrato v2 §4b)

```ts
// src/server/inventario/client.ts
type CatalogInfo = {
  url: string;        // http(s) válida; pública, cambia en cada reemplazo
  filename: string;   // no vacío, ≤ 240; con el que el cliente recibe el documento
  updated_at: string; // informativo
};
getCatalog(): Promise<StockResult<CatalogInfo>>  // 404 ⇒ "not_found"; otra forma ⇒ "invalid"
```

Nunca se guarda fuera del mensaje enviado: cada turno lo pide de nuevo.

## Turno de `send_catalog`

```ts
// src/server/inventario/agent.ts
const CATALOG_FOOTER = "Dime modelo y talla y te confirmo existencia y precio";
const CAPTION_MAX = 1024;

type CatalogTurn =
  | { ok: true; document: { url: string; filename: string; caption: string }; fallbackText: string }
  | { ok: false };

buildCatalogCaption(intro: string): string
//   intro vacío            ⇒ CATALOG_FOOTER
//   intro + "\n\n" + FOOTER ≤ 1024 ⇒ eso
//   si no                  ⇒ intro recortado + "…" + "\n\n" + FOOTER (exactamente ≤ 1024)
// fallbackText = caption + "\n" + url
sendCatalogTurn({ intro }): Promise<CatalogTurn>

stripCatalogLink(text: string): string
//   quita la última línea solo si es http(s) y la anterior es CATALOG_FOOTER;
//   se aplica a los salientes al armar el historial del prompt (FR-1709, research R12.4)
```

## Cierre de `check_stock` (deroga en parte FR-1308)

```ts
const CATALOG_OFFER_ABOVE = 10;
const HAY_MAS = "Hay más coincidencias, ¿me dices cuál te interesa?";
const OFERTA  = "Hay más modelos en nuestro catálogo, ¿te lo mando?";

selectProducts(products, size): { shown: StockProduct[]; more: boolean; total: number }
closingFor(total, truncated): Promise<string | null>
//   total ≤ 5 y !truncated              ⇒ null (sin cierre)
//   6 ≤ total ≤ 10 y !truncated         ⇒ HAY_MAS (sin consultar el catálogo)
//   total > 10 o truncated              ⇒ getCatalog() ok ? OFERTA : HAY_MAS
```

El cierre es el último mensaje del turno (texto, sin foto); los mensajes de producto,
sus fotos y su orden no cambian.

## Lo que se persiste

| Caso | `message` | `media_asset` |
|---|---|---|
| WhatsApp, documento aceptado | `type: "document"`, `text` = pie, `status: pending`, `origin: ai`, `aiGenerated: true` | `kind: "document"`, `payload: { url }`, `fileName`, `caption` = pie, sin archivo local |
| Laboratorio (`is_test`) | igual, `status: sent`, sin `waMessageId` | igual |
| Documento rechazado o canal sin medios | `type: "text"`, `text` = pie + `\n` + url | — |
| WhatsApp acepta y después reporta `failed` | el `document` queda `failed`; se agrega un `type: "text"` con pie + `\n` + url, una sola vez (`status.ts`) | el del documento, sin cambios |
| Sin catálogo / fallo | lo de `degradeAction` (frase del modelo o nada) | — |

Invariantes: el historial que entra al prompt es `message.text` ⇒ en el envío como
documento la URL **no** está en él (FR-1709). En el respaldo de texto el hilo sí guarda el
enlace (es lo que recibió el cliente), pero `stripCatalogLink` lo quita al armar el
historial del prompt: la URL nunca llega al modelo (research R12.4).

Transcript del Laboratorio (`src/server/lab/runner.ts`, `transcriptDe`): un saliente
`document` se ve como `[Documento: <fileName>]` + salto de línea + pie; es lo que muestra el
reporte de la corrida y lo que lee el juez (research R12.1).

## Esquema de acciones

```ts
// src/server/ai/actions.ts, solo con INVENTARIO
z.object({ action: z.literal("send_catalog"), reply: z.string().optional() })
// degradeAction: send_catalog ⇒ reply ? { action: "reply", text: reply } : { action: "none" }
```

## Simuladores (solo `/api/dev/*`, 404 en producción)

- **stock-mock**: `MockState.catalog: { filename: string; updatedAt: string; version:
  number } | null` (por defecto `{ filename: "Catálogo de prueba.pdf", …, version: 1 }`);
  `POST _catalog { present, filename? }` (presente ⇒ `version + 1`); `GET v1/agent/catalog`
  con `url` = `…/catalogo.pdf?v=<version>`; `GET catalogo.pdf` (PDF mínimo,
  `application/pdf`); `_reset` restaura el catálogo. Productos nuevos: `CAL-01…CAL-12`
  («Calcetín …», con existencia y foto) y `SUD-01…SUD-07` («Sudadera …», con existencia,
  sin foto).
- **wa-mock**: `type: "document"` con `document.link` se registra en el outbox y pasa a
  `sent` como la imagen; el modo de medios (`reject`/`slow`, opcionalmente por `link`)
  aplica también a documentos.
- **ai-mock**: propone `send_catalog` solo si el system prompt la menciona (pregunta
  general con frases ancladas, o aceptación tras «¿te lo mando?»); «catálogo completo» ⇒
  frase de más de 1024 caracteres; `_state.lastPrompt` guarda el último prompt recibido.
