# Data Model — 034

## `ad_attribution` (de 016, una columna y un índice más)

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `id` … `raw`, `created_at` | — | — | Sin cambios respecto de `0010_atribucion_capi`. |
| `ctwa_clid` | text | sí | **Nulo si `ATRIBUCION` estaba apagada al llegar** (D2). Jamás sale por API. |
| `raw` | jsonb | no | `referral` acotado a sus claves conocidas (8 KB máximo); sin `ctwa_clid` con la bandera apagada. Las filas de 016 conservan su `raw` íntegro. |
| `image_asset_id` | text | sí | **Nueva.** FK `media_asset.id` `ON DELETE SET NULL`; compartida por `source_id`. |

Índice nuevo: `ad_attribution_org_source_idx` (`organization_id`, `source_id`): busca la
imagen ya guardada de un anuncio y asigna una descarga a todas sus conversaciones.

Migración `0019`: aditiva y re-ejecutable (`ADD COLUMN IF NOT EXISTS`, la clave foránea
en bloque `DO`, `CREATE INDEX IF NOT EXISTS`). Mismos nombres de columna, clave e índice
que la `0014` de Vocero y la `0023` de Vocero Cloud.

## `media_asset` (sin cambios)

La imagen del creativo es una fila `kind = 'image'`, `wa_media_id` nulo,
`fetch_status = 'available'`, `file_name = 'anuncio-{source_id}.{ext}'` y
`payload = { "origen": "anuncio", "sourceId": … }` (sin `url`: no es una imagen por URL
de la 026). El archivo va a `MEDIA_DIR/{organization_id}/{asset_id}` como cualquier
adjunto.

## DTOs

```ts
// GET /api/conversations y evento SSE conversation.updated (aditivo)
ConversationDto.anuncio: {
  headline: string | null;
  sourceId: string | null;
  sourceType: string | null; // "post" si fue una publicación
} | null;

// GET /api/contacts/[id] (aditivo)
anuncio: {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;     // solo https
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  imageAssetId: string | null;  // /api/media/{id}
  hasCtwaClid: boolean;         // solo true con ATRIBUCION encendida
  capturedAt: string;           // ISO
} | null;
contact.source: { value: "anuncio", source: "deducida" } // si no hay fuente capturada
```

## Transiciones

La fila nace con el primer `referral` de la conversación y no se modifica, salvo
`image_asset_id` de nulo a una imagen (o de una imagen a nulo si se borra el adjunto).
