# Feature Specification: Catálogo PDF del negocio — acción `send_catalog`

**Feature Branch**: `032-catalogo-pdf`

**Created**: 2026-10-05

**Status**: Draft

**Carril (Principio VI)**: **ciclo completo** (`specify → plan → tasks → implement`).
No toca el modelo de datos, pero **consume un contrato publicado fuera de este repo**
(`GET /v1/agent/catalog` de MS-Stock, contrato inter-repo v2: `uniko-integration.md`
§4 y §4b en el repo MS-Stock) y **deroga en parte FR-1308 de la 028** (el cierre de
`check_stock`; Principio VII). El contrato manda: si al planear algo no cuadra, se
corrige allá antes de programar aquí.

**Input**: Lado Uniko de la feature 006 de MS-Stock (catálogo PDF del negocio),
**desplegada** el 2026-10-04 en `stock.lanco.cloud` y en la instancia de NuriaAndrea.
Decisiones del dueño: (1) 2026-09-15 — el PDF **lo hace el negocio** (Canva, un
diseñador) y lo sube en el portal de MS-Stock; ni Uniko ni MS-Stock lo generan ni leen su
contenido; el PDF muestra qué se vende y la existencia y el precio los confirma
`check_stock`; Uniko lo envía con una acción `send_catalog` como **un** mensaje de
documento con el pie «Dime modelo y talla y te confirmo existencia y precio»; sin
catálogo o con MS-Stock caído, degrada a la frase del modelo; (2) 2026-10-04 — en
`check_stock`, el catálogo se ofrece en lugar de «Hay más coincidencias» **solo con más
de 10 resultados**; de 6 a 10 basta preguntar cuál le interesa.

## Contexto de negocio

Con la 026 y la 028 el agente contesta bien una pregunta **por un producto** («¿tienen
la playera negra en G?»): existencia, precio y foto de lo que hay. Pero el cliente que
llega de un anuncio no pregunta por un SKU: pregunta **«¿qué venden?»**, **«¿me mandas
el catálogo?»**. Hoy el agente no tiene con qué responder eso: o inventa una lista (lo
que el prompt le prohíbe), o hace una búsqueda que no sabe formular, o contesta con una
generalidad. Y cuando la pregunta sí es por una categoría con muchos modelos («¿tienen
playeras?» con 20 modelos), la 028 muestra 5 con foto y cierra con «Hay más
coincidencias, ¿me dices cuál te interesa?»: correcto con 6 a 10, poco útil con 30.

El negocio ya tiene la respuesta a esas preguntas: el catálogo que diseñó en Canva, que
desde la 006 de MS-Stock sube, reemplaza y renombra en el portal de inventario. Esta
feature hace que el agente **lo envíe como documento** cuando el cliente pregunta en
general, y que **lo ofrezca** cuando una búsqueda trae más modelos de los que conviene
enseñar. El modelo de lenguaje sigue sin redactar existencias, precios ni el contenido
del PDF: decide *cuándo* mandar el catálogo; el sistema lo pide, lo envía y degrada.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El cliente pregunta qué venden y recibe el catálogo (Priority: P1)

Un cliente escribe «¿qué venden?» (o «¿tienen catálogo?», «mándame el catálogo»). En la
misma respuesta recibe **un** mensaje de WhatsApp con el PDF del negocio, con el nombre
que el negocio eligió («Catálogo Otoño 2026.pdf») y un pie: la frase de entrada del
agente, si la hay, y debajo «Dime modelo y talla y te confirmo existencia y precio». Si
el negocio no ha subido catálogo o el inventario no responde, el cliente recibe solo la
frase del agente —que no promete ningún adjunto—, nunca un error ni un silencio.

**Why this priority**: es la razón de la feature y la pregunta más común del cliente
que llega de un anuncio.

**Independent Test**: con `INVENTARIO=on` y el inventario de pruebas con catálogo,
mandar «¿qué venden?» a una conversación: sale un mensaje de documento con el nombre y
el pie esperados; quitar el catálogo y repetir: sale solo la frase; apagar el
inventario y repetir: igual, en menos de 5 s.

**Acceptance Scenarios**:

1. **Given** una instancia con `INVENTARIO=on` y catálogo «Catálogo Otoño 2026.pdf» en
   MS-Stock, **When** el cliente pregunta «¿qué venden?» por WhatsApp, **Then** recibe
   UN mensaje de documento con ese nombre, cuyo pie es la frase de entrada del agente (si
   la hay), una línea en blanco y «Dime modelo y talla y te confirmo existencia y
   precio».
2. **Given** que el agente no aporta frase de entrada, **When** se envía el catálogo,
   **Then** el pie es solo «Dime modelo y talla y te confirmo existencia y precio».
3. **Given** que el negocio no ha subido catálogo (o lo quitó, o su MS-Stock es anterior
   a la 006), **When** el cliente pregunta «¿qué venden?», **Then** recibe solo la frase
   del agente (o nada, si no la hubo), sin mención a un catálogo enviado ni a un fallo.
4. **Given** que MS-Stock no responde, rechaza la llave o devuelve algo inesperado,
   **When** el cliente pregunta, **Then** el turno degrada igual que en el escenario 3
   en menos de 5 s, y el motivo queda en el registro del servidor sin la llave.
5. **Given** una conversación del Laboratorio, **When** la persona simulada pregunta
   qué venden, **Then** el hilo del Laboratorio muestra el documento con su nombre y su
   pie tal como lo vería el cliente, y la API de WhatsApp nunca se toca.
6. **Given** una conversación por un canal que no envía documentos (Instagram,
   Messenger), **When** se envía el catálogo, **Then** el cliente recibe un texto con el
   mismo pie y, en la línea siguiente, el enlace del PDF.

---

### User Story 2 - Muchos modelos: cinco con foto y el ofrecimiento del catálogo (Priority: P1)

Un cliente pregunta «¿tienen playeras?» y el inventario tiene más de 10 modelos con
existencia (o más de los que MS-Stock devuelve). Recibe los 5 primeros con su foto
(como en la 028) y, al final, «Hay más modelos en nuestro catálogo, ¿te lo mando?». Si
responde que sí, el siguiente turno le envía el catálogo como en la US1. Con 6 a 10
modelos con existencia, el cierre sigue siendo «Hay más coincidencias, ¿me dices cuál te
interesa?»; y si el negocio no tiene catálogo, también.

**Why this priority**: es donde el «Hay más coincidencias» deja de servir y donde el
catálogo aporta más; comparte casi todo con la US1.

**Independent Test**: con un inventario de pruebas de más de 10 modelos con existencia
y catálogo cargado, preguntar por la categoría: 5 mensajes con foto y el ofrecimiento;
contestar «sí»: llega el PDF; repetir con 8 modelos: «Hay más coincidencias…»; repetir
con más de 10 y sin catálogo: «Hay más coincidencias…».

**Acceptance Scenarios**:

1. **Given** más de 10 productos con existencia (tras el filtro de talla y existencia
   de la 028) y catálogo cargado, **When** el cliente pregunta por la categoría,
   **Then** recibe 5 productos con su foto y, al final, «Hay más modelos en nuestro
   catálogo, ¿te lo mando?».
2. **Given** que MS-Stock avisó que recortó la búsqueda (más de las 25 coincidencias
   que devuelve) y hay catálogo, **When** se arma el turno, **Then** el cierre es el
   ofrecimiento, aunque tras el filtro queden 10 o menos.
3. **Given** de 6 a 10 productos con existencia y sin recorte, **When** se arma el
   turno, **Then** el cierre es «Hay más coincidencias, ¿me dices cuál te interesa?»,
   haya o no catálogo, y el catálogo no se consulta.
4. **Given** más de 10 con existencia y **sin** catálogo (o MS-Stock no responde a esa
   consulta), **When** se arma el turno, **Then** el cierre es «Hay más coincidencias,
   ¿me dices cuál te interesa?» y los 5 productos salen igual.
5. **Given** que el turno anterior ofreció el catálogo, **When** el cliente responde
   «sí» o «mándamelo», **Then** el agente envía el catálogo como en la US1.

---

### User Story 3 - El agente no describe el catálogo: el inventario manda (Priority: P2)

El agente nunca ve el PDF. No lo describe, no lo resume ni cita precios o modelos «del
catálogo»: para existencia y precio usa `check_stock`. Si el cliente menciona un precio
o un modelo que vio en el PDF y no coincide con el inventario, el agente responde con lo
que diga el inventario.

**Why this priority**: protege la regla de la 026 («nunca se afirma una existencia ni un
precio que no vino de la consulta») ahora que hay un documento que el modelo no puede
leer.

**Independent Test**: inspeccionar el prompt que recibe el modelo con `INVENTARIO=on`:
contiene la acción y las reglas, nunca la dirección del PDF; en el arnés, una pregunta
por un precio «del catálogo» se resuelve con `check_stock`.

**Acceptance Scenarios**:

1. **Given** `INVENTARIO=on`, **When** se arma el prompt del agente, **Then** ofrece
   `send_catalog` para preguntas generales y para aceptar el ofrecimiento, pide que su
   frase de entrada no prometa el adjunto, y prohíbe describir o citar el catálogo.
2. **Given** que el catálogo se envió en un turno anterior, **When** se arma el prompt
   siguiente, **Then** la dirección del PDF no aparece en él.
3. **Given** que el cliente dice «en el catálogo la playera negra cuesta $199», **When**
   el inventario dice $219, **Then** el agente responde con el precio del inventario.

---

### User Story 4 - Sin inventario, nada cambia (Priority: P3)

En una instancia con `INVENTARIO` apagada, el agente no conoce `send_catalog`, el prompt
es el de siempre y no se llama a MS-Stock.

**Why this priority**: es la regla de los módulos opcionales; no agrega valor visible
pero sin ella la feature no entra.

**Independent Test**: correr el arnés completo con `INVENTARIO` apagada: mismo resultado
que antes de esta feature.

**Acceptance Scenarios**:

1. **Given** `INVENTARIO` apagada, **When** el cliente pregunta «¿qué venden?», **Then**
   el agente contesta como hoy, sin acción de catálogo ni llamada a MS-Stock.
2. **Given** que el modelo de lenguaje devuelve `send_catalog` en una instancia sin
   inventario (no está en su esquema), **When** se procesa el turno, **Then** se trata
   como cualquier acción inválida hoy: degrada sin tumbar el turno.

---

### Edge Cases

- **Catálogo reemplazado o renombrado entre turnos**: cada envío consulta el catálogo en
  ese momento; nunca se reutiliza una dirección ni un nombre de un turno anterior.
- **Catálogo quitado entre el ofrecimiento y la aceptación**: `send_catalog` recibe "no
  hay catálogo" y degrada a la frase del agente.
- **Frase de entrada larguísima**: el pie no pasa de 1024 caracteres (límite de
  WhatsApp); se recorta la frase del agente, nunca la frase fija.
- **WhatsApp rechaza el documento o no responde a tiempo**: el cliente recibe el texto
  con el pie y el enlace (como en un canal sin documentos); el turno no se pierde.
- **Ventana de 24 h cerrada**: igual que cualquier envío del agente hoy (escala a
  humano).
- **Varias preguntas generales seguidas**: cada una envía el catálogo de nuevo; no hay
  memoria de "ya lo mandé" (fuera de alcance).
- **MS-Stock lento justo en el cierre de `check_stock`**: la consulta del catálogo tiene
  el mismo tope de 3 s; si se pasa, el cierre es «Hay más coincidencias…» y los 5
  productos ya armados salen igual.
- **Un solo producto con recorte**: no ocurre en la práctica (el recorte implica más de
  25 coincidencias); si ocurriera, se aplica la misma regla de cierre.
- **El negocio no vende por talla**: el pie fijo dice «modelo y talla»; adaptar esa frase
  por negocio queda fuera de alcance (decisión del contrato).

## Requirements *(mandatory)*

### Functional Requirements

**Acción `send_catalog`**

- **FR-1701**: Con `INVENTARIO=on`, el agente MUST tener una acción tipada nueva,
  `send_catalog`, con una frase de entrada opcional (`reply`) y nada más. Con la bandera
  apagada la acción MUST NOT existir en el esquema del turno ni en el prompt.
- **FR-1702**: Al ejecutar `send_catalog`, el sistema MUST pedir el catálogo a MS-Stock
  (`GET /v1/agent/catalog`, contrato §4b) con la llave de la instancia, tope de 3 s y sin
  reintentos dentro del turno, por el mismo adaptador que ya es el único que conoce
  HTTP de MS-Stock; una respuesta fuera de la forma del contrato MUST tratarse como
  fallo, no como catálogo.
- **FR-1703**: Con catálogo, el sistema MUST enviar **un** mensaje de documento por la
  dirección pública del PDF, con el nombre que trae (`filename`) y un pie formado por la
  frase de entrada del agente (si la hay), una línea en blanco y «Dime modelo y talla y
  te confirmo existencia y precio». El archivo MUST NOT descargarse ni pasar por Uniko.
- **FR-1704**: El pie MUST NOT pasar de 1024 caracteres: si no cabe, se recorta la frase
  de entrada (marcando el recorte), nunca la frase fija.
- **FR-1705**: En un canal que no envía documentos, el sistema MUST enviar un texto con
  el mismo pie y, en la línea siguiente, la dirección del PDF.
- **FR-1706**: Si WhatsApp rechaza el documento o no lo acepta a tiempo, el sistema MUST
  enviar el texto de FR-1705, de modo que el cliente reciba el enlace; la ventana de 24
  h cerrada MUST escalar a humano como cualquier envío del agente.
- **FR-1707**: En una conversación del Laboratorio, el sistema MUST persistir el
  documento —nombre, dirección y pie— como lo vería el cliente, sin tocar la API real.
- **FR-1708**: Sin catálogo ("no hay catálogo") o con cualquier fallo (llave rechazada,
  servicio caído, tiempo agotado, respuesta inesperada), el turno MUST degradar a la
  frase de entrada del agente o a nada, sin bloquear la conversación, sin decirle al
  cliente que algo falló y en menos de 5 s; el motivo MUST quedar en el registro del
  servidor sin la llave.
- **FR-1709**: La dirección del PDF MUST NOT entrar al prompt ni redactarla el modelo:
  el historial guarda el documento con su pie y la dirección solo como dato del adjunto.
  (En el respaldo de texto de FR-1705/FR-1706 la dirección es parte del texto que se
  envió y queda así en el hilo.)

**Cierre de `check_stock`** (deroga en parte FR-1308 de la 028)

- **FR-1710**: Con dos o más productos resueltos, contando los que quedan tras el filtro
  de la 028 (existencia, y talla si la hubo): con 5 o menos, sin cierre; de 6 a 10 y sin
  recorte de MS-Stock, el cierre MUST ser «Hay más coincidencias, ¿me dices cuál te
  interesa?» sin consultar el catálogo; con **más de 10**, o si MS-Stock avisó que
  recortó, el sistema MUST consultar el catálogo en ese mismo turno (mismo tope de 3 s)
  y cerrar con «Hay más modelos en nuestro catálogo, ¿te lo mando?» si existe, o con
  «Hay más coincidencias, ¿me dices cuál te interesa?» si no existe o la consulta falla.
  Los productos mostrados, sus fotos y su orden MUST NOT cambiar por esto.
- **FR-1711**: La derogación parcial de FR-1308 MUST marcarse junto al requisito en la
  spec de la 028 (Principio VII), y la mención a "la 029" como feature del catálogo en
  sus supuestos MUST corregirse a la 032.

**Prompt**

- **FR-1712**: Con `INVENTARIO=on`, el prompt MUST indicar: usar `send_catalog` para
  preguntas generales sobre lo que vende el negocio y cuando el sistema ofreció el
  catálogo y el cliente acepta; que la frase de entrada no prometa el adjunto (puede
  salir sola); no describir, resumir ni citar el catálogo; existencia y precio solo con
  `check_stock`; y que, si el cliente cita algo del catálogo que no coincide con el
  inventario, manda el inventario.

**Mocks, arnés y documentación**

- **FR-1713**: El simulador de inventario del entorno de pruebas MUST responder la
  consulta del catálogo en la forma exacta del contrato, conmutable entre "con catálogo"
  y "sin catálogo", y MUST incluir una categoría con más de 10 productos con existencia
  para el cierre de FR-1710 (y otra de 6 a 10).
- **FR-1714**: El simulador del modelo MUST proponer `send_catalog` cuando el prompt la
  ofrece y el cliente pregunta en general o acepta el ofrecimiento, y MUST NOT
  proponerla cuando el prompt no la ofrece.
- **FR-1715**: El arnés automatizado MUST ejercitar: envío feliz (documento con nombre y
  pie), sin catálogo, MS-Stock caído, pie con frase recortada, canal sin documentos (si
  el arnés lo permite), Laboratorio, el cierre con 6 a 10 y con más de 10 (con y sin
  catálogo), y la corrida completa con `INVENTARIO` apagada sin cambios.
- **FR-1716**: El contrato inter-repo (v2) es la fuente de la forma y las reglas; la
  guía del conector de inventario de este repo MUST documentar `send_catalog` y el nuevo
  cierre.

### Derogaciones (Principio VII)

| Requisito vigente | Texto que deja de regir | Lo sustituye |
|---|---|---|
| FR-1308 (028) | "cerrar con `Hay más coincidencias, ¿me dices cuál te interesa?` si quedaron más con existencia o si MS-Stock avisó que recortó" | FR-1710: de 6 a 10 sin recorte, igual; con más de 10 o recorte y catálogo disponible, «Hay más modelos en nuestro catálogo, ¿te lo mando?» |

El resto de FR-1308 (25 pedidos, 5 mostrados, SKU exacto primero, 3 s, sin reintentos,
solo lectura) sigue vigente.

### Key Entities

- **Catálogo (visto por Uniko)**: lo que MS-Stock devuelve en cada consulta —dirección
  pública del PDF, nombre con el que el cliente lo recibe y fecha de subida—. Se pide en
  el turno que lo necesita y nunca se guarda fuera del mensaje enviado.
- **Mensaje de documento del agente**: un mensaje saliente de tipo documento cuyo adjunto
  apunta a la dirección del PDF, con su nombre y su pie; en el Laboratorio, el mismo
  mensaje persistido sin tocar la API.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con catálogo cargado, el 100% de las preguntas generales del arnés produce
  exactamente un mensaje de documento con el nombre y el pie esperados, en menos de 5 s.
- **SC-002**: Sin catálogo o con el inventario caído, el 100% de esos turnos responde
  con la frase del agente (o nada) en menos de 5 s, sin mencionar un fallo ni un
  adjunto que no salió.
- **SC-003**: Con más de 10 productos con existencia y catálogo, el 100% de los turnos
  muestra 5 productos y cierra con el ofrecimiento; con 6 a 10, el 100% cierra con «Hay
  más coincidencias…» y no consulta el catálogo.
- **SC-004**: En el 100% de los prompts inspeccionados en el arnés, la dirección del PDF
  no aparece.
- **SC-005**: Con `INVENTARIO` apagada, el arnés completo da el mismo resultado que antes
  de la feature.
- **SC-006**: En la instancia de pruebas, con el catálogo real subido a
  `stock.lanco.cloud`, una pregunta «¿qué venden?» por WhatsApp entrega el PDF con su
  nombre y su pie, y abre en el teléfono.

## Assumptions

- **Contrato como fuente**: la forma de `GET /v1/agent/catalog` y las reglas de envío
  (§4b) y de cierre (§4) viven en el contrato v2 del repo MS-Stock, publicado y
  desplegado el 2026-10-04; si algo no cuadra se corrige allá primero (FR-1716).
- **Ofrecimiento en texto**: con más de 10, el motor *ofrece* el catálogo en el cierre y
  lo envía solo si el cliente acepta (interpretación registrada en la 006 de MS-Stock),
  para no exceder el tope de 5 envíos por turno de la 028.
- **Sin migración ni variables**: el tipo de mensaje `document` y el adjunto de tipo
  documento ya existen; se usan las tres `STOCK_*` de la 026.
- **Solo WhatsApp envía documentos hoy**: Instagram y Messenger reciben el respaldo de
  texto con el enlace (FR-1705).
- **Pie fijo**: «Dime modelo y talla…» sirve a los negocios que venden por talla (los
  pilotos actuales); adaptarlo por negocio es una decisión futura del contrato.
- **Instancias**: `INVENTARIO` está encendida en `uniko-lanco` y en la instancia de
  NuriaAndrea; esta feature llega a esta última solo con la promoción a `production`,
  que es señal aparte del dueño.
- **Fuera de alcance**: recordar que el catálogo ya se envió en la conversación; enviarlo
  sin que lo pidan; varios catálogos; leer o describir su contenido; cachear su
  dirección; cambiar el tope de 5 de la 028.
