# Feature Specification: Conocimiento temporal — vigencia del conocimiento del agente

**Feature Branch**: `033-conocimiento-temporal`

**Created**: 2026-10-07

**Status**: Draft

**Carril (Principio VI)**: **ciclo completo** (`specify → plan → tasks → implement`).
Toca el modelo de datos (`drizzle/`: una columna nueva en `kb_entry`), así que además
pasa por el ensayo del Principio X antes de `main`.

**Input**: Decisiones del dueño (2026-10-07), tomadas en la conversación que abrió la
feature: (1) cada entrada del conocimiento gana **solo** una fecha opcional «vigente
hasta» —no «vigente desde»: el origen de una entrada es cuando se registra—; (2) al
vencer, la entrada **se oculta** a todo modelo, sin borrarse; (3) la fecha es **por
días**, sin hora; (4) la zona horaria es la de **México** para todos por ahora (si la
agenda está encendida, la de la agenda, que por defecto también es México). La base es
la feature 007 de Kosmo (`kosmo-crm`, commit `ce3aea7`, PR #32) —mismo diseño, ya
probado allá—, con los ajustes de Uniko que recoge [research.md](research.md).

## Contexto de negocio

El conocimiento del negocio entra al prompt del agente rotulado como «tu única fuente de
verdad». Hoy toda entrada es **permanente**: una promoción «válida hasta el 15 de
octubre» se sigue afirmando el 20 con la misma seguridad, y un curso que «inicia el 7 de
octubre, inscripciones abiertas» se sigue ofreciendo el 8, cuando las inscripciones ya
cerraron. El daño no es que el agente se equivoque de fecha: es que **afirma con
seguridad algo que ya no es verdad**, en nombre del negocio, por WhatsApp.

En Uniko el problema tiene dos mitades, y hoy faltan las dos:

1. **El reloj.** El agente solo sabe qué día es cuando la agenda está encendida
   (`pipeline.ts`: la zona horaria sale de la agenda). En las instancias sin agenda
   —los dos clientes de la flota— el agente **no sabe la fecha**: aunque el texto
   diga «hasta el 15 de octubre», no tiene contra qué compararlo. Lo mismo pasa con los
   separadores de día del historial (015, ajuste 2026-09-26): solo existen con agenda.
2. **La caducidad.** Aunque supiera la fecha, comparar fechas escritas en texto libre
   es justo lo que un modelo barato hace mal. El negocio necesita poder declarar
   «esto deja de ser verdad tal día» y que el sistema lo cumpla sin depender del
   modelo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El dato vencido deja de afirmarse (Priority: P1)

El dueño registra una entrada con una fecha **«vigente hasta»** opcional. Mientras la
fecha no pasa, el agente la usa igual que hoy. Al día siguiente de esa fecha, la entrada
sale del conocimiento que recibe el agente —y del que entrega la API del cerebro
externo—: el agente deja de saberlo y cae en su camino ya probado («no cuento con esa
información, lo confirmo con el equipo» o escala), en vez de afirmar algo que dejó de
ser cierto.

**Why this priority**: es la feature. Es la única historia que cambia lo que un cliente
final recibe por WhatsApp.

**Independent Test**: crear una entrada vencida, preguntarle al agente por ese tema y
comprobar que no lo afirma; repetir con una vigente y comprobar que responde como hoy.

**Acceptance Scenarios**:

1. **Given** una entrada con «vigente hasta» en el futuro, **When** un cliente pregunta
   por ese tema, **Then** el agente responde con ella, igual que hoy.
2. **Given** una entrada con «vigente hasta» = hoy, **When** un cliente pregunta a
   cualquier hora del día (hora de México), **Then** el agente todavía la usa: la fecha
   incluye ese día completo.
3. **Given** una entrada cuya fecha ya pasó, **When** un cliente pregunta por ese tema,
   **Then** el agente NO la afirma y sigue su camino de «no cuento con esa información»
   o escala, sin inventar.
4. **Given** una entrada SIN fecha, **When** pasa el tiempo, **Then** se comporta
   exactamente como hoy: permanente.
5. **Given** una entrada vencida, **When** un cerebro externo consulta
   `GET /api/bot/profile`, **Then** tampoco la recibe: las dos superficies que conducen
   conversaciones ven el mismo conocimiento.

---

### User Story 2 - El agente sabe qué día es y no repite lo viejo del historial (Priority: P1)

Con o sin agenda, el agente sabe en cada turno qué día y hora es en el negocio, y el
historial que ve marca qué mensajes son de días anteriores. Si en una conversación de
hace días se habló de una promoción, un precio o un cupo, el agente no lo repite como
vigente solo porque está en el historial: lo vigente es lo que diga hoy el conocimiento.

**Why this priority**: sin reloj, la mitad de los problemas temporales no tiene
solución —ni para fechas escritas en el texto ni para lo dicho en conversaciones
anteriores—. Y ocultar una entrada vencida no sirve si el agente la encuentra en su
propio mensaje de hace tres días.

**Independent Test**: con la agenda apagada, el prompt del agente lleva la fecha y la
hora del negocio y la regla del historial; un hilo con mensajes de otro día lleva el
separador «conversación ANTERIOR».

**Acceptance Scenarios**:

1. **Given** una instancia sin agenda, **When** el agente responde un turno, **Then** su
   prompt dice qué día y hora es en el negocio (México), igual que hoy con agenda.
2. **Given** una conversación retomada días después, **When** el agente responde,
   **Then** el historial que recibe marca dónde termina lo de días anteriores y dónde
   empieza lo de hoy, con o sin agenda.
3. **Given** que el agente dijo hace días «la promoción es hasta el 15» y hoy es 17,
   **When** el cliente pregunta «¿sigue la promoción?», **Then** el prompt le ordena no
   tomar lo dicho antes como vigente y basarse en el conocimiento de hoy (donde la
   entrada ya no está).
4. **Given** una instancia CON agenda, **When** el agente responde, **Then** la fecha y
   los separadores siguen usando la zona de la agenda, como hoy.

---

### User Story 3 - El dueño ve lo obsoleto, lo renueva y lo corrige (Priority: P2)

En la pantalla del agente, el dueño pone, cambia o quita la fecha de cualquier entrada
sin reescribir su texto. Ve marcadas las que vencen pronto (siguen activas) y, aparte,
una sección **«Conocimiento obsoleto»** con las vencidas: no se borran, para que pueda
renovarlas, corregir su texto o borrarlas a propósito.

**Why this priority**: sin esto, la caducidad se vive como pérdida de datos y el dueño
se entera tarde. Pero el producto ya es correcto sin ella: el agente degrada bien.

**Independent Test**: dejar vencer una entrada, comprobar que aparece en obsoletos con
su texto completo y la fecha, renovarla y comprobar que el agente vuelve a usarla.

**Acceptance Scenarios**:

1. **Given** el formulario de alta, **When** el dueño agrega una entrada con fecha,
   **Then** la entrada queda con esa fecha; sin fecha, queda permanente.
2. **Given** una entrada que vence dentro de 14 días o menos, **When** el dueño abre la
   pantalla, **Then** la ve marcada «vence pronto, sigue activa» y un aviso dice cuántas
   son.
3. **Given** una entrada vencida, **When** el dueño abre la pantalla, **Then** la ve en
   «Conocimiento obsoleto» con su texto completo y la fecha en que dejó de valer; la
   sección no aparece si no hay ninguna.
4. **Given** una entrada en obsoletos, **When** el dueño le pone una fecha futura o la
   hace permanente, **Then** vuelve al conocimiento vigente y el agente la usa en el
   siguiente turno.
5. **Given** cualquier entrada, **When** el dueño edita su texto, **Then** la fecha no
   cambia; **When** cambia la fecha, **Then** el texto no cambia.
6. **Given** que todo el conocimiento venció, **When** el dueño abre la pantalla,
   **Then** un aviso le explica que el agente no está afirmando nada y que renueve lo
   que siga siendo verdad.

---

### User Story 4 - El Laboratorio ensaya contra el mismo mundo que producción (Priority: P2)

Una corrida del Laboratorio usa el conocimiento vigente en el instante en que empezó: el
agente de prueba y el juez reciben el mismo conjunto, y el generador de escenarios no
escribe preguntas a partir de lo vencido.

**Why this priority**: si el juez ve una entrada que al agente se le ocultó, castiga al
agente por no decir algo que el sistema le ocultó a propósito: rojos fabricados por la
propia feature. Y un escenario generado desde un dato vencido nace obsoleto.

**Independent Test**: con una entrada vencida y otra vigente, correr el Laboratorio y
comprobar que el conocimiento del juez no contiene la vencida y sí la vigente; generar
escenarios y comprobar lo mismo en el prompt del generador.

**Acceptance Scenarios**:

1. **Given** una entrada vencida, **When** corre el Laboratorio, **Then** ni el agente
   ni el juez la reciben.
2. **Given** una corrida que empezó antes de medianoche y termina después, **When** el
   juez evalúa, **Then** ve exactamente el conocimiento que vio el agente: el de la
   fecha en que empezó la corrida.
3. **Given** una entrada vencida, **When** el dueño genera escenarios, **Then** el
   generador no la recibe; si TODO está vencido, el mensaje lo dice («renueva las
   fechas») en vez de «carga tu conocimiento».

---

### Edge Cases

- **La entrada vence a mitad de una conversación.** El corte se evalúa en cada turno:
  un cliente puede recibir la respuesta y, al día siguiente, un «lo confirmo con el
  equipo» sobre lo mismo. Es lo correcto: el dato dejó de ser verdad entre los dos.
- **Todo el conocimiento vence a la vez.** El agente queda como una instancia que aún no
  cargó nada: no inventa, escala. No es un estado de error.
- **Fecha pasada al crear.** Se admite —es la forma de archivar algo a propósito— y la
  entrada nace en obsoletos.
- **El texto de una entrada vencida menciona su propia fecha.** Renovar la vigencia no
  corrige el texto («hasta el 15 de octubre»): por eso el dueño puede editar los dos por
  separado.
- **El borde del día.** «Vigente hasta el 7» vale todo el 7 en México. A las 18:30 del 7
  en México ya es día 8 en UTC (la hora del servidor): el corte NO se evalúa en UTC.
- **Fecha imposible o con formato basura** («2026-02-31», «el martes»): se rechaza con
  un mensaje que dice qué se esperaba, nunca un error interno.
- **El juez y el agente con distinto conocimiento.** Una corrida que cruza la medianoche
  no puede darle al juez el conocimiento del día siguiente: ver US4-2.
- **La sugerencia del juez crea una entrada.** Nace sin fecha (permanente), como hoy.
- **Una instancia sin agenda con la fila de la agenda guardada** (la agenda estuvo
  encendida antes): la zona es la de México, no la de esa fila, porque la agenda no
  está activa.

## Requirements *(mandatory)*

### Functional Requirements

**El campo y su semántica**

- **FR-1801**: Cada entrada del conocimiento MUST poder llevar una fecha opcional
  **«vigente hasta»** (un día, sin hora). Sin ella, la entrada es permanente y su
  comportamiento es idéntico al actual. Las entradas existentes nacen sin fecha.
- **FR-1802**: La semántica MUST ser «último día en que el dato es verdad», inclusiva: la
  entrada vale todo ese día y deja de valer al empezar el siguiente. La interfaz MUST
  explicarlo de modo que no se confunda con la fecha del evento (un curso que empieza en
  octubre y dura tres meses va hasta enero).
- **FR-1803**: La fecha MUST ponerla el dueño. El sistema MUST NOT inferirla del texto
  ni con un modelo de lenguaje.
- **FR-1804**: «Hoy» MUST calcularse en la zona horaria del negocio: la de la agenda si
  la bandera `AGENDA` está encendida; si no, `America/Mexico_City` (suposición de
  producto). En un mismo turno, el corte del conocimiento y la fecha del prompt MUST
  usar el mismo instante y la misma zona.
- **FR-1805**: El estado de una entrada (vigente, por vencer, vencida) MUST derivarse de
  comparar su fecha con «hoy» en cada lectura. MUST NOT almacenarse ni depender de un
  proceso programado.

**El efecto sobre quien conduce conversaciones**

- **FR-1810**: Una entrada vencida MUST quedar fuera del conocimiento que recibe el
  agente. El agente MUST NOT recibir ninguna señal de que existió.
- **FR-1811**: Una entrada vencida MUST quedar fuera del conocimiento que entrega
  `GET /api/bot/profile`.
- **FR-1812**: Ante una pregunta cubierta solo por conocimiento vencido, el
  comportamiento MUST ser el que ya existe para conocimiento ausente (no inventar,
  ofrecer confirmarlo o escalar). Esta feature MUST NOT introducir un camino nuevo.
- **FR-1813**: El corte MUST evaluarse en cada turno, no al iniciar la conversación.
- **FR-1814**: Toda lectura del conocimiento MUST pasar por un único módulo
  (`src/server/kb/vigencia.ts`), y una prueba MUST fallar si otro archivo de `src/` lee
  la tabla `kb_entry`. El corte MUST hacerse en código (una función pura), no en la
  consulta SQL, para que las pruebas unitarias lo vean.

**El reloj y el historial**

- **FR-1820**: El prompt del agente MUST llevar SIEMPRE la fecha y la hora del negocio
  (día de la semana, fecha con año, hora), con o sin agenda, e indicar que sirve para
  saber qué fechas del historial y del conocimiento ya pasaron.
- **FR-1821**: El historial que recibe el agente MUST llevar SIEMPRE los separadores de
  día (lo de una conversación anterior / lo de hoy), con o sin agenda.
- **FR-1822**: El prompt MUST incluir una regla: lo dicho en mensajes de días anteriores
  sobre promociones, precios, fechas, cupos o inscripciones pudo cambiar; el agente
  MUST NOT repetirlo como vigente solo porque está en el historial; lo vigente es lo que
  diga hoy el conocimiento, y si ya no aparece ahí, ofrece confirmarlo con el equipo.

**Lo que ve el dueño**

- **FR-1830**: El conocimiento vencido MUST NOT borrarse por vencer. MUST verse aparte
  del vigente («Conocimiento obsoleto»), con su texto completo y la fecha en que dejó de
  valer.
- **FR-1831**: El dueño MUST poder poner, mover o quitar la fecha de una entrada sin
  reescribir su texto (quitarla la vuelve permanente).
- **FR-1832**: El dueño MUST poder editar el texto de cualquier entrada, vigente o
  vencida, sin tocar su fecha, y borrarla explícitamente.
- **FR-1833**: La interfaz MUST distinguir tres estados sin que el dueño calcule fechas:
  vigente; **por vencer** (vence dentro de 14 días o menos, sigue activa) con un aviso
  de cuántas son; y vencida.
- **FR-1834**: El estado MUST calcularlo el servidor, no el navegador.
- **FR-1835**: El contador de tamaño del conocimiento MUST contar solo lo vigente.
- **FR-1836**: Una fecha con formato inválido o inexistente MUST rechazarse con `422`
  y un mensaje que diga qué se esperaba. Una fecha pasada al crear MUST aceptarse.
- **FR-1837**: Si todo el conocimiento del negocio está vencido, la pantalla MUST
  explicarlo y pedir renovar lo que siga siendo verdad.

**El Laboratorio**

- **FR-1840**: Una corrida MUST resolver el conocimiento vigente UNA vez, contra el
  instante en que empezó (`started_at` de la corrida, ya registrado), y ese mismo
  instante MUST usarlo el agente en cada turno de prueba y el juez al evaluar.
- **FR-1841**: La generación de escenarios MUST partir solo del conocimiento vigente.
  Si hay conocimiento pero todo está vencido, MUST decirlo con un motivo propio,
  distinto de «no hay conocimiento».
- **FR-1842**: Las sugerencias del juez MUST crear entradas sin fecha, como hoy.

**Ciclo de vida, datos y pruebas**

- **FR-1850**: La fecha MUST ser un dato de la organización: viaja dentro de
  `kb_entry` (con `organization_id` y `scoped()`), se lee por organización y se borra
  con ella.
- **FR-1851**: La migración MUST ser aditiva: una columna nullable, sin backfill. La
  reversión de código (redesplegar el commit anterior) MUST dejar la columna sin uso y
  sin romper nada.
- **FR-1852**: El simulador del modelo (ai-mock) MUST responder según el conocimiento
  que se le entregó: ante un tema marcado en el mensaje del cliente, dice que lo conoce
  solo si ese tema aparece en el conocimiento de su prompt. Así una prueba de «el dato
  vencido deja de afirmarse» puede fallar.
- **FR-1853**: El arnés automatizado MUST ejercitar: alta con y sin fecha, los tres
  estados, el `422`, el contador de tamaño, la API del cerebro externo, el turno del
  agente (vencida → no la afirma; renovada → la vuelve a usar; permanente), el
  Laboratorio (juez y generador sin lo vencido) y la pantalla (por vencer, obsoletos,
  renovar).

### Key Entities

- **Entrada de conocimiento (`kb_entry`)**: gana `valid_until` (fecha, opcional): el
  último día en que la entrada es verdad. Todo lo demás (tipo, pregunta, respuesta,
  contenido) no cambia.
- **Conocimiento vigente**: las entradas sin fecha, más las que aún no la han pasado.
  Es lo único que llega al agente, al cerebro externo, al juez y al generador.
- **Conocimiento obsoleto**: las entradas cuya fecha ya pasó. Existen, se ven y se
  recuperan; no llegan a ningún modelo.
- **Zona del negocio**: la de la agenda con `AGENDA` encendida; si no, México.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un dato con la fecha vencida deja de afirmarse en el 100 % de los turnos,
  tanto del agente como de un cerebro externo (comprobable en el arnés).
- **SC-002**: Las entradas sin fecha se comportan igual que hoy: ninguna entrada
  existente cambia de estado con la migración.
- **SC-003**: Una entrada vencida vuelve al servicio en un paso (cambiar su fecha) y el
  agente la usa en el siguiente turno.
- **SC-004**: Ninguna entrada se pierde por vencer: el 100 % del conocimiento vencido
  sigue consultable y recuperable.
- **SC-005**: En una corrida del Laboratorio, el conocimiento del juez coincide con el
  del agente (comprobable en el arnés: el vencido no aparece en ninguno).
- **SC-006**: Con la agenda apagada, el 100 % de los turnos del agente llevan la fecha
  del negocio en el prompt.
- **SC-007**: El dueño pone fecha a una entrada existente en menos de 30 segundos, sin
  reescribir su texto.

## Assumptions

- **La fecha es un día, no un instante**: «el taller termina en enero» no necesita hora
  y minuto; pedirlos sería precisión falsa.
- **Zona de México como suposición de producto** (decisión del dueño): todos los
  negocios de la flota operan en México. El día que haya uno fuera, la zona se vuelve un
  ajuste del negocio; la función que la resuelve es el único sitio a cambiar.
- **Sin «vigente desde»** (decisión del dueño): el origen de una entrada es cuando se
  registra. Lo que cambia en una fecha futura («ya inició; la próxima generación es en
  enero») se escribe ese día; mientras tanto, el agente degrada a «lo confirmo». Si los
  negocios piden programar entradas, agregar el campo es aditivo.
- **Sin avisos fuera de la aplicación** (ni correo ni WhatsApp al dueño): la fecha la
  pone él mismo; lo que necesita es no enterarse por sorpresa, y para eso está «por
  vencer».
- **El umbral de «por vencer» (14 días) es del producto**, no configurable.
- **Sin caducidad recurrente** («vence cada mes»): renovar es un acto del dueño.
- **Sin bandera de despliegue**: no es un módulo opcional ni hay terceros; sin fechas,
  el conocimiento se comporta igual que hoy. Lo que sí cambia en todas las instancias es
  que el agente sabe siempre la fecha (US2), y es deliberado.

## Decisiones tomadas (2026-10-07)

| # | Pregunta | Decisión del dueño |
|---|---|---|
| Q1 | ¿«Vigente desde» además de «hasta»? | **No.** Solo «vigente hasta»: el origen es cuando se registra la entrada (como Kosmo). |
| Q2 | Al vencer, ¿se oculta o se le pasa al modelo marcada como vencida? | **Se oculta**: el modelo no recibe ninguna señal de que existió. |
| Q3 | ¿Días u hora exacta? | **Días.** |
| Q4 | ¿Zona horaria sin agenda? | **México** para todos por ahora; con agenda, la de la agenda (México por defecto). |
