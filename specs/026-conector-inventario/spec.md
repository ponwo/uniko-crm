# Feature Specification: Conector INVENTARIO — botón "Inventario" (SSO a MS-Stock) y acción `check_stock` del agente

**Feature Branch**: `026-conector-inventario`

**Created**: 2026-09-12

**Status**: Draft

**Carril (Principio VI)**: **ciclo completo** (`specify → plan → tasks → implement`).
No toca el modelo de datos ni un contrato publicado por Uniko, pero introduce un
**conector opcional** (Principio II, cinco condiciones) que consume el contrato de otro
repositorio, requiere mock con camino infeliz y CI apagado/encendido: el plan es
donde se decide el adaptador, la bandera y la degradación, y conviene tenerlo escrito
antes de programar.

**Input**: Decisión del dueño 2026-09-12: "arranca eso, la 004 esperará" — implementar
el lado Uniko de la feature 003 de MS-Stock, siguiendo su contrato de integración
[`../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md):
un botón "Inventario" que lleva a la persona al portal de MS-Stock sin pedirle la llave
(pase firmado de un solo uso) y una acción tipada `check_stock` con la que el agente
consulta existencias y precios reales antes de afirmarlos.

## Contexto de negocio

Un negocio que vende por WhatsApp pierde la venta —o la confianza— cuando el agente
promete algo que no hay o da un precio viejo. Hoy Uniko no sabe nada de inventario:
el agente contesta "sí, tenemos" por intuición del modelo. **MS-Stock** es un
microservicio aparte (una instancia por negocio, ya desplegado en
`https://stock.lanco.cloud`) que guarda catálogo, existencias y movimientos, con una
API para el agente y un portal para el negocio. Esta feature conecta las dos piezas
sin que Uniko absorba lógica de inventario:

1. **Para la persona**: un botón "Inventario" en la navegación que abre el portal de
   MS-Stock ya autenticado — la identidad vive en Uniko, MS-Stock no tiene usuarios.
2. **Para el agente**: la acción `check_stock`, que consulta MS-Stock y responde con
   datos reales (nombre, existencia, unidad, precio), y **nunca inventa** existencias.

Como todo lo opcional en Uniko (ADR-001, ADR-002), el conector viaja en `main`
**apagado**: la bandera `INVENTARIO` lo enciende por instancia; sin ella no hay botón,
ni acción, ni variables exigidas, ni una palabra de inventario en el prompt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Abrir el inventario desde Uniko sin llave (Priority: P1)

Quien opera el negocio, ya dentro de Uniko, ve en la navegación un renglón
"Inventario". Al pulsarlo se abre (en una pestaña nueva) el portal de MS-Stock con su
inventario a la vista y su nombre en la cabecera, sin escribir ninguna llave. Si algo
falla en el camino (pase caducado, secretos distintos), la pantalla que ve es la de
MS-Stock, con su mensaje y su "Volver a Uniko"; Uniko no necesita pantalla propia.

**Why this priority**: es la mitad visible de la integración y lo que hace que el
negocio pueda mantener su inventario al día — sin datos en MS-Stock, `check_stock` no
tiene nada que consultar.

**Independent Test**: con la bandera encendida y las tres variables configuradas,
iniciar sesión en Uniko, pulsar "Inventario" y comprobar que aterriza en el portal con
el nombre del usuario. Con la bandera apagada, el renglón no existe y la ruta que emite
el pase responde como inexistente. Sin sesión de Uniko, la ruta del pase no emite nada.

**Acceptance Scenarios**:

1. **Given** `INVENTARIO` encendida y una persona con sesión en Uniko, **When** abre
   cualquier pantalla de la app, **Then** la navegación muestra "Inventario" después
   de "Pipeline" (y de "Citas" si la agenda está encendida), en escritorio y en el
   cajón móvil.
2. **Given** ese renglón, **When** lo pulsa, **Then** se abre una pestaña nueva que
   termina en el inventario de MS-Stock con "<su nombre> desde Uniko" en la cabecera,
   sin pedir llave; la pestaña de Uniko sigue donde estaba.
3. **Given** `INVENTARIO` apagada, **When** cualquier persona usa la app, **Then** no
   existe el renglón, la ruta que emite el pase responde como ruta inexistente y
   ninguna pantalla ni texto menciona inventario.
4. **Given** `INVENTARIO` encendida, **When** alguien sin sesión de Uniko abre la ruta
   que emite el pase, **Then** no se emite ningún pase: recibe la respuesta de "no
   autenticado" habitual de la app.
5. **Given** cada pulsación del botón, **When** se observa el pase emitido, **Then** es
   distinto en cada clic (un solo uso), tiene vida de 2 minutos y lleva la identidad
   de quien pulsó (id y nombre como Uniko los conoce).
6. **Given** un pase que MS-Stock rechaza (caducó, ya se usó, secretos distintos),
   **When** la persona lo ve, **Then** la pantalla es la de MS-Stock con su mensaje y
   "Volver a Uniko" apuntando a esta instancia; al volver y pulsar de nuevo obtiene
   un pase nuevo.

---

### User Story 2 - El agente consulta existencias reales antes de afirmarlas (Priority: P1)

Un cliente pregunta por WhatsApp "¿tienen playera negra?" o "¿cuánto cuesta la
PLY-NEG?". Con el conector encendido, el agente **consulta** MS-Stock y responde con
lo que hay de verdad: nombre, existencia, unidad y precio; si no hay coincidencias lo
dice; si hay muchas, pide precisar. Si MS-Stock no responde, el agente contesta igual
que antes de esta feature (sin datos de inventario) y la conversación **nunca se
bloquea** ni el cliente lee "el sistema falló". Con el conector apagado, el agente ni
siquiera conoce la acción.

**Why this priority**: es el valor de negocio de toda la integración: dejar de
prometer lo que no hay.

**Independent Test**: en el Laboratorio (o con los mocks de pruebas), enviar
"¿tienen playera negra?" y comprobar que la respuesta del agente contiene la
existencia y el precio que devuelve MS-Stock (o su mock); apagar el mock (o hacerlo
fallar) y comprobar que el agente responde sin inventario y sin colgarse; apagar la
bandera y comprobar que el esquema de acciones del turno no incluye `check_stock`.

**Acceptance Scenarios**:

1. **Given** `INVENTARIO` encendida y un producto "Playera negra" (SKU `PLY-NEG`, 7
   piezas, $199 MXN) en MS-Stock, **When** el cliente pregunta si tienen playera negra,
   **Then** el agente ejecuta `check_stock` con esa consulta y responde mencionando el
   producto, que hay existencia (7 piezas) y el precio ($199 MXN), sin inventar nada
   más.
2. **Given** el cliente escribe un SKU exacto (`PLY-NEG`, aun en minúsculas),
   **When** el agente consulta, **Then** obtiene ese producto directamente y responde
   con sus datos.
3. **Given** un producto agotado (existencia 0) o inexistente, **When** el cliente
   pregunta por él, **Then** el agente dice que está agotado o que no lo encontró, y
   ofrece alternativas solo si MS-Stock devolvió coincidencias.
4. **Given** una consulta con más coincidencias de las que se muestran, **When** el
   agente responde, **Then** enumera a lo sumo 5 productos y pide al cliente precisar.
5. **Given** MS-Stock caído, lento (más de 3 s), con llave rechazada o con una
   respuesta inesperada, **When** el agente intenta `check_stock`, **Then** el turno
   se degrada a una respuesta sin inventario (la frase que el modelo propuso o, si no
   hay, ninguna acción), el error queda en el registro del servidor de Uniko, y el
   cliente nunca recibe un mensaje de error técnico.
6. **Given** `INVENTARIO` apagada, **When** el agente decide su acción, **Then**
   `check_stock` no está en el esquema del turno ni en el prompt; si un modelo la
   devolviera igual, se degrada como acción desconocida.
7. **Given** el prompt del agente con el conector encendido, **When** el cliente
   pregunta por disponibilidad o precio de algo, **Then** el agente consulta antes de
   afirmar: no afirma existencia ni precio que no haya obtenido en este turno.
8. **Given** una conversación de prueba del Laboratorio, **When** la persona simulada
   pregunta por un producto, **Then** el agente consulta igual (es solo lectura) y el
   Laboratorio muestra la respuesta con los datos; ninguna consulta de prueba escribe
   nada en MS-Stock.
9. **(Foto, 2026-09-13)** **Given** el producto resuelto trae `image_url` distinto
   de `null` (MS-Stock feature 004), **When** el agente ejecuta `check_stock` por
   WhatsApp, **Then** el cliente recibe en el mismo turno **un** mensaje de imagen
   por URL (`link = image_url`) con el texto del producto como pie (`caption`), y
   ningún mensaje de texto aparte; la foto la sirve la URL pública tal cual (Uniko no
   la descarga, reescala ni proxea).
10. **Given** `image_url` es `null` (producto sin foto, o instancia sin fotos) o el
    canal no admite imágenes, **When** el agente responde, **Then** se envía solo el
    texto, exactamente como antes de esta extensión.
11. **Given** el envío de la imagen falla (Meta la rechaza, no responde en 5 s, o la
    reporta `failed` después de aceptarla), **When** el agente responde, **Then** el
    cliente recibe el texto solo, sin ningún mensaje de error y sin retraso más allá
    del límite; el fallo queda en el registro del servidor.
12. **Given** una búsqueda con varios resultados, **When** se responde, **Then** se
    envía a lo sumo la foto del **primer** producto (o ninguna), nunca una ráfaga de
    imágenes; y `image_url` jamás forma parte del prompt del modelo ni se guarda
    fuera del mensaje enviado.
13. **(Tallas, 2026-09-14)** **Given** MS-Stock (feature 005) devuelve un **modelo con
    tallas** ("Playera roja", `PLY-ROJ`, con `variants` CH 4, M 0, G 7, XG 1),
    **When** el cliente pregunta "¿tienen playera roja?", **Then** el cliente recibe
    **una** línea del modelo con su precio y la existencia de **cada talla en el
    orden del negocio**, marcando las agotadas (`Playera roja (PLY-ROJ) — $219 MXN.
    Tallas: CH 4, M agotada, G 7, XG 1`), sin que el modelo redacte ninguna cifra.
14. **Given** el cliente pide una talla concreta ("¿tienen playera roja en G?"),
    **When** el agente consulta, **Then** manda `query` = nombre base ("playera
    roja") y `size` = "G", y el cliente recibe la existencia **de esa talla**
    (`Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN`); si la talla está en 0,
    lo dice y ofrece las tallas con existencia (`talla M: agotada … Con existencia:
    CH 4, G 7, XG 1`); si el modelo **no viene** en esa talla, lo dice y lista las
    tallas que sí tiene.
15. **Given** el cliente da el SKU exacto de una talla (`PLY-ROJ-G`), **When** el
    agente consulta, **Then** recibe esa talla y responde con su etiqueta y
    existencia (`Playera roja (PLY-ROJ-G) talla G: 7 pieza — $219 MXN`).
16. **Given** un producto sin tallas (`variants` vacía o ausente, MS-Stock anterior a
    la 005), **When** se responde, **Then** el texto es **exactamente** el de antes de
    esta extensión; `variants`, `label` o `parent_sku` ausentes o malformados nunca
    invalidan la respuesta.
17. **Given** un modelo con tallas y foto, **When** se responde, **Then** la foto es
    la del modelo y se envía **una sola vez** por turno (la misma para todas sus
    tallas), con las reglas de los escenarios 9–12.

---

### User Story 3 - Saber si el conector está bien conectado (Priority: P3)

En Ajustes, con la bandera encendida, la persona ve una sección "Inventario" que dice
a qué instancia de MS-Stock apunta y si la conexión funciona (llave aceptada, servicio
sano), con un botón "Probar conexión". Si falla, ve el motivo en lenguaje llano
(servicio no disponible / llave rechazada) para saber por qué el agente no está dando
existencias o el botón no entra.

**Why this priority**: sin esto, un fallo del conector solo se ve en los logs del
servidor; con esto, el negocio y quien administra lo diagnostican en 10 segundos. No
es imprescindible para que el botón y el agente funcionen.

**Independent Test**: con la bandera encendida, abrir Ajustes → Inventario, pulsar
"Probar conexión" y ver "Conectado"; apuntar la llave a un valor incorrecto (o hacer
fallar el mock) y ver "Llave rechazada" / "Servicio no disponible". Con la bandera
apagada, la sección no existe y su ruta responde como inexistente.

**Acceptance Scenarios**:

1. **Given** `INVENTARIO` encendida, **When** se abre Ajustes, **Then** hay una sección
   "Inventario" con la dirección de MS-Stock (sin llave ni secreto) y "Probar
   conexión".
2. **Given** MS-Stock sano y la llave correcta, **When** se pulsa "Probar conexión",
   **Then** aparece "Conectado" en menos de 5 s.
3. **Given** llave rechazada o servicio caído, **When** se pulsa, **Then** aparece el
   motivo ("Llave rechazada" / "Servicio no disponible") sin trazas técnicas.
4. **Given** `INVENTARIO` apagada, **When** se abre Ajustes, **Then** no existe la
   sección y su ruta responde como inexistente (`404`), igual que las demás banderas.

---

### Edge Cases

- **Bandera encendida con variables faltantes** (`STOCK_BASE_URL`, `STOCK_API_KEY`
  o `STOCK_SSO_SECRET` ausentes o inválidas): la instancia **no arranca a medias**:
  falla al arrancar con un mensaje que nombra la variable, como el resto de la
  configuración obligatoria. Con la bandera apagada, esas variables no se exigen ni
  se leen.
- **Secretos distintos entre Uniko y MS-Stock**: el pase se emite bien pero MS-Stock
  lo rechaza como "no válido"; la persona ve la pantalla de MS-Stock con "Volver a
  Uniko". Uniko no puede detectarlo por sí mismo (no comparte el secreto por red); la
  sección de Ajustes lo explica como causa posible cuando la API sí conecta.
- **`STOCK_BASE_URL` con `/` final o distinta del `APP_BASE_URL` de MS-Stock**: el pase
  llevaría un destinatario que MS-Stock no reconoce; Uniko normaliza la barra final y
  la documentación deja claro que debe ser exactamente el origen público de MS-Stock.
- **Consulta demasiado corta** (menos de 2 caracteres) o vacía por parte del modelo:
  no se llama a MS-Stock; se degrada como consulta inválida.
- **Consulta con forma de SKU que no existe**: se cae a la búsqueda por nombre antes
  de rendirse.
- **MS-Stock tarda**: límite de 3 s por llamada, sin reintentos dentro del turno; el
  turno degrada. La latencia no se suma al cliente más allá de ese límite.
- **Llave rotada en MS-Stock**: cada consulta recibe "no autorizado" → degradación en
  cada turno + error en el registro; Ajustes lo muestra como "Llave rechazada".
- **Producto desactivado en MS-Stock**: para el agente no existe (MS-Stock no lo
  devuelve); el agente dice que no lo encontró.
- **Varias personas pulsan "Inventario" a la vez**: cada una recibe su propio pase;
  no hay estado compartido en Uniko.
- **Sesión de Uniko cerrada mientras el portal sigue abierto**: el portal de MS-Stock
  conserva su propia sesión (12 h); es aceptable y está documentado en el contrato.
- **Conversaciones de prueba del Laboratorio**: `check_stock` es solo lectura, así que
  sí consulta; ninguna acción de esta feature escribe en MS-Stock, en modo prueba ni
  en modo real.
- **`image_url` con forma inválida** (no es una URL http/https): se trata como
  `null` — una foto mal formada nunca cuesta el texto ni degrada el turno.
- **Pie demasiado largo** (más de 1024 caracteres, el límite de WhatsApp): se envía el
  texto como mensaje aparte y la foto sin pie; nunca se recorta el texto.
- **Meta acepta la imagen y la reporta `failed` después** (no pudo descargar la URL):
  al recibir ese estado, Uniko envía el texto que iba en el pie como mensaje de
  texto; una sola vez por mensaje (los estados son monotónicos).
- **Conversación de prueba del Laboratorio con foto**: se persiste el mensaje de
  imagen (URL + pie) sin tocar la API, como cualquier salida del sandbox.
- **Talla escrita "a la mexicana"** ("grande", "mediana", "chica", "extra grande",
  "extra chica"): el motor la equipara a la etiqueta del negocio (G, M, CH, XG, XCH)
  solo cuando ninguna etiqueta coincide literalmente; cualquier otra etiqueta se
  compara sin mayúsculas ni acentos (`38`, `Única`).
- **Modelo con muchas tallas**: la línea lista todas las que MS-Stock devuelve (hasta
  30, tope del contrato); WhatsApp lo muestra en varias líneas visuales, sin
  recorte.
- **`size` sin `variants`** (el cliente pidió talla de un producto simple): se
  responde como producto simple; la talla pedida se ignora sin error.
- **Modelo sin tallas activas** (`variants` vacía, `stock` 0): se responde como
  producto agotado, como cualquier simple.

## Requirements *(mandatory)*

### Functional Requirements

**Bandera y configuración** (Principio II, ADR-001)

- **FR-1101**: El conector MUST existir solo con la bandera de despliegue
  `INVENTARIO` encendida (mismos valores que `AGENDA`); apagada (default), la
  instancia MUST NOT mostrar el botón, registrar la acción, exigir variables ni
  mencionar inventario en prompt, navegación o Ajustes; sus rutas responden como
  inexistentes.
- **FR-1102**: Con la bandera encendida, la instancia MUST exigir `STOCK_BASE_URL`
  (origen público de MS-Stock, sin barra final), `STOCK_API_KEY` y
  `STOCK_SSO_SECRET` (mínimo 32 caracteres), y MUST NOT arrancar si falta o es
  inválida alguna, con un mensaje que nombre la variable. Estas variables se
  documentan en `.env.example` con guía inline y en `docs/`.
- **FR-1103**: `STOCK_API_KEY` y `STOCK_SSO_SECRET` MUST NOT enviarse jamás al
  navegador, aparecer en respuestas de la app, ni escribirse en registros.

**Botón "Inventario" y pase SSO** (contrato `sso-token.md` de MS-Stock)

- **FR-1104**: Con la bandera encendida, la navegación MUST mostrar "Inventario"
  después de "Pipeline" (y de "Citas" cuando la agenda está encendida) a todo
  miembro de la organización con sesión, en escritorio y en el cajón móvil, con el
  mismo estilo que los demás renglones y abriendo en pestaña nueva.
- **FR-1105**: El botón MUST llevar a una ruta del servidor de Uniko que exige sesión
  de Uniko; sin sesión, responde como el resto de rutas autenticadas (no autenticado)
  y MUST NOT emitir pase alguno.
- **FR-1106**: Esa ruta MUST emitir en cada solicitud un pase nuevo conforme al
  contrato: firmado con `STOCK_SSO_SECRET` (HS256), emisor = `APP_BASE_URL` de Uniko,
  destinatario = `STOCK_BASE_URL`, sujeto = id del usuario, nombre = nombre del
  usuario, identificador único por pase, vida de 2 minutos; y MUST redirigir al
  navegador a `{STOCK_BASE_URL}/portal/sso?token=<pase>`.
- **FR-1107**: Uniko MUST NOT reutilizar, guardar ni cachear pases; MUST NOT
  necesitar pantalla propia para los rechazos (los muestra MS-Stock con "Volver a
  Uniko" hacia `APP_BASE_URL`).

**Acción `check_stock` del agente**

- **FR-1108**: Con la bandera encendida, el esquema de acciones del turno MUST
  incluir `check_stock` con una consulta de texto (lo que el cliente pidió: nombre,
  parte del nombre o SKU; 2–100 caracteres) y una frase de entrada opcional; apagada,
  la acción MUST NOT existir en el esquema ni en el prompt, y si el modelo la
  devolviera se degrada como acción no válida.
- **FR-1109**: El prompt del agente con la bandera encendida MUST instruir: consultar
  con `check_stock` **antes** de afirmar existencia o precio; no inventar
  existencias ni precios; usar el SKU tal cual si el cliente lo da; y responder con lo
  que el sistema devuelva.
- **FR-1110**: Al ejecutar `check_stock`, Uniko MUST consultar MS-Stock con la llave
  de la instancia según el contrato: si la consulta tiene forma de SKU, primero el
  producto exacto y, si no existe, la búsqueda por nombre/SKU
  ~~con un máximo de 5 resultados~~; con un límite de 3 s por llamada y sin
  reintentos dentro del turno.
  **DEROGADO** (parcial, 028 `028-respuesta-por-talla`): el máximo de 5 en la **consulta**. Se piden hasta
  25 (FR-1308) porque Uniko filtra por talla y existencia del lado suyo y muestra 5;
  de 5 recortados podrían quedar 0 con la talla pedida aunque existan. Sigue vigente:
  SKU exacto primero, 3 s por llamada, sin reintentos.
- **FR-1111**: La respuesta al cliente MUST construirse con los datos devueltos
  (nombre, SKU, existencia con unidad, precio con moneda o "sin precio"), en un
  formato pequeño y determinista: ~~una línea por producto, máximo 5~~; "no encontré
  productos para «…»" si no hay coincidencias; y una invitación a precisar si hubo
  más coincidencias de las mostradas. La frase de entrada del modelo, si la hay,
  precede a los datos.
  **DEROGADO** (parcial, 028 `028-respuesta-por-talla`): "una línea por producto" cuando se resuelven **dos o
  más** productos: se muestran solo los que tienen existencia —en la talla pedida, si
  la hubo—, uno por mensaje, máximo 5, y los demás no se mencionan (FR-1301, FR-1303,
  FR-1304, FR-1307). Motivo: con varios modelos, los que no tienen lo pedido son ruido
  (decisión del dueño, 2026-09-15). Sigue vigente: los datos, "no encontré…", la
  invitación a precisar, la frase de entrada delante, y todo el requisito cuando se
  resuelve un solo producto.
- **FR-1112**: Ante cualquier fallo (red, tiempo agotado, llave rechazada, servicio
  no disponible, respuesta con forma inesperada, consulta inválida), el turno MUST
  degradarse a una respuesta sin inventario (la frase del modelo o ninguna acción),
  registrar el error en el servidor, y MUST NOT enviar al cliente ningún texto de
  error técnico ni bloquear la conversación (mismo patrón que la agenda).
- **FR-1113**: `check_stock` MUST ser de solo lectura: ninguna acción de esta
  feature escribe en MS-Stock. Las conversaciones de prueba del Laboratorio MAY
  consultar existencias (lectura) sin restricción adicional.
- **FR-1114**: El acceso a MS-Stock MUST hacerse a través de un adaptador dedicado
  con contrato propio (como el cliente Graph API o el adaptador LLM); el dominio del
  agente MUST NOT conocer rutas ni formas HTTP de MS-Stock.

**Foto del producto** (extensión 2026-09-13; contrato §4 "Foto del producto")

- **FR-1118**: El adaptador MUST aceptar `image_url` (URL pública http/https o
  `null`; ausente o malformada ⇒ `null`) en la forma del producto, sin que su
  ausencia o forma inválida invalide la respuesta.
- **FR-1119**: Cuando ~~el primer producto resuelto~~ trae `image_url`, el motor MUST
  enviar por WhatsApp ~~un único~~ mensaje de imagen por URL (`link = image_url`) con el
  texto del turno como pie, en lugar del mensaje de texto; MUST NOT descargar,
  reescalar ni proxear la foto; ~~MUST NOT enviar más de una imagen por turno~~; y en
  canales sin imágenes salientes MUST enviar solo el texto.
  **DEROGADO** (parcial, 028 `028-respuesta-por-talla`): "el primer producto" y "nunca más de una imagen por
  turno". Con varios productos mostrados, va **una imagen por producto** con foto, con
  la línea de ese producto como pie, en serie y en orden, con tope de **5** por turno
  (FR-1305, FR-1306). Motivo: el cliente que pregunta por una talla quiere ver lo que
  sí hay; la foto del primero (que podía ni venir en esa talla) no servía. Sigue
  vigente: imagen por URL sin descargar ni proxear, el texto como pie, y solo texto en
  canales sin imágenes (y, con un producto, exactamente como antes).
- **FR-1120**: La foto MUST NOT bloquear ni retrasar la respuesta: si el envío de
  la imagen falla o supera 5 s, o Meta la reporta `failed` después de aceptarla,
  el motor MUST enviar el texto solo (una vez), registrar el motivo en el servidor y
  MUST NOT mostrar al cliente ningún error.
- **FR-1121**: `image_url` MUST NOT incluirse en el prompt del modelo ni
  persistirse fuera del mensaje enviado (se usa en el turno; cambia cuando el
  negocio sube una foto nueva). En conversaciones de prueba el mensaje de imagen
  se persiste sin tocar la API.

**Tallas** (extensión 2026-09-14; contrato §4 "Forma exacta" y "Prompt", MS-Stock 005)

- **FR-1122**: El adaptador MUST aceptar `variants` (lista de `{sku, label, stock,
  available}`), `label` y `parent_sku` en la forma del producto; ausentes, `null` o
  malformados ⇒ lista vacía / `null`, sin invalidar la respuesta (compatibilidad con
  un MS-Stock anterior a la 005).
- **FR-1123**: `check_stock` MUST admitir un campo opcional `size` (1–20
  caracteres) con la talla que pidió el cliente; el prompt MUST instruir al modelo a
  poner en `query` el nombre base del producto (sin la talla) y la talla en `size`,
  y a usar el SKU tal cual cuando el cliente lo da. Con la bandera apagada nada de
  esto aparece en el esquema ni en el prompt.
- **FR-1124**: El sistema (nunca el modelo) MUST redactar la respuesta de un modelo
  con tallas: sin `size`, una línea con precio y la existencia de cada talla en el
  orden recibido (agotadas incluidas, marcadas); con `size`, la existencia de esa
  talla, o "agotada" más las tallas con existencia, o "no viene en talla X" más las
  tallas que sí tiene; una talla resuelta por SKU exacto MUST mostrar su etiqueta.
  Un producto sin tallas MUST verse exactamente como antes.
  **DEROGADO** (parcial, 028 `028-respuesta-por-talla`): solo en su **alcance**, por eso no se tacha texto: las
  redacciones "agotada más las tallas con existencia" y "no viene en talla X más las
  tallas que sí tiene" rigen únicamente cuando se resuelve **un** producto (FR-1302);
  con dos o más, los modelos agotados en la talla pedida o sin ella **se omiten**
  (FR-1301, FR-1303). Motivo: con 20 modelos, enumerar agotados y ausentes es invasivo
  y sin utilidad (decisión del dueño, 2026-09-15). Sin `size` y sin tallas: sin cambio.
- **FR-1125**: La foto de un modelo (`image_url`, la misma en sus tallas) MUST
  enviarse a lo sumo una vez ~~por turno~~, con las reglas FR-1119..FR-1121.
  **DEROGADO** (parcial, 028 `028-respuesta-por-talla`): "por turno" pasa a "por **modelo**": la misma foto
  nunca dos veces en un turno, pero un turno puede llevar hasta 5 fotos de modelos
  distintos (FR-1305). Motivo: el de FR-1119.
- **FR-1126**: El stock-mock MUST incluir un modelo con tallas (y su consulta por SKU
  de talla y por SKU del modelo) y el arnés E2E MUST cubrir los escenarios 13–16;
  la CI los ejercita con la bandera encendida.

**Estado del conector (Ajustes)**

- **FR-1115**: Con la bandera encendida, Ajustes MUST mostrar una sección
  "Inventario" con la dirección de MS-Stock (nunca la llave ni el secreto) y un botón
  "Probar conexión" que informe en menos de 5 s: "Conectado", "Llave rechazada" o
  "Servicio no disponible", en lenguaje llano. Apagada, la sección y su ruta MUST NOT
  existir (`404`).

**Verificación** (Principios V y IX)

- **FR-1116**: El entorno de pruebas MUST incluir un mock de MS-Stock tras el guard
  único de mocks (404 en producción) que imite las dos consultas del agente y
  `/health`, con estado controlable para el camino infeliz (llave rechazada, caído,
  lento, respuesta rota); el self-test E2E MUST cubrir botón, `check_stock` feliz e
  infeliz, y Ajustes; la CI MUST ejercitar la bandera apagada y encendida.
- **FR-1117**: El guion `tests/e2e/us-inventario.md` y el arnés automatizado MUST
  extenderse con esta historia; el README y `docs/` MUST documentar el conector (qué
  es MS-Stock, variables, cómo encenderlo, dónde vive el contrato).

### Key Entities

- **Conector INVENTARIO**: capacidad opcional de la instancia, definida por la
  bandera y tres variables; sin estado en la base de datos de Uniko.
- **Pase SSO**: credencial de un solo uso que Uniko emite por clic (contrato de
  MS-Stock 003); Uniko no lo almacena.
- **Consulta de existencias (`check_stock`)**: acción tipada del agente: consulta de
  texto + talla opcional + frase opcional → lista de hasta 5 productos (SKU, nombre,
  existencia, unidad, precio, moneda, disponible, foto, y desde la 005 sus tallas
  `variants` o su etiqueta `label`/`parent_sku` si es una talla) o vacío → texto para
  el cliente.
- **Estado del conector**: resultado instantáneo de "Probar conexión"; no se
  persiste.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Desde que la persona pulsa "Inventario" hasta que ve su inventario en
  MS-Stock pasan menos de 3 segundos sin escribir nada; 100 de 100 clics abren sesión
  (cada uno con un pase distinto).
- **SC-002**: En el self-test, 100 % de las preguntas por un producto existente
  reciben respuesta con la existencia y el precio exactos que devuelve MS-Stock (o su
  mock); 0 respuestas afirman existencias o precios que no vinieron de la consulta.
- **SC-003**: Con MS-Stock caído, lento o con llave rechazada, 100 % de los turnos
  responden al cliente en menos de 6 segundos sin texto de error técnico, y cada
  fallo deja una línea en el registro del servidor.
- **SC-004**: Con la bandera apagada, ninguna prueba existente cambia de resultado,
  la app no exige las variables nuevas, y `check_stock` no aparece en el esquema del
  turno ni en el prompt (verificado por test).
- **SC-005**: Ni la llave ni el secreto aparecen en HTML, respuestas JSON ni
  registros (verificación literal en el self-test).
- **SC-006**: La CI pasa en ambas configuraciones (bandera apagada y encendida con
  mock), y el gate técnico (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`)
  queda en verde.
- **SC-007**: En la instancia de pruebas (`uniko.lanco.cloud` ↔ `stock.lanco.cloud`),
  el botón entra al portal real y una pregunta por `PLY-NEG` en el Laboratorio
  responde con sus datos reales.
- **SC-008** (foto): en el self-test, una pregunta por un producto con foto produce
  exactamente un mensaje saliente de tipo imagen con `link` = la `image_url` del mock
  y el texto como pie; sin foto, solo texto; con el envío de imagen rechazado o lento,
  el texto llega solo dentro del mismo límite de tiempo de la degradación y sin
  mensaje fallido visible; en la instancia de pruebas, `FOTO-TEST` recibe texto +
  imagen por WhatsApp real.
- **SC-009** (tallas): en el self-test, "¿tienen playera roja?" recibe una sola línea
  con las cuatro tallas en orden y M marcada agotada; "en G" recibe la existencia de
  G; "en XXG" recibe "no viene en talla XXG" con las tallas disponibles; los cinco
  casos previos de US2 no cambian de texto; en la instancia de pruebas, una pregunta
  por un modelo real de `stock.lanco.cloud` responde con sus tallas.

## Assumptions

- **Contrato de MS-Stock como fuente**: el contrato de integración de la feature 003
  de MS-Stock es la referencia; si algo no cuadra, se corrige allá (y se cita aquí),
  no se adivina en Uniko. `check_stock` no requiere cambios en MS-Stock.
- **Quién ve el botón**: todo miembro de la organización con sesión (owner, admin,
  member), como recomienda el contrato. MS-Stock no distingue roles: quien entra
  puede modificar el inventario. Si el negocio quiere restringirlo, será una
  decisión posterior (ocultar el botón por rol).
- **Sin estado en la base de datos**: la configuración vive en variables de
  despliegue, como `AGENDA`/`ZOOM_*`; no hay migración. Si más adelante se quisiera
  configurar desde Ajustes (con credenciales cifradas), sería otra feature.
- **Idioma y formato de la respuesta del agente**: español, misma voz que el resto
  del prompt; el formato de una línea por producto lo pega el sistema (como los
  horarios de la agenda), el modelo solo aporta la frase de entrada.
- **Laboratorio**: consultar existencias en conversaciones de prueba está permitido
  porque es lectura pura; la regla "una cita de prueba nunca llega a un conector"
  protege escrituras y no aplica aquí.
- **Instancia de pruebas**: `uniko-lanco` ya tiene `STOCK_BASE_URL`, `STOCK_API_KEY`
  y `STOCK_SSO_SECRET` cargadas (2026-09-12); `INVENTARIO=on` se pondrá al desplegar
  esta feature, a propósito.
- **Tallas (2026-09-14)**: la respuesta con tallas la redacta el sistema (como el
  resto de `check_stock`): el modelo solo separa nombre base y talla. Equivalencias
  chica/mediana/grande/extra → CH/M/G/XCH/XG viven en el motor como respaldo; las
  etiquetas son las del negocio. Sin variables ni migración nuevas.
- **Fuera de alcance**: registrar movimientos (ventas, reservas) desde Uniko; mostrar
  inventario dentro de Uniko; configurar el conector desde la UI; restringir el botón
  por rol. Cada una sería una feature nueva (y las escrituras, también del lado
  MS-Stock).
- **Foto del producto (2026-09-13)**: fuera de alcance subir, reemplazar o quitar
  fotos desde Uniko (portal o API de MS-Stock), galería de varias imágenes y cachear
  imágenes. La URL enviada queda en el mensaje del hilo (es lo que se mandó, y es
  permanente por contrato); no se reutiliza en turnos posteriores.
