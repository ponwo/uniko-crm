# Implementation Plan: De qué anuncio llegó cada conversación

**Branch**: `034-anuncio-de-origen` | **Spec**: [spec.md](spec.md) | **Datos**: [data-model.md](data-model.md) | **Verificación**: [quickstart.md](quickstart.md)

## Summary

El `referral` de WhatsApp se normaliza a un «anuncio de origen» y se guarda en
`ad_attribution` siempre; el `ctwa_clid` solo con `ATRIBUCION`. La imagen del creativo
se copia en segundo plano a un `media_asset` por anuncio. La bandeja lo enseña en la
lista, el panel y el cajón del trato.

Es un **puerto** de la 018 de Vocero (`ponwo/vocero-crm`, commits `17c95d4`,
`2783c9a`, `53524ab`, `cf44065`, `dd2b37f`), aplicado con fusión a tres vías sobre
`main` de Uniko. Casi todo el código entró tal cual: Uniko y Vocero comparten la 016
byte por byte salvo la marca. Lo que cambia respecto de Vocero está en
[Desvíos del puerto](#desvíos-del-puerto).

## Technical Context

- **Stack**: Next.js 15, TypeScript estricto, Drizzle + PostgreSQL, Vitest, arnés
  `scripts/e2e-selftest.mjs`, Playwright.
- **Dependencias nuevas**: ninguna.
- **Almacenamiento**: la imagen por `saveMediaFile` en `MEDIA_DIR`, como los adjuntos
  de 008.
- **Rendimiento**: la lista suma un `LEFT JOIN` por la llave única (organización,
  conversación). La copia de la imagen no está en el camino del webhook.
- **Restricciones**: sin llamadas nuevas a terceros más allá de leer la imagen que Meta
  ya enlaza en su propio CDN.

## Constitution Check

| Principio | Cómo lo cumple este plan | Estado |
|---|---|---|
| I. Seguridad de datos | El `ctwa_clid` no sale por ninguna API (ni lista, ni detalle, ni SSE). La imagen se sirve por `/api/media` con sesión. La descarga solo acepta https a hosts de Meta, revalida cada salto de redirección, sin credenciales en la URL ni puertos raros, tipo y tamaño acotados (el cuerpo se lee con tope, no entero). | ✅ |
| II. Soberanía | Sin dependencia ni credencial nueva: el `referral` llega en el webhook de WhatsApp Cloud API y la imagen está en el CDN de Meta. La descarga es best-effort: si falla, la tarjeta sale sin imagen. | ✅ |
| III. Multi-tenancy | Toda lectura por `scoped()` o por la llave (organización, conversación); la imagen se guarda bajo la organización de la fila. | ✅ |
| IV. Idempotencia | UNIQUE (organización, conversación) con `ON CONFLICT DO NOTHING`; migración re-ejecutable; dos descargas del mismo anuncio no dejan dos adjuntos. | ✅ |
| V. Calidad verificable | Unitarias de normalización, URL permitida, descarga, bandera y freno de reparación; gate completo. | ✅ |
| VI. Specs antes de código | Carril ciclo completo, banda FR-19xx. El código existía en Vocero antes que esta spec; aquí la spec se escribe antes de mergear y lo dice ([spec.md](spec.md), Input). | ✅ |
| VII. Trazabilidad | Las decisiones D1–D5 se heredan de la 018 de Vocero y el dueño las adopta con el puerto; los desvíos del puerto dicen su porqué (abajo). | ✅ |
| VIII. Foco vertical | Quien atiende sabe de qué anuncio llegó la persona, en la bandeja: es atender la conversación, no analítica. | ✅ |
| IX. Verificación en vivo | `pnpm test:e2e` con la bandera apagada y encendida; guion de navegador `e2e-anuncio-origen-ui.mjs`; tras el merge, la instancia de pruebas. | ✅ |
| X. Irreversibilidad | Toca `drizzle/`: una columna nullable, una clave foránea `ON DELETE SET NULL` y un índice; nada se borra ni se reescribe. Ensayo ANTES de `main` contra Postgres desechable con respaldos reales (ILTU, NuriaAndrea y el de ILTU con filas de anuncio). Reversión: redesplegar el commit anterior. | ✅ |
| Módulos opcionales (016) | Se **enmienda** una decisión de 016 por decisión del dueño: la captura del origen deja de estar tras `ATRIBUCION` (D1); el `ctwa_clid`, la CAPI y la pestaña siguen tras ella (D2). La superficie apagada sigue en 404. FR-001 de 016 lleva la marca de la enmienda. | ✅ |
| Sandbox del Laboratorio | Las conversaciones del Laboratorio no llegan por el webhook: no capturan anuncio. | ✅ |
| Mocks bajo `/api/dev/` | El `referral` libre y los creativos de prueba viven en rutas ya existentes del wa-mock (`inbound`, `media-file`). Sin rutas nuevas. | ✅ |
| Puerta de promoción | Fuera de esta feature: `main` → `production` solo con la señal del dueño y la puerta completa. | ✅ |

Sin violaciones. Se repite tras el diseño: la imagen como `media_asset` sin mensaje no
cambia la ruta que la sirve (`ensureAssetAvailable` no toca un asset `available`, uno
sin `wa_media_id` no intenta Graph, y su `payload` no trae `url`, así que tampoco cae
en la redirección de las imágenes por URL de la 026/032).

## Project Structure

```text
src/lib/db/schema.ts                      ad_attribution.image_asset_id + índice
drizzle/0019_anuncio_de_origen.sql        migración re-ejecutable (+ snapshot y journal)
src/server/attribution/referral.ts        normalización pura del referral de WhatsApp
src/server/attribution/creativo.ts        URL permitida y copia de la imagen
src/server/attribution/store.ts           registrar, leer, reparar y serializar
src/server/attribution/flag.ts            comentarios: qué apaga la bandera ahora
src/server/whatsapp/media.ts              deleteMediaFile
src/server/inbox/ingest.ts                captura siempre, sin romper la ingesta
src/server/inbox/queries.ts               anuncio en la lista y el detalle
src/server/contact-source.ts, contacts.ts fuente deducida
src/app/api/contacts/[id]/route.ts        anuncio del contacto + reparación
src/app/api/conversations/[id]/route.ts   el evento SSE lleva el anuncio
src/lib/types.ts, src/lib/anuncios.ts     DTOs y etiquetas
src/components/anuncio-origen.tsx         la tarjeta
src/components/inbox/, pipeline/          marca, filtro y tarjeta
src/server/dev/, src/app/api/dev/wa-mock/ referral libre en el inbound y creativos de prueba
scripts/e2e-selftest.mjs                  sección 034 y ajuste de la 016 apagada
scripts/e2e-anuncio-origen-ui.mjs         guion de navegador y capturas
tests/unit/anuncio-origen.test.ts         unitarias
```

## Diseño

- **Captura**: `processMessagesValue` normaliza con `anuncioDeWhatsapp` y se lo pasa a
  `ingestInboundMessage`, que lo registra tras resolver contacto y conversación y
  **antes** del dedup del mensaje (como 016), dentro de un `try/catch`. Sin
  `ATRIBUCION`, `ctwaClid` va nulo y `raw` sin la clave.
- **Imagen**: si la fila es nueva y trae `source_id` e imagen, se lanza
  `guardarCreativo` sin esperar. Primero reutiliza la imagen de otra fila del mismo
  anuncio; si no, descarga (una por proceso a la vez por anuncio), guarda el archivo,
  la asigna a todas las filas del anuncio sin imagen y, si otra descarga ganó, borra
  la suya. Publica `conversation.updated` para que la tarjeta abierta se refresque
  sola (en Uniko ese evento dispara un refetch de la lista y del panel, no una fusión
  del payload: el `anuncio` de la lista no se pierde).
- **Reparación**: `GET /api/contacts/[id]` con anuncio sin imagen dispara
  `repararImagenSiFalta` en segundo plano, con freno de 10 minutos por anuncio. Lee la
  URL del `raw`, así que sirve también para las filas que 016 ya guardó en la flota.
- **Mocks**: el inbound del wa-mock acepta un `referral` libre; la ruta `media-file`
  sirve PNG reales para ids `creativo-*` y provoca a propósito los caminos a rechazar
  (enorme, SVG, redirección, lento, falla). Con los mocks habilitados se permite el
  origen de `META_GRAPH_BASE_URL` (nunca en producción: `isMockEnabled` exige
  `NODE_ENV !== "production"`).

## Desvíos del puerto

Lo que no entró tal cual de Vocero, y por qué:

1. **Numeración.** Toda referencia a «018» en el código portado dice «034»: en Uniko la
   018 es la reconexión SSE. La migración es la `0019` (la `0014` de Vocero choca con
   la de Uniko). Mismos nombres de columna, clave e índice, para compartir la forma de
   la tabla.
2. **`queries.ts` sin estado al importar.** La condición del `LEFT JOIN` y las columnas
   del anuncio son funciones, no constantes de módulo. Como el resto del archivo, nada
   toca el esquema al importarlo: la prueba de la 031 (`plantillas-por-canal.test.ts`)
   simula `@/lib/db` a medias para probar `serializeConversation`, y una constante que
   lee `schema.adAttribution` la tumbaba.
3. **Estado del proceso en `globalThis`.** Las descargas en curso (`creativo.ts`) y el
   contador de pedidos del creativo de prueba (`media-file`) viven en `globalThis`,
   como la coalescencia del agente y el estado de los mocks (gotcha de la 032): en
   `next dev` cada ruta evalúa su copia del módulo, y la copia la lanza el webhook
   mientras la reparación la lanza la ruta del contacto.
4. **Arnés.** Uniko no tenía `hasta()` (esperar a que algo ocurra): se agrega. El guion
   de navegador usa las llaves de Uniko (`uniko.panelOpen`, cookie `uniko-theme`,
   `e2e@uniko.test`).
5. **Panel del contacto.** Uniko ya tenía ahí el diálogo de «Perdido» (#64): la tarjeta
   convive con ese estado. El ícono `Sparkles` de Vocero no aplica en la lista de Uniko.

## Migración, rollout y reversión

- `0019_anuncio_de_origen`: generada con `pnpm db:generate` (su `when` es mayor que el
  de `0018`) y editada a mano para ser re-ejecutable (IF NOT EXISTS y bloque DO, como
  la `0010` que creó la tabla).
- **Ensayo del Principio X**: [quickstart.md §4](quickstart.md).
- **Rollout**: sin variables nuevas. Toda instancia empieza a guardar el origen (sin
  `ctwa_clid` donde `ATRIBUCION` esté apagada) desde el despliegue; las que ya
  atribuyen (ILTU) enseñan además las filas que 016 ya guardó.
- **Reversión**: redesplegar el commit anterior. La app vieja ignora la columna; las
  imágenes copiadas quedan como adjuntos sin mensaje, inertes.
