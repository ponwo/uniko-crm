# Feature Specification: Conexión de Google Calendar por link (modelo agencia)

**Feature Branch**: `029-google-por-link`

**Created**: 2026-09-27

**Status**: Draft

**Carril (Principio VI)**: **ciclo completo** (`specify → plan → tasks → implement`).
Toca los dos criterios: el **modelo de datos** (un registro de links de conexión,
tabla nueva y solo aditiva — Principio X: ensayo antes de `main`) y un **contrato
publicado** que consume otro repositorio: la forma del link, del parámetro de
retorno y de las rutas de la instancia que usa la página de LanCo en `lanco.cloud`
(repo `lanco-ws`). Además requiere **ADR-004** y la **enmienda 1.8.0 del Principio
II.3.4** ("jamás credenciales de una plataforma central"), que esta feature
propone por escrito y que el dueño ratifica al aprobarla.

**Input**: Decisiones del dueño. El 2026-09-23, al conectar la agenda de LanCo por el
camino manual: *"el onboarding de Meta lo hacemos a través de nuestro sitio web, en
lanco.cloud; esto nos permite tener una sola app modo agencia para Meta — ¿podríamos
hacer lo mismo para Google, de tal manera que manualmente YO comparta el link del
onboarding?"*. Se acordó entonces **un proyecto de Google de LanCo con un cliente
OAuth por negocio** y `lanco.cloud` como único retorno registrado. El 2026-09-27, ante
la pregunta de cómo llega el permiso a la instancia: (1) **llega solo** — la instancia
canjea el permiso ella misma; nada de n8n ni de copiar tokens; (2) se **reutiliza el
proyecto `agendamiento-lanco`**; (3) la app se llama **«LanCo Agenda»** en la pantalla
de permisos de Google; (4) la **verificación de Google se prepara ya** y se envía
cuando el flujo funcione (el video de demostración lo exige).

## Contexto de negocio

Conectar Google Calendar hoy exige que el negocio cree su propio proyecto en Google
Cloud, active la API de Calendar, configure la pantalla de consentimiento, cree un
cliente OAuth y saque un refresh token con OAuth Playground: unos veinte minutos de
consola técnica, con dos trampas documentadas (la app en "modo prueba" caduca a los
7 días; el permiso de eventos no autoriza leer el calendario). LanCo lo hizo para sí
mismo el 2026-09-23. **Ningún cliente de la flota puede hacerlo solo** — y la agenda
con Meet es justo el diferencial que se les quiere ofrecer.

Con Meta, LanCo resolvió el mismo problema con una app de agencia y un link de alta en
`lanco.cloud`. Google tiene una diferencia que decide el diseño: **la instancia
necesita el secreto de la app en cada renovación del acceso**, no solo al darse de
alta. De ahí salen las tres piezas:

- **Un cliente OAuth por negocio**, todos dentro del proyecto de LanCo. Una fuga en
  una instancia compromete a un negocio, no a la flota; rotar o dar de baja toca una
  instancia, no tres. La marca, la verificación y el dominio autorizado son del
  proyecto: se hacen **una vez para todos**.
- **`lanco.cloud` como único retorno registrado.** Así ningún dominio de cliente
  (`uniko.ilovetheuniverse.mx`, `uniko.nuriaandrea.com`, …) tiene que registrarse ni
  verificarse en el proyecto de LanCo — ese era el trabajo real del modelo central.
- **La instancia canjea el permiso ella misma.** `lanco.cloud` solo reenvía la
  respuesta de Google a la instancia que empezó el flujo: no guarda nada, no conoce
  secretos y no participa después. Si `lanco.cloud` cae, las conexiones hechas siguen
  funcionando; solo se detienen las altas nuevas.

El camino manual actual (la app propia del negocio) **no cambia** y sigue siendo el
único disponible en una instancia sin la app de agencia configurada.

## Actores

- **Operador**: el equipo de LanCo, con rol **dueño** en la cuenta de Uniko del
  negocio. Genera el link y se lo manda al titular por su canal habitual.
- **Titular del calendario**: la persona cuya cuenta de Google recibirá las citas. No
  necesita cuenta en Uniko ni conocimientos técnicos.
- **Página de LanCo** (`lanco.cloud`): aterrizaje con la marca de LanCo que explica lo
  que se va a autorizar, y relevo que devuelve la respuesta de Google a la instancia.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El titular conecta su calendario con un link (Priority: P1)

El operador abre *Ajustes → Agenda*, elige Google Calendar y pulsa **Generar link**.
Copia el link y se lo manda al titular por WhatsApp. El titular lo abre en su
teléfono o computadora, lee en la página de LanCo qué va a autorizar, pulsa
**Continuar con Google**, elige su cuenta, acepta el permiso de «LanCo Agenda» y
aterriza en una página de su CRM que le dice que el calendario quedó conectado y
cuál. Desde ese momento, cada cita que se agenda crea su evento con enlace de Meet en
ese calendario, exactamente como con la conexión manual.

**Why this priority**: es la feature. Sin esto, ningún cliente de la flota puede usar
la agenda con Google.

**Independent Test**: con la instancia configurada contra el Google de pruebas,
generar un link como dueño, recorrerlo sin sesión hasta el final, y comprobar que la
conexión quedó guardada, que "Probar" pasa y que una cita crea su evento.

**Acceptance Scenarios**:

1. **Given** la agenda encendida y la app de agencia configurada, **When** el dueño
   pulsa *Generar link*, **Then** recibe un link que la pantalla describe como de un
   solo uso y con vencimiento a las 72 horas, con un botón para copiarlo.
2. **Given** un link vigente, **When** el titular lo recorre sin sesión en Uniko y
   autoriza en Google, **Then** la instancia guarda la conexión cifrada, verifica que
   funciona contra Google y le muestra al titular "conectado" con el nombre del
   calendario.
3. **Given** la conexión hecha por link, **When** se agenda una cita, **Then** se crea
   el evento con su enlace de Meet en el calendario del titular.
4. **Given** la conexión hecha por link, **When** el operador abre *Ajustes → Agenda*,
   **Then** ve Google conectado y seleccionado como forma de entregar la reunión, y
   ningún secreto ni token (solo los últimos 4 del secreto, como hoy).
5. **Given** un link ya usado con éxito, **When** alguien lo abre otra vez — aunque
   después se haya desconectado Google —, **Then** ve que ya se usó y nada cambia.

---

### User Story 2 - Si algo sale mal, nada se rompe y el titular sabe qué hacer (Priority: P1)

El titular cancela en Google, o desmarca la casilla del calendario, o abre un link
vencido, o termina el flujo en otro navegador, o Google no responde. En todos los
casos aterriza en una página que dice **qué pasó y qué hacer**, y **ninguna conexión
existente se toca**: las citas se siguen agendando como antes.

**Why this priority**: el titular es alguien sin contexto técnico, frente a pantallas
de Google que no controlamos. Un callejón sin salida en ese punto es un cliente que
no se conecta — o peor, una conexión a medias que parece buena.

**Independent Test**: provocar cada camino infeliz contra el Google de pruebas y
comprobar el mensaje y que la conexión previa sigue intacta.

**Acceptance Scenarios**:

1. **Given** un link vigente, **When** el titular cancela en Google, **Then** ve
   "cancelaste la autorización" y el mismo link sigue sirviendo para reintentar.
2. **Given** un link vigente, **When** el titular desmarca el permiso de calendario en
   la pantalla de Google, **Then** ve que falta ese permiso y cómo darlo, y no se
   guarda nada.
3. **Given** un link de hace más de 72 horas, **When** se abre, **Then** dice que
   venció y que hay que pedir uno nuevo.
4. **Given** un flujo empezado en un navegador, **When** la respuesta de Google llega a
   otro navegador o después de 15 minutos, **Then** pide volver a abrir el link y
   terminar en el mismo navegador, sin guardar nada.
5. **Given** Google no responde o rechaza el canje, **When** vuelve la respuesta,
   **Then** el titular ve que reintente en unos minutos y la conexión previa (si la
   había) sigue funcionando.
6. **Given** un link manipulado o inventado, **When** se abre, **Then** dice que no es
   válido, sin revelar nada de la instancia.

---

### User Story 3 - El operador controla sus links (Priority: P2)

El operador ve si hay un link pendiente y cuándo vence, puede **revocarlo**, y al
generar uno nuevo el anterior deja de servir. Si mandó el link a quien no era, lo
revoca antes de que se use.

**Why this priority**: el link es una llave: quien lo tenga puede conectar SU
calendario y recibir ahí las citas del negocio (nombres, teléfonos, notas). Tiene que
poder cerrarse.

**Independent Test**: generar, revocar y regenerar; comprobar que solo el último link
sin revocar funciona.

**Acceptance Scenarios**:

1. **Given** un link pendiente, **When** el dueño genera otro, **Then** el primero deja
   de servir y la pantalla muestra solo el pendiente nuevo.
2. **Given** un link pendiente, **When** el dueño lo revoca, **Then** abrirlo dice que
   ya no es válido.
3. **Given** un miembro que no es dueño, **When** intenta generar o revocar un link,
   **Then** se le niega, con un mensaje claro.
4. **Given** un link recién generado, **When** el operador vuelve a la pantalla más
   tarde, **Then** ve que hay un link pendiente y su vencimiento, pero no el link en
   sí (se muestra una sola vez, como un secreto).

---

### User Story 4 - `lanco.cloud` reenvía sin guardar nada (Priority: P2)

La página de LanCo recibe la respuesta de Google y la devuelve a la instancia que
empezó el flujo, **solo si esa instancia es de la flota**. No guarda nada, no conoce
ningún secreto, y su caída no afecta a ninguna conexión ya hecha.

**Why this priority**: es la pieza que evita registrar cada dominio de cliente en
Google. Y es la que la enmienda del Principio II acota: participa en el alta, nunca
en la operación.

**Independent Test**: con el relevo de pruebas, comprobar que reenvía a una instancia
permitida y se niega a reenviar a cualquier otro sitio; con `lanco.cloud` fuera,
comprobar que una instancia conectada sigue creando eventos.

**Acceptance Scenarios**:

1. **Given** una respuesta de Google cuyo retorno es una instancia de la flota,
   **When** llega a `lanco.cloud`, **Then** el navegador sigue a esa instancia con la
   respuesta completa.
2. **Given** una respuesta cuyo retorno no es de la flota (o no es seguro), **When**
   llega, **Then** la página se niega y no redirige a ninguna parte.
3. **Given** un link cuya instancia no es de la flota, **When** se abre la página de
   aterrizaje, **Then** tampoco ofrece continuar.
4. **Given** una instancia ya conectada y `lanco.cloud` fuera de servicio, **When** se
   agenda una cita, **Then** el evento se crea igual.

---

### User Story 5 - Una instancia sin la app de agencia no cambia (Priority: P2)

Sin la configuración de la app de agencia —el estado por defecto—, la tarjeta de
Google es exactamente la de hoy (los tres datos a mano), las superficies del link no
existen y nada menciona el link. Con la app configurada, el camino manual **sigue
disponible** para quien prefiera su propia app.

**Why this priority**: es la mitad del contrato de todo módulo opcional (Principio II,
condición 1) y la que toda instancia normal usa.

**Independent Test**: la CI en su configuración "todo apagado" y el arnés con la
agenda encendida pero sin la app de agencia.

**Acceptance Scenarios**:

1. **Given** la agenda encendida sin la app de agencia, **When** se abre la tarjeta de
   Google, **Then** es la de hoy y las rutas del link responden 404.
2. **Given** la app de agencia configurada, **When** el operador prefiere pegar las
   credenciales de una app propia, **Then** puede hacerlo como hoy.
3. **Given** la agenda apagada, **When** se llama a cualquier superficie del link,
   **Then** responde 404, aunque la app de agencia esté configurada.

---

### User Story 6 - Un self-hoster usa el mismo link con su propia app, sin relevo (Priority: P3)

Quien opera su propia instancia fuera de LanCo registra su propia app de Google con el
retorno apuntando directo a su instancia. El link funciona igual, sin página de
aterrizaje ni relevo.

**Why this priority**: es el mismo código con otra configuración, y convierte la
mejora futura que dejó la 015 (research D6: "un botón Conectar con Google con
redirect") en realidad también para el modo BYO.

**Independent Test**: configurar el retorno directo a la instancia y recorrer el link.

**Acceptance Scenarios**:

1. **Given** el retorno configurado hacia la propia instancia y sin página de
   aterrizaje, **When** el dueño genera un link, **Then** el link lleva directo a la
   instancia y el flujo termina conectado sin pasar por `lanco.cloud`.

### Edge Cases

- **El titular autoriza con la cuenta equivocada.** La página de confirmación muestra
  el nombre del calendario conectado (en el calendario principal, el correo de la
  cuenta), y el operador lo ve al pulsar *Probar*. Arreglarlo es desconectar y mandar
  un link nuevo.
- **Link abierto dentro de una app** (el navegador interno de Instagram, Facebook o
  similares): Google bloquea ahí la autorización. La página de aterrizaje lo detecta,
  pide abrir el link en el navegador del teléfono y ofrece copiarlo.
- **Cuenta de empresa (Workspace) con apps externas bloqueadas por su
  administrador**: Google no autoriza. El titular ve que Google no permitió la
  conexión y que puede deberse a una política de su empresa; no se guarda nada.
- **Google no devuelve permiso de larga duración**: se trata como fallo del canje y no
  se guarda una conexión que dejaría de funcionar en una hora.
- **Se generan dos links y se usa el segundo**: el primero ya había quedado revocado
  al generar el segundo.
- **Se usa un link, se desconecta Google y alguien reabre ese mismo link**: sigue
  usado. Desconectar no revive links.
- **Dos pestañas con el mismo link terminan casi a la vez**: solo una conexión se
  guarda; la otra ve que el link ya se usó.
- **La conexión de Google se rompe después** (el titular revoca el acceso desde su
  cuenta, o se rota el secreto del cliente OAuth): el comportamiento de hoy —la
  conexión se marca rota, las citas siguen con el enlace pendiente— y el operador
  manda un link nuevo.
- **El operador cambia la configuración de la app de agencia** (otro cliente OAuth):
  las conexiones hechas con el cliente anterior dejan de renovarse y se marcan rotas
  en el primer uso; se reconecta con un link nuevo.
- **La app de agencia sin verificar**: Google muestra al titular el aviso "Google no
  ha verificado esta app". La página de aterrizaje lo anticipa y explica cómo seguir
  (*Avanzado → Ir a LanCo Agenda*), mientras dure la verificación.
- **La instancia estaba usando Zoom o el enlace fijo**: al conectar Google por link,
  la forma de entregar la reunión pasa a Google Calendar. El link se genera desde la
  tarjeta de Google: la intención es inequívoca, y una conexión de Google que deja la
  agenda en "enlace fijo" fue exactamente la trampa encontrada el 2026-09-23.
- **Paso del tiempo**: el vencimiento del link (72 h) y de la ida y vuelta con Google
  (15 min) se deciden en código contra un reloj inyectable, para que una prueba pueda
  leer un link "de hace tres días" sin esperar tres días.

## Requirements *(mandatory)*

### Functional Requirements

**Configuración y alcance**

- **FR-1401**: La conexión por link MUST existir solo si la instancia tiene la agenda
  encendida **y** la app de agencia configurada (identificador del cliente OAuth,
  secreto y dirección de retorno registrada). Sin ambas, sus superficies responden
  404, la pantalla no la menciona y la tarjeta de Google es la de hoy.
- **FR-1402**: Con la agenda encendida, una configuración a medias de la app de
  agencia (uno o dos de los tres valores) MUST impedir el arranque de la instancia con
  un mensaje que nombra el valor que falta — el mismo trato que el conector de
  inventario.
- **FR-1403**: El secreto del cliente OAuth MUST NOT llegar nunca al navegador ni a los
  logs; hacia fuera solo sus últimos 4, como en la conexión manual.
- **FR-1404**: El camino manual (credenciales de una app propia) MUST seguir disponible
  y sin cambios de comportamiento, con o sin la app de agencia configurada.

**El link**

- **FR-1405**: Solo un miembro con rol **dueño** MUST poder generar o revocar un link.
- **FR-1406**: Un link MUST ser de un solo uso y vencer a las 72 horas de generado; la
  pantalla lo MUST decir junto al link.
- **FR-1407**: Generar un link MUST revocar cualquier link pendiente de la misma
  organización: en todo momento hay a lo sumo un link vigente.
- **FR-1408**: El link completo MUST mostrarse una sola vez, al generarlo. Después, la
  pantalla muestra que hay un link pendiente y su vencimiento, nunca el link. La
  instancia MUST guardar solo una huella del link, no el link.
- **FR-1409**: Un link usado con éxito o revocado MUST NOT volver a servir, pase lo que
  pase después con la conexión de Google (desconectar incluido).
- **FR-1410**: Cuando la instancia tiene configurada una página de aterrizaje, el link
  MUST llevar a esa página con la dirección de la instancia y la llave del link; si no
  la tiene, el link MUST llevar directo a la instancia.

**El recorrido del titular**

- **FR-1411**: Recorrer el link MUST NOT requerir sesión en Uniko.
- **FR-1412**: Al abrir el link, la instancia MUST validarlo (existe, es de esta
  organización, no está usado, revocado ni vencido) antes de mandar al titular a
  Google; si no es válido, lo manda a la página de resultado con el motivo.
- **FR-1413**: La autorización MUST pedir a Google únicamente el permiso de eventos de
  calendario, con acceso de larga duración y pidiendo siempre el consentimiento (para
  que Google entregue el permiso de larga duración también a quien ya había
  autorizado antes).
- **FR-1414**: La ida y vuelta con Google MUST quedar atada al navegador que la empezó y
  vencer a los 15 minutos; una respuesta que llega a otro navegador o tarde MUST
  rechazarse sin guardar nada.
- **FR-1415**: La respuesta de Google MUST llevar la dirección de la instancia de forma
  que el relevo pueda leerla sin conocer ningún secreto, y firmada de forma que la
  instancia detecte cualquier manipulación.
- **FR-1416**: Al recibir la respuesta, la instancia MUST canjearla ella misma ante
  Google, comprobar que el permiso concedido incluye el de eventos de calendario y que
  vino el permiso de larga duración, **probar la conexión** contra el calendario, y
  solo entonces guardarla cifrada y marcar el link como usado — todo o nada.
- **FR-1417**: Si la instancia ya tenía una conexión de Google, un intento fallido MUST
  NOT alterarla; uno exitoso la reemplaza conservando el calendario destino que
  tuviera configurado (o el principal si no había).
- **FR-1418**: Tras conectar por link, la forma de entregar la reunión MUST quedar en
  Google Calendar.
- **FR-1419**: Dos respuestas exitosas del mismo link MUST resultar en una sola conexión
  guardada; la segunda termina como "link ya usado".
- **FR-1420**: La página de resultado MUST decir en lenguaje llano qué pasó y qué hacer,
  para cada motivo: conectado (con el nombre del calendario), link no válido, vencido,
  ya usado, autorización cancelada, permiso incompleto, otro navegador o tiempo
  agotado, Google no respondió, bloqueado por la política de la empresa (cuentas de
  Workspace), Google no autorizó por otro motivo, y prueba fallida. La página MUST
  NOT reflejar texto arbitrario venido de la dirección.
- **FR-1421**: Ningún dato personal (correo, nombre del calendario) MUST viajar en la
  dirección de ninguna página del recorrido.

**El operador**

- **FR-1422**: La tarjeta de Google MUST mostrar, cuando la app de agencia está
  configurada, la sección del link por encima de la conexión manual, con: generar,
  copiar, vencimiento, estado de link pendiente y revocar.
- **FR-1423**: *Probar* MUST mostrar el nombre del calendario conectado junto a
  "conexión correcta", en los dos caminos.

**`lanco.cloud` (repo `lanco-ws`)**

- **FR-1424**: El relevo MUST reenviar la respuesta de Google completa a la instancia
  indicada en ella solo si esa instancia está en la lista de la flota y usa conexión
  segura; en cualquier otro caso MUST negarse sin redirigir.
- **FR-1425**: La página de aterrizaje MUST explicar qué se autoriza (crear y mover
  eventos de las citas en su calendario, nada más), anticipar el aviso de app sin
  verificar mientras dure, nombrar al negocio según la lista de la flota (nunca según
  la dirección) y ofrecer continuar solo si la instancia es de la flota.
- **FR-1426**: La página de aterrizaje MUST detectar navegadores internos de apps y
  pedir abrir el link en el navegador del teléfono, con opción de copiarlo.
- **FR-1427**: `lanco.cloud` MUST NOT guardar, registrar a propósito ni enviar a ningún
  tercero el link, la llave, la respuesta de Google ni ningún dato del recorrido.
- **FR-1428**: La política de privacidad de `lanco.cloud` MUST declarar el uso de datos
  de Google de «LanCo Agenda» conforme a la política de datos de usuario de las APIs de
  Google (incluido el uso limitado), y el sitio MUST tener una página de la app que la
  describa — requisitos de la verificación de Google.

### Key Entities *(include if feature involves data)*

- **Link de conexión**: pertenece a una organización; lo genera un dueño (quién y
  cuándo); tiene vencimiento; termina **usado** o **revocado** o **vencido**. La
  instancia guarda solo su huella. Nunca se reactiva.
- **Conexión de Google** (existente): la misma de la 015 — identificador del cliente,
  secreto y permiso de larga duración cifrados, calendario destino, estado. Esta
  feature solo cambia **cómo llega** el permiso, no qué se guarda ni cómo se usa.
- **App de agencia** (configuración de la instancia, no dato): identificador y secreto
  del cliente OAuth de ESE negocio dentro del proyecto de LanCo, dirección de retorno
  registrada y, opcional, la página de aterrizaje.
- **Lista de la flota** (en `lanco.cloud`): instancias a las que el relevo y el
  aterrizaje aceptan llevar, con el nombre del negocio de cada una.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un titular sin conocimientos técnicos completa la conexión en menos de 3
  minutos desde que abre el link (hoy: ~20 minutos de consola de Google y un proyecto
  propio).
- **SC-002**: Ningún token ni secreto pasa por manos humanas, chat, correo ni por
  sistemas distintos de Google y la instancia del negocio: verificable recorriendo el
  flujo y revisando qué guarda cada pieza.
- **SC-003**: El 100% de los caminos infelices terminan en una página que explica qué
  pasó y qué hacer — nunca una página en blanco ni un error del servidor — y en
  ninguno se altera una conexión existente.
- **SC-004**: Con `lanco.cloud` fuera de servicio, las instancias ya conectadas siguen
  creando sus eventos con Meet sin diferencia.
- **SC-005**: Una instancia sin la app de agencia se comporta como antes de esta
  feature: superficies en 404, tarjeta de Google idéntica, camino manual intacto (CI en
  las dos configuraciones).
- **SC-006**: Dar de alta a un negocio nuevo le toma al operador menos de 10 minutos
  (crear su cliente OAuth, configurar la instancia, añadirla a la lista de la flota y
  generar el link), siguiendo la guía.

## Assumptions

- El proyecto `agendamiento-lanco` sigue publicado **en producción** (no en prueba),
  con la app renombrada a «LanCo Agenda» y `lanco.cloud` como dominio autorizado. Hasta
  que Google la verifique, los titulares verán el aviso de app sin verificar; con el
  tamaño de la flota, el tope de usuarios de una app sin verificar no aplica en la
  práctica.
- Los clientes OAuth se crean a mano en la consola de Google: no hay una API pública
  para crearlos. La guía de alta lo documenta paso a paso.
- Cada instancia es de un solo negocio, así que la configuración de la instancia **es**
  la configuración del negocio (Constitución: "una instancia = un negocio").
- El operador tiene rol dueño en la cuenta de Uniko de cada negocio que da de alta.
- `lanco.cloud` se sirve por conexión segura, como hoy.
- El permiso sigue siendo solo el de eventos de calendario (el mínimo de la 015); no se
  pide correo ni perfil. El nombre del calendario principal sirve para identificar la
  cuenta.
- El envío del link al titular lo hace el operador por su canal (WhatsApp, correo): la
  instancia no manda mensajes por esto.

## Qué NO hace esta feature, y por qué

- **No pasa por n8n ni por ningún almacén central.** Era la opción "como Meta": dejaba
  el permiso de cada cliente en un sistema de LanCo y en el portapapeles de una
  persona. Descartada por el dueño el 2026-09-27.
- **No usa un intermediario en la operación** ("broker": pedirle el acceso a
  `lanco.cloud` en cada cita). Quitaría el secreto de las instancias, pero metería una
  dependencia central en el camino de cada cita: si `lanco.cloud` cae, nadie genera
  enlaces. Eso sí rompe la promesa del Principio II.
- **No comparte un solo cliente OAuth entre negocios.** Su secreto viviría en todas las
  instancias: una fuga compromete a todos y rotarlo es tocar la flota entera.
- **No crea clientes OAuth solo**: Google no ofrece API para eso.
- **No elige calendario en el recorrido del titular**: conecta el principal (o el que
  la instancia ya tuviera configurado). Cambiar de calendario sigue siendo cosa del
  camino manual.
- **No verifica la app ante Google**: es un trámite manual del dueño en la consola.
  Esta feature entrega lo que la verificación pide (página de la app, cláusula de
  privacidad) y la guía para hacerla.
- **No lee disponibilidad del calendario** (sin cambios respecto a la 015 y ADR-002).
- **No cambia el alta de WhatsApp** en `lanco.cloud`.
