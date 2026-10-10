# Feature Specification: De qué anuncio llegó cada conversación

**Feature Branch**: `034-anuncio-de-origen`

**Created**: 2026-10-09

**Status**: En `production` (`f9605f2`) desde el 2026-10-10, flota 3/3 con la `0019` aplicada (PR #68 y docs #69); falta la verificación en vivo en ILTU (SC-006)

**Carril (Principio VI)**: **ciclo completo**; banda FR-19xx. Toca el modelo de datos (`drizzle/`:
una columna, su clave foránea y un índice en `ad_attribution`, migración `0019`) y
suma un campo aditivo a los DTOs de `/api/conversations`, `/api/contacts/[id]` y del
evento SSE `conversation.updated`. Pasa por el ensayo del Principio X antes de `main`.

**Input**: decisión del dueño (2026-10-09): **portar a Uniko la spec 018 de Vocero**
(`ponwo/vocero-crm`, `specs/018-anuncio-de-origen`, commits `f22ac03..17869cc`), que
a su vez trajo al raíz de Vocero la pieza visible de la spec 212 de Vocero Cloud. La
pregunta que la abrió: «¿cómo sabemos el `ctwa_clid` de uno de los mensajes?». En ILTU
(`ATRIBUCION=on`) el CRM ya capturó 37 conversaciones de anuncio con su `ctwa_clid` y
su `raw` completo (auditoría del 2026-10-09), pero **ninguna pantalla** dice de qué
anuncio llegó nadie: el dato solo se ve consultando la base. El dueño eligió el puerto
tal cual, con sus decisiones (abajo), en vez de una pantalla propia.

## Contexto

Meta dice de qué anuncio Click-to-WhatsApp (CTWA) vino una persona en el **primer**
mensaje de la conversación (objeto `referral`), y no lo vuelve a decir. La spec 016 lo
captura hoy solo con la bandera `ATRIBUCION` encendida, y solo para reportar
conversiones: en pantalla aparece únicamente en Ajustes → Anuncios, como actividad de
la Conversions API. Dejó fuera a propósito «la miniatura del creativo y la ficha de de
qué anuncio vino», guardando el `raw` para que alguien la pintara sin migrar nada.

Vocero la pintó en su 018. Esta spec la trae a Uniko **con la misma forma de tabla**
(mismos nombres de columna, clave foránea e índice), para que los repos sigan
compartiendo `ad_attribution`.

## Decisiones (heredadas de la 018 de Vocero; el dueño las adopta con el puerto)

- **D1 — El origen se ve siempre**, con `ATRIBUCION` encendida o apagada. Capturar el
  `referral` es pasivo: viaja dentro del webhook que la instancia ya recibe, no pide
  credenciales, no llama a nadie y es inerte si nunca llega un anuncio. Decir de dónde
  llegó un cliente es parte de atenderlo.
- **D2 — Lo de Meta sigue detrás de la bandera**: el `ctwa_clid`, la Conversions API y
  la pestaña Ajustes → Anuncios. Con la bandera apagada el `ctwa_clid` **no se
  guarda**, ni en su columna ni dentro del `raw`, y la tarjeta no dice «Meta
  identificó el clic». Se conserva la promesa de 016: una instancia que no atribuye no
  acumula identificadores de clic «por si acaso».
- **D3 — Solo WhatsApp** por ahora. Instagram y Messenger mandan otra forma de
  `referral` (`ad_id`, `ads_context_data`); quedan para después.
- **D4 — La imagen va al volumen de adjuntos** como un `media_asset`, una vez por
  anuncio, servida por `/api/media/[assetId]` con sesión. No un data URI por
  conversación en la base.
- **D5 — Solo hosts de Meta.** La URL de la imagen llega en un payload externo:
  descargar cualquier URL convertiría la ingesta en un proxy hacia la red interna
  (SSRF).

## Alcance

**Entra**:

- Captura del anuncio de origen de WhatsApp (Meta Cloud API), siempre.
- Imagen del creativo copiada una sola vez por anuncio al volumen de adjuntos, con
  reintento y reparación.
- Bandeja: marca «Anuncio · titular» en la lista y filtro «Anuncios».
- Tarjeta del anuncio en el panel del contacto y en el cajón del trato.
- La fuente de un contacto sin fuente capturada se deduce «Anuncio».

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| **Ver el valor del `ctwa_clid`** en pantalla o por API | D2 y FR-1908: es el identificador del clic para la Conversions API y no le sirve a quien atiende; la tarjeta solo dice si existe. Quien lo necesite (soporte de Meta, una auditoría) lo lee en la base, en `ad_attribution.ctwa_clid`. |
| Nombre del anuncio, campaña o conjunto | Meta no los manda en el `referral`; exigirían la API de Marketing con permisos de anuncios del negocio (Principio II). |
| Instagram y Messenger | D3. |
| Tabla «Por anuncio» y gasto | Uniko no tiene pantalla de Resultados. |
| Script de backfill de imágenes viejas | Las filas de 016 ya guardan la URL en `raw`: la reparación al abrir el contacto las cubre mientras Meta no la caduque. |
| Contar un segundo anuncio en la misma conversación | Gana el primero, como en 016. |
| Dar el anuncio a un cerebro externo (`/api/bot/*`) | Cambia un contrato publicado; cuando un cerebro lo vaya a usar. |

## User Scenarios & Testing

### User Story 1 — Guardar de qué anuncio llegó (Priority: P1)

Cuando alguien escribe desde un anuncio, la conversación queda con su anuncio de
origen, con la bandera encendida o apagada.

**Independent Test**: un inbound del wa-mock con `referral`, con `ATRIBUCION` apagada
y encendida, y leer el anuncio por la API.

**Acceptance Scenarios**:

1. **Given** un primer mensaje con `referral` (`source_id`, `headline`, `body`,
   `source_url`, `image_url`, `ctwa_clid`), **When** se ingiere, **Then** la lista y
   el detalle del contacto traen el anuncio.
2. **Given** `ATRIBUCION` apagada, **When** llega ese mensaje, **Then** el anuncio se
   guarda **sin** `ctwa_clid` (columna nula y `raw` sin la clave) y el detalle dice
   `hasCtwaClid: false`.
3. **Given** `ATRIBUCION` encendida, **When** llega, **Then** se guarda el
   `ctwa_clid` y el detalle dice `hasCtwaClid: true`, sin el valor.
4. **Given** la misma entrega repetida, o un mensaje posterior con otro anuncio,
   **When** se procesa, **Then** el anuncio original sigue y el mensaje no se
   duplica.
5. **Given** un `referral` sin ninguno de `source_id`, `ctwa_clid`, `headline` o
   `source_url`, **When** se ingiere, **Then** no hay anuncio y el mensaje entra.

### User Story 2 — Verlo en la bandeja y en el pipeline (Priority: P1)

**Independent Test**: una conversación de anuncio y otra orgánica, en el navegador:
lista, filtro, panel y cajón del trato.

**Acceptance Scenarios**:

1. **Given** una conversación de anuncio, **When** se ve la lista, **Then** su renglón
   dice «Anuncio · titular» («Publicación» si Meta marcó `post`).
2. **Given** al menos una conversación de anuncio, **When** se ve la lista, **Then**
   hay un filtro «Anuncios» con su contador que deja solo esas; sin ninguna, el filtro
   no aparece.
3. **Given** esa conversación abierta, **When** se mira el panel, **Then** hay una
   tarjeta con la imagen del creativo, titular, texto, «Primer mensaje · fecha», «con
   video» si aplica, «ID <source_id>» y «Ver anuncio» (solo https). La misma tarjeta
   sale en el cajón del trato del pipeline.
4. **Given** `ATRIBUCION` encendida y un clic con `ctwa_clid`, **When** se mira la
   tarjeta, **Then** dice «Meta identificó el clic», y nunca el valor. Apagada, no lo
   dice.
5. **Given** una conversación orgánica, **When** se abre, **Then** no hay tarjeta.

### User Story 3 — La imagen del creativo (Priority: P2)

La URL que manda Meta caduca en días (parámetro `oe=` de su CDN): se copia al llegar.

**Acceptance Scenarios**:

1. **Given** un anuncio con `thumbnail_url` o `image_url` de Meta, **When** se
   ingiere, **Then** la imagen queda guardada y se sirve con sesión (sin sesión, 401).
   Se prefiere `thumbnail_url`.
2. **Given** otra persona del mismo anuncio, **When** llega, **Then** comparte la
   misma imagen: no se descarga otra vez.
3. **Given** una URL fuera de Meta, una redirección a otro host, un SVG o una imagen
   de más de 300 KB, **When** llega, **Then** la tarjeta aparece sin imagen y el
   mensaje entra igual.
4. **Given** una descarga que tropieza una vez (tiempo, red, 5xx, 429), **When** se
   reintenta, **Then** la imagen llega.
5. **Given** una descarga que falló dos veces, **When** se abre el contacto, **Then**
   se repara en segundo plano, como mucho una vez cada 10 minutos por anuncio. Cubre
   también las filas guardadas por 016 antes de esta spec.

### Edge Cases

- Dos descargas simultáneas del mismo anuncio no dejan un adjunto de más.
- Payload con cadenas gigantes o tipos equivocados: se recorta o se ignora.
- La copia de la imagen jamás retrasa ni rompe la ingesta del mensaje.
- Filas guardadas con la bandera encendida y apagada después: la tarjeta deja de decir
  «Meta identificó el clic».
- **Filas de 016 ya en la flota** (ILTU: conversaciones del 2 al 9 de octubre): salen
  con su tarjeta desde el despliegue. Su imagen se repara al abrir el contacto **si**
  Meta no caducó todavía la URL del `raw`; las de hace más de unos días quedan sin
  imagen, con la tarjeta completa.

## Requirements

### Functional Requirements

- **FR-1901**: La ingesta MUST normalizar `messages[].referral` a un anuncio de origen y
  guardarlo con la conversación, independientemente de `ATRIBUCION`.
- **FR-1902**: Con `ATRIBUCION` apagada MUST NOT guardarse el `ctwa_clid`, ni en su
  columna ni en `raw`.
- **FR-1903**: El primer anuncio de una conversación MUST ganar (`ON CONFLICT DO
  NOTHING` sobre organización y conversación).
- **FR-1904**: El `raw` MUST guardarse acotado (claves conocidas, cadenas recortadas,
  8 KB máximo).
- **FR-1905**: Un fallo al guardar el anuncio MUST NOT impedir ingerir el mensaje.
- **FR-1906**: La imagen MUST descargarse fuera del camino del webhook, solo por https
  desde hosts de Meta (con los mocks habilitados, también el origen del wa-mock),
  validando cada redirección (máximo 3), JPEG/PNG/WebP/GIF, hasta 300 KB, 5 s por
  intento y un reintento ante fallo transitorio.
- **FR-1907**: Si la imagen falta, abrir el contacto MUST reintentarla en segundo plano,
  como mucho una vez cada 10 minutos por anuncio.
- **FR-1908**: La lista de conversaciones MUST traer el anuncio (titular, id y tipo); el
  detalle del contacto, el anuncio completo sin el valor del `ctwa_clid`, y
  `hasCtwaClid` solo verdadero con la bandera encendida.
- **FR-1909**: La fuente de un contacto sin fuente capturada MUST deducirse «anuncio»
  cuando llegó de un anuncio (no de una publicación).
- **FR-1910**: Ajustes → Anuncios, `/api/settings/capi*` y el envío a Meta MUST seguir
  sin existir con la bandera apagada.

### Key Entities

- **Anuncio de origen** (`ad_attribution`, de 016): uno por conversación, más
  `image_asset_id`.
- **Imagen del creativo**: un `media_asset` compartido por todos los anuncios de origen
  con el mismo `source_id`.

## Success Criteria

- **SC-001**: Con la bandera apagada y encendida, el arnés E2E muestra el anuncio en la
  lista y en el detalle, con `hasCtwaClid` según la bandera.
- **SC-002**: Reentregas y mensajes posteriores dejan un solo anuncio por
  conversación.
- **SC-003**: Las cuatro URLs hostiles quedan sin imagen y sin romper la ingesta; la
  lenta y la que falla terminan con imagen.
- **SC-004**: Gate técnico y `pnpm test:e2e` en verde; la tarjeta se ve en un navegador
  en claro y oscuro, a 1440 y 390 px.
- **SC-005**: Con las filas **reales** de 016 (respaldo de ILTU restaurado en el ensayo
  del Principio X), la lista y el detalle las traen como anuncio, el `ctwa_clid` no
  sale, y la URL de imagen que Meta mandó pasa el filtro de hosts.
- **SC-006** (verificación en vivo, pendiente del dueño): en una instancia con
  anuncios (ILTU, tras la promoción) las conversaciones de anuncio salen con su
  tarjeta, y un clic nuevo en un anuncio CTWA trae su creativo.
