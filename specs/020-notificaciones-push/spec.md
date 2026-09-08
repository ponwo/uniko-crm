# 020 — Notificaciones push cuando el agente escala

**Feature Branch**: `020-notificaciones-push`

**Created**: 2026-09-07

**Status**: Draft

**Carril**: ciclo completo, y esta vez por los dos motivos a la vez. **Toca el
modelo de datos** —hay migración: las suscripciones de cada usuario y las claves
de la instancia— y **mete un tercero en runtime**, que entra como conector
opcional según el [ADR-003](../../docs/adr-003-notificaciones-push.md).

> **Aviso del Principio X**: al haber migración, promover esta feature exigirá el
> **ensayo contra un Postgres desechable con un respaldo real restaurado**, antes
> de `main`. No es opcional y no lo cubre `pnpm seed:demo`. Es la primera feature
> desde la 016 que activa esa condición de la puerta de promoción.

**Escrito antes del código.**

## Problema

El agente atiende solo, hasta que no puede. Cuando escala —el cliente lo pide,
el modelo se atasca, la ventana de 24 horas se cierra, algo falla— **la
conversación se queda esperando a una persona**, y hoy esa persona solo se entera
si tiene la app delante.

Fuera de la app no pasa nada. Ni un sonido, ni un aviso, ni una señal. La
escalación se ve en la bandeja, en vivo y sin recargar —eso lo arregló la 018—
pero solo para quien está mirando. Un cliente que pidió hablar con un humano a
las nueve de la noche espera hasta que alguien abra el CRM.

Es el único momento del producto en que **el sistema necesita algo de una
persona concreta**. Todo lo demás puede esperar a que alguien mire.

La 019 dejó la app instalada en la pantalla de inicio, que es exactamente el
requisito que faltaba: en iOS el Push API **solo existe** si la app está
instalada en standalone.

## Lo que ya está decidido, y por qué

Estas decisiones vienen tomadas y aquí quedan escritas con su razón, para que no
se reabran a mitad del plan.

### Se avisa SOLO cuando el agente escala a un humano

No en cada mensaje entrante. La razón no es el volumen, es lo que le pasa al
operador: **una notificación por mensaje se vuelve ruido en una semana**, y una
notificación que se ignora es peor que no tenerla, porque entrena a la persona a
descartarlas — incluida la que sí importaba.

Y hay un motivo más limpio: la escalación es **el único momento en que el aviso
pide algo del humano**. Un mensaje que el agente atiende no requiere a nadie.

### A quién: a todo el equipo con la app instalada y permiso dado

Por ahora sin filtros: quien tenga la app instalada y haya activado los avisos,
los recibe. Pero la suscripción se guarda **por usuario, no por instancia**, para
que el día que haga falta "avisar solo a estos" sea añadir un filtro y no
rehacer el modelo.

### Si nadie atiende, no pasa nada

Sin reintentos, sin escalar a otra persona, sin alertas por no atender, sin
recordatorios. Está en "Fuera de alcance" con su razón, porque **cada una de esas
suena razonable por separado y todas juntas son otro producto**.

### El aviso viaja OPACO: no lleva contenido

El transporte de Web Push pasa por servidores de Google (FCM) o de Apple (APNs).
No es una preferencia: el navegador elige el servidor de entrega y no hay versión
propia (ADR-003).

Por eso el aviso que sale de la instancia **no lleva nada dentro**: ni el nombre
del cliente, ni el mensaje, ni el motivo. Solo "hay algo". El detalle lo pide la
app al servidor de su propia instancia, y ahí se decide qué se muestra.

**La razón de fondo no es el ahorro de código.** Uniko es una instancia por
negocio precisamente para que los datos de un cliente no salgan de ahí. Un aviso
con contenido haría pasar el nombre o el mensaje de **un cliente de nuestro
cliente** por servidores de Google o de Apple, para llegar a un teléfono que está
a diez metros del servidor. Que el push sea opaco es coherencia con el Principio
I, no una optimización.

El ahorro viene de regalo: se guarda menos de cada dispositivo, y no hay que
escribir un cifrado propio cuyo fallo sería silencioso.

### Las claves las genera la instancia al encender la bandera

Nadie tiene que pegar un secreto en ningún panel. La instancia genera su par de
claves la primera vez que hace falta y guarda la privada **cifrada en reposo**,
por el mismo camino que ya protege el token de WhatsApp.

## Escenarios

1. **La escalación llega al teléfono**: el agente pasa una conversación a un
   humano a las nueve de la noche. La operadora tiene la app instalada y los
   avisos activados. Le llega una notificación; la toca y **se abre esa
   conversación**, no la bandeja genérica.
2. **Activar los avisos**: la operadora abre la app instalada, ve una opción para
   activar los avisos, la pulsa, el sistema le pide permiso y ella acepta. A
   partir de ahí ese teléfono recibe.
3. **Sin red en el momento justo**: llega el aviso mientras el teléfono está sin
   datos. La app no puede preguntar de quién es, así que muestra un texto que
   **sirve igual**: algo necesita atención, ábrela para ver qué.
4. **La instancia que no los quiere**: una instancia con la bandera apagada no
   menciona los avisos por ningún lado. Nadie ve un botón que no lleva a nada.
5. **El Laboratorio no despierta a nadie**: una conversación de prueba escala
   dentro del Laboratorio. **No sale ninguna notificación**, igual que no sale
   ningún mensaje de WhatsApp ni ninguna cita real.
6. **El teléfono que ya no está**: un operador desinstala la app o borra los
   datos del sitio. Su suscripción queda muerta; el sistema se entera al primer
   intento y la olvida, sin que nadie tenga que limpiar nada.

## Requisitos

### Cuándo se avisa

- **FR-501** El sistema DEBE enviar un aviso cuando —y solo cuando— una
  conversación pasa a manos de un humano por escalación del agente.
- **FR-502** NO DEBE avisar por mensajes entrantes que el agente atiende, ni por
  cambios de etapa, ni por ningún otro evento.
- **FR-503** Una escalación de una conversación **de prueba** (Laboratorio) NO
  DEBE producir ningún aviso real.
- **FR-504** El fallo del envío NO DEBE impedir ni retrasar la escalación: la
  conversación queda escalada aunque el aviso no salga.

### Qué lleva el aviso, y qué no

- **FR-505** El aviso que sale de la instancia hacia el servicio de entrega **NO
  DEBE contener ningún dato del negocio ni de sus clientes**: ni nombres, ni
  texto de mensajes, ni motivo de la escalación, ni identificadores que permitan
  deducirlos.
- **FR-506** El detalle que se muestra en el teléfono DEBE obtenerse de la propia
  instancia, no del aviso.
- **FR-507** Si ese detalle no se puede obtener —sin red, sesión caducada—, la
  notificación DEBE mostrarse igualmente con un texto que sirva sin decir de
  quién es, y que no parezca un error.
- **FR-508** Al tocar la notificación, la app DEBE abrirse **en la conversación
  escalada**, no en una bandeja genérica donde haya que buscarla.
- **FR-508b** Cuando el aviso no pudo saber de quién era, tocar la notificación
  DEBE llevar a la bandeja, donde la escalación está arriba y marcada. **NO DEBE
  parecer que la app perdió información**: no se muestra un error, ni una
  pantalla vacía, ni un "no se pudo cargar". El operador llega a un sitio donde
  puede resolver lo que le acaban de avisar.
- **FR-508c** Si ya hay una ventana de la app abierta, tocar la notificación
  DEBE llevarla a esa conversación en vez de abrir una segunda: abrir otra
  pestaña es la forma más rápida de que el operador pierda lo que tenía a
  medias.
- **FR-507b** Los textos de la notificación —el normal y el degradado— DEBEN
  estar escritos **para la vigésima vez, no para la primera**. Mismo criterio
  que FR-423 de la 019: **NO DEBEN** explicar qué es la app ni cómo funciona el
  agente ("el agente ha derivado la conversación"), porque a la vigésima eso es
  ruido. Dicen **a qué entra** el operador y **qué hacer**.

### Quién los recibe, y cómo se activan

- **FR-509** Los avisos DEBEN activarse con una **acción explícita** del
  operador, nunca automáticamente al entrar.
- **FR-510** La activación DEBE poder deshacerse desde la app.
- **FR-511** La suscripción DEBE guardarse **por usuario y por dispositivo**, no
  por instancia.
- **FR-512** Mientras no exista filtro, DEBEN recibir el aviso todos los usuarios
  del equipo con suscripción viva.
- **FR-513** La app DEBE explicar por qué no se pueden activar cuando no se
  puede: sin la app instalada en la pantalla de inicio, en iOS no hay avisos
  posibles.
- **FR-514** Una suscripción que el servicio de entrega declare **caducada** DEBE
  eliminarse sola, sin intervención de nadie.

### Las claves de la instancia

- **FR-515** La instancia DEBE generar su propio par de claves la primera vez que
  las necesite, sin pedirle nada a nadie.
- **FR-516** La clave privada DEBE guardarse **cifrada en reposo** y no DEBE
  salir nunca del servidor: ni al cliente, ni a los logs, ni a una respuesta de
  API.
- **FR-517** Si las claves se regeneran, **todas las suscripciones existentes
  dejan de valer**: los teléfonos ya suscritos dejan de recibir hasta que sus
  operadores vuelvan a activar los avisos. La app DEBE dejar esto **escrito donde
  se rota**, no en la documentación.

  > Es exactamente la clase de cosa que alguien hace un día creyendo que es
  > higiene y deja al equipo sin avisos sin saber por qué. Por eso es un
  > requisito y no una nota.

### La bandera, y qué pasa sin ella

- **FR-518** Con la bandera apagada, la instancia NO DEBE mencionar los avisos en
  ningún sitio: sin opción de activarlos, sin permisos pedidos, sin claves
  generadas, y sus superficies responden **404**.
- **FR-519** Con la bandera apagada, el service worker NO DEBE registrar ningún
  manejador de push.
- **FR-520** La migración DEBE aplicarse igual en toda la flota, esté la bandera
  encendida o no.

### No romper la 019 ni la 018

- **FR-521** El manejador de push NO DEBE alterar la exclusión estructural del
  canal de eventos: `/api/events` sigue sin pasar por el service worker.
- **FR-522** Esa garantía DEBE seguir comprobándose con **las dos mitades en la
  misma corrida**, como la dejó la 019.
- **FR-523** El service worker DEBE seguir sin cachear nada.

## Decisión: una conversación, un aviso — y por qué NO hace falta agrupar

La preocupación era razonable: si el mismo cliente escala tres veces en cinco
minutos, tres notificaciones al mismo sitio son ruido.

**El código ya lo impide, y conviene que quede escrito para que nadie construya
una solución a un problema que no existe.** El pipeline del agente arranca con
una condición de silencio: si la conversación tiene handoff activo, **no hay
turno**. Y sin turno no hay segunda escalación. Una conversación escalada no se
vuelve a escalar hasta que una persona la devuelva al agente.

Por tanto:

- **No se construye lógica de agrupación, ni ventanas de tiempo, ni contadores.**
- Se marca cada aviso con la conversación a la que pertenece, porque es gratis y
  hace que el sistema operativo **reemplace** el anterior donde eso funciona.
- El caso repetido —alguien reactiva el agente y la conversación se vuelve a
  escalar— es legítimo y raro, y dos avisos ahí son correctos.

**Y no se da por bueno en todas partes**: hay constancia documentada de que iOS
**ignora** esa marca y apila las notificaciones en vez de reemplazarlas
(research R4). No está confirmado que siga así en las versiones actuales. **La
spec funciona en los dos casos** —el reemplazo es una mejora, no un requisito— y
el nivel 3 lo comprueba y lo registra.

## Decisión: el Laboratorio no despierta a nadie

Las conversaciones de prueba pasan por el mismo pipeline que las reales, así que
**escalan igual**. Sin una regla explícita, evaluar el agente un martes por la
tarde llenaría de notificaciones los teléfonos del equipo.

Es el mismo guardarraíl que ya protege el envío de WhatsApp y la agenda: **una
conversación de prueba jamás toca el mundo real**. Aquí tiene criterio propio
(FR-503, SC-006) y no es un detalle de implementación.

## Constitution Check

- **Soberanía (II)**: entra como **conector opcional** con las cinco condiciones
  mapeadas en el [ADR-003](../../docs/adr-003-notificaciones-push.md). Apagado
  por defecto, aislado tras adaptador, con camino sin dependencia externa (la
  escalación se sigue viendo en la app), credenciales propias cifradas, y CI que
  lo prueba en las dos configuraciones.
- **Seguridad (I)**: el aviso es opaco — ningún dato de cliente atraviesa a un
  tercero (FR-505). La clave privada se cifra en reposo y nunca sale del
  servidor (FR-516).
- **Multi-tenancy (III)**: las suscripciones llevan `organization_id` NOT NULL y
  toda consulta pasa por `scoped()`.
- **Idempotencia (IV)**: una suscripción se identifica por su endpoint; volver a
  activar los avisos en el mismo teléfono no crea una segunda. Una suscripción
  caducada se borra, y borrarla dos veces da igual.
- **Irreversibilidad (X)**: **hay migración**. El ensayo contra un respaldo real
  restaurado es obligatorio antes de `main`, y la puerta de promoción lo va a
  exigir. El cambio es aditivo: tablas nuevas, nada que borrar.
- **Definición de Hecho (IX)**: tres niveles, con el nivel 3 obligatorio y su
  regla heredada de la 018.

## Verificación

### Nivel 1 — Unidad

La decisión de **a quién se avisa** es una función pura: dada una escalación y un
conjunto de suscripciones, quiénes reciben. Ahí se prueban el caso normal, la
conversación de prueba (nadie), y la instancia sin suscripciones.

También por unidad: que el aviso construido **no contenga** ningún dato del
negocio (FR-505), el texto degradado, y la generación y cifrado de claves.

### Nivel 2 — Local, con el arnés

Con la bandera **apagada**: las superficies responden 404, el service worker no
registra push, y la app no menciona los avisos.

Con la bandera **encendida**, contra un **mock del servicio de entrega**:

- una escalación real produce un envío, y el cuerpo que sale **no lleva datos**;
- una escalación del Laboratorio **no produce ninguno**;
- un endpoint caducado borra la suscripción sola;
- el servicio caído, lento o rechazando **no impide la escalación**;
- y las dos mitades de la 019 siguen verdes: el service worker controla la página
  y **el canal de eventos no pasa por él**.

### Nivel 3 — Dispositivo real (OBLIGATORIO)

Incómodo, y hay que decirlo desde ahora: exige **un teléfono con la app
instalada, el permiso concedido y una escalación real del agente**. No se puede
simular.

Se hereda la regla de la 018 sin cambios: **una corrida en la que la notificación
no llegó NO cuenta como verificación**. O se repite, o se registra explícitamente
como *no reproducida*. Un verde sin notificación recibida es ruido.

Lo que solo el nivel 3 puede responder:

1. ¿Llega con la app **cerrada**, no solo en segundo plano?
2. En **iOS**, ¿el segundo aviso de la misma conversación reemplaza al primero o
   se apilan? (research R4 — sin confirmar en ninguno de los dos sentidos)
3. ¿Al tocarla se abre **esa** conversación?
4. Sin red en ese instante, ¿aparece el texto degradado en vez de nada?

### Gate técnico

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, desde la ruta real.

## Criterios de éxito

- **SC-001** Una escalación real llega al teléfono de un operador que no tenía la
  app abierta, y al tocarla se abre la conversación escalada.
- **SC-002** Ningún dato del negocio ni de sus clientes aparece en lo que la
  instancia entrega al servicio de push. Verificable inspeccionando el envío.
- **SC-003** Con la bandera apagada, la instancia se comporta exactamente como
  antes de esta feature.
- **SC-004** Un fallo del servicio de entrega no cuesta ninguna escalación.
- **SC-005** Un operador activa los avisos desde la app sin ayuda, y puede
  desactivarlos igual.
- **SC-006** Evaluar el agente en el Laboratorio no produce ninguna notificación.
- **SC-007** Una suscripción muerta desaparece sola tras el primer intento.
- **SC-008** Sin red en el momento de recibirlo, el aviso sigue diciendo algo
  útil y no parece roto.
- **SC-009** La corrida del nivel 3 registra explícitamente si la notificación
  llegó. Una en la que no llegó no cuenta.

## Fuera de alcance

- **Avisar de cada mensaje entrante.** Decidido arriba, con su razón.
- **Reintentos si nadie atiende.** No los hay. Un aviso que insiste convierte una
  herramienta de trabajo en una alarma, y la gente apaga las alarmas.
- **Escalar a otra persona si el primero no responde.** Eso es un sistema de
  guardias, y necesita turnos, disponibilidad y reglas que este producto no
  tiene.
- **Alertas por no atender**, informes de tiempo de respuesta o cualquier métrica
  de vigilancia del equipo.
- **Elegir quién recibe qué.** El modelo lo permite (FR-511) pero la interfaz no
  se construye ahora.
- **Notificaciones en el escritorio** fuera de la app instalada.
- **Sonidos, vibraciones o iconos propios por tipo de aviso.** iOS ignora el
  icono y usa el de la app; no se pelea con eso.

## Lo que encontramos en el código

Hallazgos de la lectura previa, que la spec da por ciertos y el plan debe
confirmar:

- **Hay un solo punto de escalación**: `applyHandoff()` en
  `src/server/ai/pipeline.ts`, con cinco llamantes y cuatro motivos (`cliente`,
  `modelo`, `error`, `ventana`). Ahí ya se publica el evento SSE; el aviso es el
  hermano de esa línea.
- **El pipeline calla con handoff activo**, que es lo que hace innecesaria la
  agrupación (decisión de arriba).
- **El Laboratorio usa el mismo pipeline**, de ahí FR-503.
- **Ya existe cifrado en reposo** (`src/lib/crypto`), el mismo que protege el
  token de WhatsApp: las claves no estrenan mecanismo.
- **El service worker se sirve desde una ruta** y lleva el commit dentro, así que
  un despliegue cambia sus bytes y los teléfonos se enteran (019). Sin eso, el
  manejador de push nuevo no llegaría nunca a un worker ya instalado.
- **La exclusión de `/api/events` es estructural** (enrutado estático declarado
  al instalar). Añadir push no la toca, y el arnés lo comprueba.

## Supuestos

- Los operadores usan Chrome en Android y Safari en iOS, con la app instalada
  (019). Un operador sin la app instalada no recibe avisos, y eso es aceptable.
- iOS 16.4 o superior. Por debajo no hay Push API para apps instaladas.
- El equipo de una instancia es pequeño —hoy, una persona— así que "avisar a
  todos" no plantea problemas de volumen.
- El teléfono del operador tiene los avisos del sistema permitidos para la app.
  Si el operador los silencia en el sistema, no hay nada que la app pueda hacer.
