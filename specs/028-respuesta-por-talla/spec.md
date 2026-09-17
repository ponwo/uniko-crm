# Feature Specification: Respuesta por talla y fotos por producto en `check_stock`

**Feature Branch**: `028-respuesta-por-talla`

**Created**: 2026-09-15

**Status**: Draft

**Carril (Principio VI)**: **ciclo completo** (`specify → plan → tasks → implement`).
No toca el modelo de datos ni un contrato publicado por Uniko, pero **deroga en parte
cinco requisitos vigentes de la 026** (FR-1110, FR-1111, FR-1119, FR-1124, FR-1125;
Principio VII), cambia la "Forma exacta" del contrato inter-repo que Uniko implementa
(`uniko-integration.md` §4 de MS-Stock, que se corrige allá antes de programar aquí) y
cambia la **entrega**: un turno pasa de "un mensaje, a lo sumo una foto" a "varios
mensajes con foto, acotados". Qué se filtra, en qué orden sale y qué pasa cuando una
foto falla son decisiones que conviene tener escritas antes de tocar el motor.

**Input**: Decisiones del dueño del 2026-09-15, tomadas viendo el catálogo real de la
instancia de pruebas (cuatro modelos de playera con foto, precio y tallas distintas):
(1) si el cliente pregunta por una talla, la respuesta es **solo sobre esa talla**: los
modelos que tienen existencia en ella, cada uno con su precio y **su foto**; (2) los
modelos agotados en esa talla y los que no la traen **se omiten del todo** ("con 4
modelos es funcional; con 20 se vuelve invasivo y sin utilidad"); (3) **tope de 5 fotos
por turno** como paso inicial; (4) el catálogo general en PDF (para las preguntas
generales) es otra feature, posterior (029), y no condiciona esta.

## Contexto de negocio

Desde la 005 de MS-Stock y la extensión de tallas de la 026, un negocio de ropa carga
**modelos con tallas** ("Playera Negra" con CH, M, G, XG) y el agente responde con la
existencia por talla. Eso quedó bien para **un** modelo. Pero el cliente de ropa no
pregunta por un modelo: pregunta **"¿tienen playeras en G?"**, y hoy eso coincide con
todos los modelos de playera. Con el catálogo real de la instancia de pruebas:

| Modelo | Precio | Tallas (existencia) | Foto |
|---|---|---|---|
| PLayera Azul (`PLA-AZL`) | $800 | CH 5, XG 2 | sí |
| Playera Negra (`PLA-NGO`) | $300 | CH 10, M 9, G 8, XG 7 | sí |
| Playera roja (`PLY-ROJ`) | $219 | XCH 2, CH 4, M 0, G 7, XG 1, 24 0 | sí |
| Playera verde (`PLA-VRD`) | $200 | CH 2, M 10, XG 10 | sí |

la respuesta actual a "¿tienen playeras en G?" es una línea **por cada modelo** —dos
de ellas "no viene en talla G. Tallas: …", que no le sirven a quien pidió G— y **una
sola foto: la del primer modelo, que ni viene en G**. Es la regla correcta de la 026
para un producto ("a lo sumo la foto del primero, nunca una ráfaga") aplicada a una
pregunta que abarca varios. Y antes de eso, si el modelo de lenguaje manda la palabra
tal cual la escribió el cliente, **"playeras" en plural no encuentra nada** (la
búsqueda de MS-Stock es "contiene" sobre el nombre en singular).

Esta feature hace que la respuesta a una pregunta por talla sea **la lista de lo que sí
hay en esa talla, con la foto de cada modelo**, y que una pregunta por varios modelos
sin talla muestre cada modelo con su foto. Nada de esto lo redacta el modelo de
lenguaje: sigue separando nombre base y talla, y el sistema redacta y envía.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pregunta por una talla con varios modelos (Priority: P1)

Un cliente pregunta por una prenda en una talla ("¿tienen playeras en G?"). Recibe
**solo los modelos que tienen existencia en esa talla**, uno por mensaje, cada uno
con su foto y, como pie, su nombre, SKU, existencia en esa talla y precio. Los modelos
que no traen esa talla o la tienen agotada no aparecen. Si ninguno tiene existencia,
recibe una sola frase que lo dice.

**Why this priority**: es la pregunta más frecuente de un negocio que vende por talla
y hoy se contesta con ruido (modelos que no aplican) y con la foto equivocada. Es el
motivo de la feature.

**Independent Test**: con `INVENTARIO` encendida y el stock-mock con al menos tres
modelos con foto y tallas cruzadas, preguntar "¿tienen playeras en G?" en el
Laboratorio (o con el arnés E2E) y comprobar los mensajes salientes: exactamente uno de
imagen por modelo con existencia en G, con el pie esperado, y ninguno más.

**Acceptance Scenarios**:

1. **Given** los cuatro modelos de la tabla, **When** el cliente pregunta "¿tienen
   playeras en G?", **Then** recibe **dos** mensajes de imagen, en el orden en que
   MS-Stock los devolvió: la foto de la Negra con pie `Playera Negra (PLA-NGO) talla
   G: 8 pieza — $300 MXN` (precedido, en este primer pie, por la frase de entrada del
   modelo si la hubo) y la foto de la roja con pie `Playera roja (PLY-ROJ) talla G: 7
   pieza — $219 MXN`; Azul y verde no se mencionan; no hay mensaje de texto aparte.
2. **Given** los mismos modelos, **When** pregunta "¿y en M?", **Then** recibe la Negra
   (M 9) y la verde (M 10), cada una con su foto y su precio; la roja (M agotada) y la
   Azul (no trae M) **no se mencionan**.
3. **Given** los mismos modelos, **When** pregunta "¿tienen en XCH?" o "¿en extra
   chica?", **Then** recibe solo la roja (XCH 2) con su foto.
4. **Given** los mismos modelos, **When** pregunta "¿tienen playeras en 24?" (talla que
   solo la roja trae, agotada), **Then** recibe **un** mensaje de texto: `Por ahora no
   tengo playera en talla 24.` (con la frase de entrada del modelo delante, si la
   hubo); sin fotos.
5. **Given** que el cliente escribe la prenda en **plural** ("¿tienen playeras en G?"),
   **When** el agente consulta, **Then** encuentra los mismos modelos que con
   "playera": el plural no deja al cliente sin respuesta.
6. **Given** un modelo de la lista **sin foto**, **When** aparece entre los que tienen
   existencia, **Then** su línea llega como mensaje de texto en su lugar del orden; los
   demás siguen llegando con foto.
7. **Given** que el cliente pide la talla con una palabra ("grande", "mediana", "extra
   grande"), **When** ninguna etiqueta del negocio coincide literalmente, **Then** se
   aplican las equivalencias ya vigentes (G, M, XG…) y la respuesta es la misma que
   con la etiqueta.

---

### User Story 2 - Un solo modelo se sigue contestando como hoy (Priority: P1)

Si la pregunta resuelve a **un solo** modelo ("¿tienen la playera roja en M?"), la
respuesta conserva el formato vigente de la 026: la existencia de esa talla, o
"agotada" más las tallas con existencia, o "no viene en talla X" más las que sí tiene,
con la foto del modelo. Preguntó por ese modelo: la alternativa útil es la misma
prenda en otra talla.

**Why this priority**: es la regresión que no puede ocurrir: todo lo verificado en la
026 (escenarios 1–17 del arnés) debe responder exactamente igual.

**Independent Test**: los casos 1–17 del arnés E2E de la 026 pasan sin cambiar una
letra de su texto esperado, salvo el 9 ("varios resultados → una imagen, la del
primero"), que es exactamente la regla derogada y se reescribe con la nueva.

**Acceptance Scenarios**:

1. **Given** solo la roja coincide, **When** el cliente pregunta "¿tienen playera roja
   en M?", **Then** recibe la foto de la roja con pie `Playera roja (PLY-ROJ) talla M:
   agotada — $219 MXN. Con existencia: XCH 2, CH 4, G 7, XG 1`.
2. **Given** solo la roja coincide, **When** pregunta "¿… en XXG?", **Then** recibe
   `Playera roja (PLY-ROJ) no viene en talla XXG. Tallas: XCH 2, CH 4, M agotada, G 7,
   XG 1, 24 agotada` con su foto.
3. **Given** un producto **sin tallas** (Gorra), **When** el cliente pregunta por él
   con o sin talla, **Then** la respuesta es la de siempre (`Gorra (GOR-01): 3 pieza —
   sin precio`) y, si tiene foto, con ella.
4. **Given** el cliente da el SKU exacto de una talla (`PLY-ROJ-G`), **When** el agente
   consulta, **Then** responde con esa talla como hoy (`Playera roja (PLY-ROJ-G) talla
   G: 7 pieza — $219 MXN`).

---

### User Story 3 - Varios modelos sin talla: cada uno con su foto (Priority: P2)

Un cliente pregunta por una prenda sin decir talla ("¿qué playeras tienen?"). Recibe
un mensaje por modelo con existencia —foto y, como pie, la línea vigente del modelo
con sus tallas— hasta el tope; los modelos sin ninguna existencia no aparecen.

**Why this priority**: da consistencia (la foto acompaña al producto del que se habla,
no "al primero") mientras no exista el catálogo en PDF de la 029, que será la
respuesta a las preguntas generales.

**Independent Test**: preguntar "¿qué playeras tienen?" con los cuatro modelos y
comprobar cuatro mensajes de imagen con el pie de cada modelo.

**Acceptance Scenarios**:

1. **Given** los cuatro modelos, **When** el cliente pregunta "¿qué playeras tienen?",
   **Then** recibe cuatro mensajes de imagen, en orden, cada uno con el pie vigente de
   su modelo (p. ej. `Playera Negra (PLA-NGO) — $300 MXN. Tallas: CH 10, M 9, G 8,
   XG 7`), y la frase de entrada del modelo en el primero.
2. **Given** más de cinco modelos con existencia, **When** el cliente pregunta,
   **Then** recibe cinco y, al final, un mensaje de texto `Hay más coincidencias, ¿me
   dices cuál te interesa?`.
3. **Given** un modelo con todas sus tallas agotadas, **When** aparece entre los
   resultados de una pregunta sin talla con varios modelos, **Then** no se menciona.

---

### User Story 4 - Cuando una foto no sale, el dato sale igual (Priority: P3)

Si la foto de un modelo no puede enviarse (canal sin imágenes, Meta la rechaza o tarda
más de lo permitido), la línea de ese modelo llega como texto, en su lugar, y las demás
fotos siguen saliendo. La conversación nunca se detiene por una foto.

**Why this priority**: la 026 ya garantiza esto para una foto; con varias, la garantía
tiene que valer por mensaje y conservar el orden.

**Independent Test**: en el arnés, con el wa-mock rechazando la imagen del segundo
modelo, comprobar que el cliente recibe foto, texto, foto en ese orden y que el turno
termina dentro del límite.

**Acceptance Scenarios**:

1. **Given** tres modelos con foto y el envío de la segunda imagen rechazado, **When**
   el agente responde, **Then** el cliente recibe la primera foto con su pie, la
   segunda línea como texto y la tercera foto con su pie, en ese orden, y el error
   queda en el registro del servidor sin ningún texto de error para el cliente.
2. **Given** un canal sin imágenes salientes, **When** el agente responde con varios
   modelos, **Then** recibe **un** mensaje de texto con todas las líneas, como hoy.
3. **Given** una conversación de prueba del Laboratorio, **When** el agente responde
   con varios modelos con foto, **Then** el Laboratorio muestra un mensaje de imagen
   por modelo con su pie, sin tocar la API de WhatsApp.

---

### Edge Cases

- **La talla pedida existe en un modelo pero con existencia 0** (roja en M): se omite
  igual que si no la trajera; la única excepción es el caso de un solo modelo (US2).
- **Ningún modelo tiene existencia en la talla** (24): una frase, sin fotos, sin
  enumerar modelos ni tallas alternativas. El cliente puede preguntar por otra talla.
- **Sin talla, varios modelos y ninguno con existencia**: la misma idea, `Por ahora no
  tengo <consulta> con existencia.`; enumerar veinte agotados sería el ruido que esta
  feature elimina.
- **Producto sin tallas en una pregunta con talla y varios resultados**: si tiene
  existencia, se muestra con su línea de siempre (no tiene tallas: es de talla única y
  existe); si está agotado, se omite como cualquier otro sin existencia.
- **Frase de entrada del modelo** ("Claro, déjame ver"): va en el pie de la primera
  foto; si el primer mensaje es de texto (modelo sin foto o caso "ninguno"), delante
  de ese texto. Nunca como mensaje solo.
- **Más de cinco con existencia**: se muestran los cinco primeros en el orden de
  MS-Stock y se cierra con la invitación a precisar; también si MS-Stock avisó que
  recortó (`truncated`) aunque los filtrados sean menos de cinco.
- **Pie demasiado largo para WhatsApp**: una línea nunca se acerca al límite de un
  pie; si alguna lo superara, esa línea sale como texto y su foto sin pie (regla de la
  026), sin recortar el texto.
- **Un mismo modelo dos veces**: imposible por construcción (MS-Stock devuelve cada
  modelo una vez), pero el motor no manda dos veces la misma foto en un turno.
- **Consulta con forma de SKU + talla**: el SKU manda: un SKU de talla responde esa
  talla; un SKU de modelo con `size` sigue el camino de un solo modelo (US2).
- **MS-Stock caído, lento, con llave rechazada o respuesta inesperada**: igual que
  hoy, el turno se degrada (FR-1112); esta feature no añade caminos de fallo nuevos.
- **Bandera `INVENTARIO` apagada**: nada de esto existe; ninguna prueba cambia.

## Requirements *(mandatory)*

### Functional Requirements

**Filtro por talla** (deroga en parte FR-1111 y FR-1124 de la 026; ver "Derogaciones")

- **FR-1301**: Cuando `check_stock` trae `size` y la consulta resuelve a **dos o más**
  productos, el sistema MUST responder únicamente con los que tienen existencia en
  esa talla (etiqueta literal o equivalencia vigente), uno por línea con nombre, SKU,
  talla, existencia con unidad y precio, en el orden en que MS-Stock los devolvió;
  los modelos que no traen la talla o la tienen agotada MUST NOT mencionarse.
- **FR-1302**: Con `size` y **un solo** producto resuelto, la redacción MUST ser la
  vigente de la 026 (FR-1124): existencia de la talla; o "agotada" más las tallas con
  existencia; o "no viene en talla X" más las que tiene; una talla por SKU exacto
  muestra su etiqueta.
- **FR-1303**: Con `size`, varios productos y **ninguno** con existencia en la talla,
  el sistema MUST responder con una sola frase `Por ahora no tengo <consulta> en talla
  <talla>.` (la consulta tal como la pidió el cliente, la talla como la escribió), sin
  fotos ni enumeración; sin `size`, varios productos y ninguno con existencia, `Por
  ahora no tengo <consulta> con existencia.`
- **FR-1304**: Un producto **sin tallas** dentro de un conjunto de varios MUST
  mostrarse con su línea de siempre si tiene existencia, con o sin `size`, y MUST
  omitirse si está agotado. Un producto sin tallas que resuelve solo MUST verse
  exactamente como antes.

**Fotos por producto** (deroga en parte FR-1119 y FR-1125 de la 026)

- **FR-1305**: Por cada producto que aparece en la respuesta con existencia y trae
  `image_url`, el motor MUST enviar un mensaje de imagen por URL cuyo pie es la línea
  de ese producto; la frase de entrada del modelo, si la hay, MUST ir al inicio del
  primer mensaje del turno (imagen o texto). Los productos mostrados sin `image_url`
  MUST salir como texto en su posición. MUST NOT enviarse la misma foto dos veces en
  un turno, ni más de **5** mensajes de imagen por turno.
- **FR-1306**: Los mensajes de un turno MUST salir en orden y de uno en uno; un fallo
  al enviar una imagen (rechazo, más de 5 s, `failed`) MUST convertir **esa** línea en
  texto sin afectar a las demás, registrando el motivo en el servidor y sin texto de
  error al cliente (regla FR-1120 aplicada por mensaje). En canales sin imágenes
  salientes, o cuando ningún producto mostrado tiene foto, el turno MUST salir como un
  único mensaje de texto con todas las líneas, como hoy.
- **FR-1307**: Sin `size` y con varios productos, el sistema MUST mostrar una línea
  por producto **con existencia** (la línea vigente: con tallas, `Nombre (SKU) —
  precio. Tallas: …`; sin tallas, la de siempre), con la foto de cada uno según
  FR-1305; los productos sin ninguna existencia MUST omitirse. Un solo producto sin
  `size` MUST verse exactamente como antes (agotado incluido).

**Alcance de la consulta** (deroga en parte FR-1110)

- **FR-1308**: Para poder filtrar por talla del lado Uniko, la búsqueda a MS-Stock MUST
  pedir hasta **25** resultados (su máximo) cuando `check_stock` trae `size` y también
  cuando no la trae; la respuesta al cliente MUST mostrar a lo sumo **5** productos y
  cerrar con `Hay más coincidencias, ¿me dices cuál te interesa?` si quedaron más con
  existencia o si MS-Stock avisó que recortó. El resto del contrato de consulta
  (SKU exacto primero, 3 s, sin reintentos, solo lectura) no cambia.
- **FR-1309**: El prompt del agente MUST pedir el nombre base del producto **en
  singular** en `query` ("playera", no "playeras") además de lo vigente (sin la talla;
  la talla en `size`; el SKU tal cual). El plural que aun así llegue lo tolera la
  búsqueda de MS-Stock (repo hermano, mismo endpoint, sin cambio de contrato).

**Contrato, mocks y verificación** (Principios V, VII y IX)

- **FR-1310**: La "Forma exacta" y la regla de la foto del contrato inter-repo
  (`specs/003-sso-uniko/contracts/uniko-integration.md` §4 de MS-Stock) MUST
  actualizarse **allá** con estas reglas antes de implementarlas aquí; esta spec la
  cita, no la reescribe.
- **FR-1311**: Las derogaciones parciales de FR-1110, FR-1111, FR-1119, FR-1124 y
  FR-1125 MUST marcarse en la spec de la 026 junto a cada requisito (texto tachado
  solo en la parte derogada + bloque DEROGADO con referencia a la 028 y motivo) y
  propagarse a plan, research, tasks, quickstart y contrato de la 026 donde se
  mencionen, en el mismo PR que las implementa.
- **FR-1312**: El stock-mock MUST incluir al menos **tres** modelos con tallas cruzadas
  y con foto, más uno sin foto, reproduciendo el catálogo real (una talla que solo un
  modelo trae; una talla agotada en uno y con existencia en otros; una talla que nadie
  tiene con existencia), y el arnés E2E MUST cubrir los escenarios de US1, US3 y US4
  con la bandera encendida; los casos 1–17 de la 026 MUST seguir pasando con el mismo
  texto esperado, salvo el 9, que MUST reescribirse con la regla nueva (una imagen por
  modelo con existencia). El wa-mock MUST poder rechazar una imagen concreta para US4.
- **FR-1313**: Con la bandera apagada nada de esto MUST existir ni cambiar ninguna
  prueba; los productos sin tallas y las preguntas que resuelven a un solo producto
  MUST conservar exactamente el texto de la 026.

### Derogaciones (Principio VII)

Esta feature deroga **en parte** requisitos de la 026, todos por el mismo motivo: sus
reglas se escribieron para una pregunta que resuelve a **un** producto, y aplicadas a
una pregunta por talla que abarca **varios** modelos producen ruido (modelos que no
aplican) y una foto que no corresponde (la del primero). Cada derogación se marca
también junto al requisito en la spec de la 026 (FR-1311).

| Requisito de la 026 | Parte que deja de regir | Qué la sustituye |
|---|---|---|
| FR-1110 | "búsqueda … con un máximo de 5 resultados" | FR-1308: se piden hasta 25 y se muestran 5 |
| FR-1111 | "una línea por producto, máximo 5" y "ofrece alternativas solo si MS-Stock devolvió coincidencias" en el caso con talla y varios productos | FR-1301, FR-1303, FR-1304, FR-1307: solo los que tienen existencia (en la talla pedida, si la hay) |
| FR-1119 | "un único mensaje de imagen … MUST NOT enviar más de una imagen por turno" y "en lugar del mensaje de texto" | FR-1305, FR-1306: una imagen por producto mostrado con foto, tope 5, pie por producto |
| FR-1124 | "con `size`, … 'agotada' más las tallas con existencia, o 'no viene en talla X' …" cuando hay **varios** productos | FR-1301, FR-1303: se omiten; la redacción rica queda solo para un producto (FR-1302) |
| FR-1125 | "a lo sumo una vez **por turno**" | FR-1305: a lo sumo una vez **por modelo**, hasta 5 por turno |

Sigue vigente sin cambio: FR-1112 (degradación), FR-1113 (solo lectura), FR-1120
(fallo de la foto, ahora por mensaje), FR-1121 (la URL no va al prompt), FR-1122 y
FR-1123 (adaptador y `size`), FR-1126 (mock y arnés, ampliados por FR-1312).

### Key Entities

Sin entidades nuevas ni persistencia nueva: los mensajes salientes (texto e imagen) ya
existen y se persisten como hoy; el conjunto filtrado vive solo en el turno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En el self-test con el catálogo del mock (réplica del real), "¿tienen
  playeras en G?" produce **exactamente** los mensajes de imagen de los modelos con
  existencia en G, con los pies literales esperados y ningún mensaje más; "en M" omite
  el modelo agotado en M y el que no la trae; una talla que solo un modelo trae
  produce un solo mensaje; una talla sin existencia en ningún modelo produce un solo
  mensaje de texto con la frase de FR-1303.
- **SC-002**: Los casos del arnés de la 026 (productos sin tallas, un modelo con y sin
  talla, agotada, talla inexistente, SKU de talla, foto) pasan **sin cambiar una
  letra** de su texto esperado, con la única excepción del caso 9 (la regla derogada);
  con la bandera apagada, 0 pruebas cambian de resultado.
- **SC-003**: Con la imagen de un modelo rechazada por el canal, el cliente recibe
  todas las líneas (esa como texto, las demás con foto) en el orden de MS-Stock, el
  turno termina dentro del límite de la degradación más 5 s por foto, y el fallo deja
  una línea en el registro del servidor.
- **SC-004**: Ningún turno envía más de 5 mensajes de imagen ni la misma foto dos
  veces (verificado en el arnés con más de cinco modelos con existencia).
- **SC-005**: El primer mensaje del turno llega al cliente en el mismo límite que hoy
  (6 s desde la pregunta); los demás, en orden, inmediatamente después.
- **SC-006**: La CI pasa en ambas configuraciones y el gate técnico (`pnpm typecheck
  && pnpm lint && pnpm build && pnpm test`) queda en verde.
- **SC-007**: En la instancia de pruebas (`uniko.lanco.cloud` ↔ `stock.lanco.cloud`),
  con los cuatro modelos reales: "¿tienen playeras en G?" responde Negra y roja con
  sus fotos y precios; "¿en M?" Negra y verde; "¿en XCH?" solo la roja; y "¿tienen
  playera roja en M?" responde como en la 026. Esta verificación cierra también la
  T057 pendiente de la 026.

## Ajuste 2026-09-17 — orden de llegada de las fotos (extensión)

**Hallazgo en la instancia de pruebas** (SC-007, capturas del dueño): el motor manda
los mensajes en orden (FR-1306), pero Meta entrega cada imagen por URL **cuando termina
de descargarla**, así que dos fotos seguidas pueden llegar invertidas al teléfono: la
verde apareció antes que la Negra, que llevaba la frase de entrada. Decisión del dueño
(2026-09-17): garantizar el orden esperando la confirmación de Meta.

### User Story 5 - Las fotos llegan en el orden en que se mandaron (Priority: P2)

Cuando el turno lleva varios mensajes, el cliente los ve en el orden en que el sistema
los redactó: la frase de entrada siempre en el primero. El motor no manda el siguiente
mensaje hasta que Meta confirma que el anterior con foto ya salió (`sent`), con un
tope corto para que una confirmación que no llega no detenga la respuesta.

**Independent Test**: en el arnés, tras «¿tienen playeras en G?» las imágenes quedan
`sent` en el hilo (el mock emite el estado) y el outbox conserva el orden; con el
estado retrasado más que el tope, el turno sigue igual y termina dentro del límite.

**Acceptance Scenarios**:

1. **Given** un turno de tres mensajes (imagen, texto, imagen), **When** el motor los
   entrega, **Then** el segundo sale solo después de que Meta reportó `sent` del
   primero (o pasaron 2 s), y el tercero sale sin esperar por el texto.
2. **Given** que Meta no reporta `sent` de una foto (o tarda más de 2 s), **When** el
   motor espera, **Then** al cumplirse el tope manda el siguiente igualmente, sin
   texto de error ni retraso adicional.
3. **Given** una conversación de prueba del Laboratorio o un canal sin acuses de
   entrega, **When** el turno lleva fotos, **Then** no se espera nada (no hay estados
   que esperar).

### Functional Requirements (extensión)

- **FR-1314**: Antes de enviar cada mensaje de un turno de varios, si el mensaje
  anterior salió **con foto** por un canal con acuses de entrega, el motor MUST esperar
  a que ese mensaje deje de estar `pending` (`sent`, `delivered`, `read` o `failed`) o a
  que pasen **2 s**, lo que ocurra primero; tras un texto, o en conversaciones de prueba
  y canales sin acuses, MUST NOT esperar. La espera MUST NOT cambiar qué se envía ni
  cuántos mensajes salen.
- **FR-1315**: El wa-mock MUST reportar `sent` (por el webhook, como Meta) unos
  cientos de milisegundos después de aceptar una imagen por URL, para que el arnés
  ejercite la espera real y no el tope; el arnés MUST comprobar que las imágenes de un
  turno de varios quedan `sent` en el hilo y que el orden del outbox es el de envío.

### Success Criteria (extensión)

- **SC-008**: en el arnés, «¿tienen playeras en G?» deja las dos imágenes `sent` en el
  hilo y el outbox en el orden negra · roja · gris; con el tope (estado nunca
  reportado, test unitario con reloj falso), el segundo envío ocurre a los 2 s y no
  antes; ninguna prueba de la 026/028 cambia de texto.

## Assumptions

- **Decisiones del dueño (2026-09-15)**: agotadas y modelos sin la talla se omiten del
  todo (no una línea de "agotadas"); tope de 5 fotos por turno como paso inicial,
  revisable; la frase de entrada va en el primer pie. Registradas también en la
  memoria del asistente del repo MS-Stock.
- **El plural lo resuelve MS-Stock**: la tolerancia al plural es un cambio en la
  búsqueda del repo hermano (mismo endpoint, mismo contrato, se ejercita con su propio
  gate); aquí solo se ajusta el prompt (FR-1309). Si MS-Stock aún no lo tuviera, el
  escenario 5 de US1 depende de que el modelo de lenguaje ponga el singular.
- **Catálogo PDF (029) fuera de alcance**: las preguntas generales ("¿qué venden?") y
  la sustitución de "Hay más coincidencias…" por ofrecer el PDF se especifican en la
  029, cuando MS-Stock exponga el catálogo. Esta feature no la presupone.
- **Sin variables, migración ni pantalla nuevas**: todo vive en el motor del turno y
  en el adaptador existente; el Laboratorio muestra los mensajes como ya lo hace.
- **Ráfaga acotada a propósito**: los 5 mensajes de imagen salen porque el cliente los
  pidió (una pregunta, una respuesta en varias partes); no es difusión. El
  guardarraíl de la 026 ("nunca una ráfaga") pasa a ser un tope explícito, no una
  prohibición.
- **Contrato como fuente**: la "Forma exacta" vive en el contrato de MS-Stock; si al
  planear algo no cuadra, se corrige allá primero (FR-1310).
- **Fuera de alcance**: recordar fotos ya enviadas en turnos anteriores; elegir qué
  foto mandar cuando un modelo tenga varias (hoy tiene una); paginar ("mándame las
  otras"); filtrar por color o cualquier atributo distinto de la talla.
- **Orden de llegada (ajuste 2026-09-17)**: se garantiza esperando el `sent` de Meta
  con tope de 2 s por foto; un turno de 5 fotos puede tardar hasta ~10 s más en el
  peor caso (estados que no llegan), aceptado por el dueño frente a ver la frase de
  entrada en el segundo globo.
