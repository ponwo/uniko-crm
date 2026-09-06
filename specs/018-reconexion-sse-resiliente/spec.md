# 018 — Reconexión resiliente del SSE

**Feature Branch**: `018-reconexion-sse-resiliente`

**Created**: 2026-09-05

**Status**: Draft

**Carril**: ciclo completo. Criterio objetivo de la constitución (Principio VI):
toca un **contrato publicado** — el SSE está nombrado ahí de forma expresa, y el
comportamiento de reconexión y catch-up es parte de
[`specs/001-uniko-core/contracts/sse.md`](../001-uniko-core/contracts/sse.md).
No toca el modelo de datos: no hay migración.

**Escrito antes del código.**

## Problema

La bandeja de Uniko está viva porque el navegador mantiene abierta una conexión
SSE contra `/api/events`. Cuando esa conexión muere, la app no se entera de
nada nuevo — y hoy **no se entera de que no se entera**.

El cliente actual (`src/components/use-events.ts`) descansa por completo en que
`EventSource` avise: marca una bandera en `onerror` y dispara el catch-up en el
`onopen` siguiente. Si el aviso no llega, no pasa nada. No hay vigilancia del
tiempo, ni del regreso a primer plano: el servidor manda un `: ping` cada 25
segundos y **nadie lo mira**.

Hay un caso documentado en el que el aviso no llega. En iOS 18 se reporta que,
al minimizar la app y reactivarla, la conexión SSE queda cerrada pero el evento
`error` **no se dispara** y `readyState` sigue valiendo `1` (OPEN). Está
reportado en los foros de Apple como afectando a producción, sin respuesta
oficial ni resolución conocida; lo tratamos como riesgo creíble, no como
comportamiento especificado. Aun si mañana Apple lo arregla, el diseño actual
sigue siendo frágil: confía en una notificación que nadie garantiza.

**Lo que ve el operador** es lo que hace esto grave. Vuelve a la app, la bandeja
se pinta, no hay error, no hay spinner, no hay aviso. Parece al día. Los
mensajes que entraron mientras tanto no están, y nada distingue "no ha escrito
nadie" de "no me estoy enterando". Un cliente esperando respuesta se convierte
en un cliente ignorado, y el operador no tiene forma de saberlo.

Es el peor modo de fallo posible para este producto: **silencioso, y en la
pantalla que más se usa**. Por eso esta feature vale por sí sola, aunque nunca
se instale nada.

## Escenarios

1. **Volver tras la suspensión**: el operador deja la app en segundo plano
   (bloquea el teléfono, cambia de app) y vuelve minutos después. La bandeja
   está al día y él lo sabe, sin recargar a mano.
2. **Enterarse de que no se está al día**: la conexión cae y no vuelve. La app
   lo dice. El operador puede distinguir de un vistazo "no hay nada nuevo" de
   "no me estoy enterando".
3. **Recuperar el hueco**: durante la caída entraron tres mensajes de clientes.
   Al restablecerse, aparecen los tres, en la bandeja y en el hilo abierto, sin
   duplicarse con lo que ya estaba.
4. **La red vuelve sola**: el operador entra al ascensor y sale. La app se
   recupera sin intervención y sin quedarse reintentando para siempre si no hay
   red.
5. **Todo lo demás sigue igual**: el contador de no leídos, el Laboratorio y la
   agenda también se ponen al día tras un hueco, no solo la bandeja.

## Requisitos

### Detectar

- **FR-301** El cliente MUST considerar la conexión **viva solo mientras
  reciba tráfico**. El servidor emite `: ping` cada ~25 s; si transcurre un
  margen razonable sin ningún dato —evento o heartbeat—, la conexión se declara
  muerta **aunque `readyState` diga OPEN y aunque no se haya disparado
  `error`**. El silencio es la señal; el estado que reporta el navegador no es
  de fiar.
- **FR-302** El cliente MUST comprobar el estado de la conexión al **volver a
  primer plano** (la app se hace visible de nuevo tras haber estado oculta), sin
  esperar al margen de silencio. Es el momento en que el fallo de iOS aparece, y
  también el momento en que el operador está mirando.
- **FR-303** La detección MUST ser independiente del motivo. Suspensión del
  sistema, cambio de red, caída del servidor o proxy que corta: si dejó de
  llegar tráfico, se trata igual. El cliente no intenta adivinar la causa.

### Recuperar

- **FR-304** Al detectarse muerta, la conexión MUST restablecerse y, al quedar
  abierta de nuevo, MUST dispararse el catch-up (`onReconnect`).
- **FR-305** El restablecimiento MUST reintentar con espera creciente y un
  tope, no en bucle apretado: sin red, reintentar cada 100 ms gasta batería y
  no arregla nada. Mientras la app está en segundo plano no hace falta insistir;
  al volver a primer plano se intenta de inmediato.
- **FR-306** Si `/api/events` responde **401** (la sesión caducó durante el
  hueco), el cliente MUST dejar de reintentar y tratarlo como sesión terminada,
  no como caída de red. Reintentar contra un 401 no se recupera nunca.
- **FR-307** El catch-up MUST alcanzar a **todos** los consumidores de eventos,
  no solo a la bandeja: el contador de no leídos de la navegación, el
  Laboratorio y la agenda quedan al día tras un hueco. (Ver "Lo que encontramos
  en el código".)
- **FR-308** La recuperación MUST ser idempotente en pantalla: un mensaje que ya
  estaba no se duplica, y un envío propio en vuelo no pierde su burbuja
  provisional ni aparece dos veces.

### Decir la verdad

- **FR-309** Mientras la conexión no esté establecida, la app MUST indicarlo de
  forma visible y persistente en la bandeja. **El silencio no es un estado
  válido**: si no se puede afirmar que la vista está al día, hay que decirlo.
- **FR-310** El aviso MUST distinguir al menos dos situaciones para el usuario:
  *reconectando* (transitorio, no requiere acción) y *sin conexión* (persistente,
  lo que se ve puede estar incompleto). Un tercer estado, "al día", es el normal
  y no necesita adorno.
- **FR-311** El aviso MUST desaparecer solo cuando la conexión está
  restablecida **y** el catch-up ha terminado. Quitarlo al reconectar, con la
  vista todavía sin refrescar, reintroduce el problema en pequeño.
- **FR-312** Una reconexión limpia y rápida —el caso común al desbloquear el
  teléfono— NO debe producir parpadeo de avisos ni recargar visiblemente la
  bandeja. Un indicador que salta cada dos minutos se deja de leer, y entonces
  no sirve el día que importa.

### No romper lo que hay

- **FR-313** El contrato SSE del servidor (headers, heartbeat ~25 s, formato de
  eventos, sin garantía de replay) NO cambia como parte de esta feature. Si el
  plan concluye que hace falta tocarlo, sube por la puerta del ciclo completo y
  se actualiza `contracts/sse.md` en el mismo cambio.
- **FR-314** El comportamiento en escritorio con red estable NO cambia de forma
  observable: quien tiene la app abierta en un monitor no debe notar esta
  feature salvo por el aviso cuando de verdad se cae.

## Decisión: los mensajes que llegaron durante el hueco

**Se recuperan en el cliente, con un refetch al reconectar. No se añade replay
en el servidor.** Esta feature es de cliente.

**Por qué.** El mecanismo ya existe y ya funciona: la bandeja tiene un
`onReconnect` que vuelve a pedir las conversaciones y el hilo abierto. El
problema del hueco nunca fue traer los datos — es que **nadie dispara ese
catch-up** cuando la conexión muere en silencio, y que dos consumidores ni
siquiera lo implementan. Arreglada la detección (FR-301, FR-302) y extendido el
catch-up (FR-307), el hueco se cierra sin código nuevo de servidor.

**Por qué no replay.** Un servidor que reenvía lo perdido necesita registro de
eventos, retención, orden y una política de cuánto guardar y por cliente: estado
nuevo y duradero para un problema que un refetch ya resuelve. Además, el
contrato vigente dice expresamente que el servidor **no garantiza replay** y que
el catch-up es del cliente; cambiarlo es rediseñar el transporte, que está fuera
de alcance. Y hay un argumento de corrección: el refetch lee el estado actual,
mientras que el replay reconstruye una historia — ante duda sobre qué se perdió,
leer la verdad de ahora es más seguro que reproducir el pasado.

**Lo que esto implica y aceptamos**: si el catch-up falla (por ejemplo, la red
vuelve a caerse a mitad), la vista queda incompleta. Por eso FR-311 ata el aviso
al final del catch-up y no al de la reconexión: el usuario sigue advertido hasta
que la vista sea de fiar.

## Constitution Check

El Constitution Check formal es del `/plan`. Se adelanta aquí lo que condiciona
la definición de "Hecho", porque afecta a lo que la spec puede prometer.

**Principio IX — Verificación de Comportamiento en Vivo.** Aplica de lleno y es
el punto incómodo de esta feature: **el fallo no se reproduce en `localhost`**.
Requiere un dispositivo real que suspenda la app y la reactive, que es
justamente la condición que el navegador de escritorio no reproduce.

**No choca con la constitución; encaja.** El Principio IX ordena "local primero,
nube después" como un SHOULD, y reserva expresamente el despliegue para "lo que
el entorno local no pueda reproducir". Este es ese caso, y la excepción está
escrita, no forzada. Lo que el principio sí exige y aquí se respeta: que la
prueba la ejecute quien implementa, que cubra el camino infeliz, y que se itere
hasta verde sin delegar la prueba al dueño.

Encaja además con la **puerta de promoción** (condición 3), que pide el
self-test contra la instancia de pruebas desplegada y no solo contra
`localhost`. LanCo entra en vivo justo ahora: es la candidata natural a ejercer
esta feature con uso real antes de que viaje a los clientes.

**Principio VI** — ciclo completo por criterio objetivo (contrato publicado),
justificado en el encabezado.

**Principios I, II, III, IV** — sin impacto: no hay credenciales nuevas, ni
dependencias externas, ni tablas, ni eventos entrantes de terceros.

## Verificación

La definición de "Hecho" de esta feature **no puede ser un test en
`localhost`**. Tres niveles, y ninguno sustituye al siguiente:

1. **Automatizable (unidad).** La lógica de decidir "esta conexión está muerta"
   a partir del tiempo sin tráfico y del regreso a primer plano es pura y se
   prueba con reloj falso: silencio por debajo del margen no dispara nada,
   silencio por encima sí, el regreso a primer plano fuerza comprobación
   inmediata, un 401 no reintenta.

2. **Escritorio, con muerte silenciosa simulada.** Hace falta poder provocar en
   un navegador de escritorio lo que iOS hace solo: una conexión que deja de
   entregar sin cerrarse ni emitir `error`. **Se propone un modo de prueba** que
   permita al servidor dejar de escribir en un stream vivo sin cerrarlo, para
   ejercer el camino completo —detección por silencio, aviso al usuario,
   reconexión, catch-up— con Playwright y los mocks ya existentes. Debe vivir
   tras el mismo gate de desarrollo que el resto (`src/lib/dev-guard.ts`, 404
   incondicional en producción). El plan decidirá su forma.

   **Este modo NO sustituye al punto 3.** Simula el síntoma, no la causa: no
   prueba que el sistema operativo suspenda la app, ni que `readyState` mienta.

3. **Dispositivo real, obligatorio.** Con la feature desplegada en LanCo: abrir
   la app en un iPhone y en un Android, dejarla en segundo plano varios minutos
   —lo bastante para que el sistema la congele—, hacer que entre un mensaje
   durante el hueco, y volver a primer plano. El criterio es lo que ve el
   operador: el mensaje aparece, y en ningún momento la pantalla afirmó estar al
   día cuando no lo estaba. El camino infeliz —volver sin red— muestra el aviso
   de sin conexión y se recupera al volver la red.

Los guiones E2E por historia viven en `tests/e2e/`; esta feature extiende ese
arnés en vez de dejar solo el `.md`.

## Criterios de éxito

- **SC-001** Tras una suspensión de al menos 5 minutos y volver a primer plano,
  la bandeja refleja los mensajes llegados durante el hueco sin que el usuario
  recargue.
- **SC-002** En ningún estado la app presenta la bandeja como al día cuando la
  conexión no lo está: siempre que no se pueda garantizar, hay aviso visible.
- **SC-003** Una conexión que deja de entregar sin cerrarse se detecta y se
  restablece sin intervención del usuario.
- **SC-004** El contador de no leídos coincide con la bandeja tras un ciclo de
  suspensión y recuperación.
- **SC-005** Sin red, la app no reintenta en bucle apretado ni queda
  reintentando indefinidamente sin decírselo al usuario.
- **SC-006** En escritorio con red estable durante una jornada, no aparecen
  avisos espurios de reconexión.

## Fuera de alcance

- **PWA, manifest, iconos y service worker.** Es la **019**. Esta feature
  arregla el fondo antes de que la 019 ponga un service worker con handler de
  `fetch` justo delante del SSE.
- **Notificaciones push.** Es la **020**, con su propio ADR por el Principio II.
- **Rediseñar el transporte.** No se migra a WebSockets ni a polling. El alcance
  es que el SSE que ya existe se recupere de forma fiable. La tentación es real
  —el hilo de Apple citado termina con gente migrando a WebSockets— y se rechaza
  a propósito: cambiar de transporte por un fallo de detección es reescribir el
  tiempo real entero para no arreglar la causa.
- **Replay en el servidor.** Decidido arriba, con su razón.
- **Notificar al usuario cuando la app está en segundo plano.** Avisar de un
  mensaje sin tener la app delante es push, y es la 020.

## Lo que encontramos en el código

Hallazgos de la lectura previa, que la spec da por ciertos y el plan debe
confirmar:

- **El catch-up ya existe, pero solo en la bandeja.**
  `src/components/inbox/inbox-client.tsx` implementa `onReconnect` con un
  refetch completo de conversaciones y del hilo abierto. En cambio
  `src/components/app-nav.tsx` (el contador de no leídos),
  `src/components/lab/lab-client.tsx` y
  `src/components/bookings/bookings-client.tsx` **no pasan `onReconnect`**. Es
  un fallo preexistente: incluso cuando hoy la reconexión sí se detecta, esos
  tres se quedan desactualizados. De ahí FR-307.

- **El contrato dice `since=` y la implementación hace refetch completo.** El
  contrato (`contracts/sse.md`) y el comentario de `use-events.ts` describen el
  catch-up como "refetch con `since=`"; el parámetro existe en la API de
  conversaciones, pero la bandeja hace un refetch completo. No es un fallo —el
  refetch completo es más seguro— pero la documentación y el código no dicen lo
  mismo. El plan decide cuál gana y alinea el otro.

- **`/api/events` ya responde 401 sin sesión**, así que FR-306 tiene un
  comportamiento de servidor sobre el que apoyarse; no hace falta añadir nada.

## Supuestos

- La reconexión de `EventSource` sigue sirviendo cuando el navegador **sí**
  detecta el cierre; esta feature añade la red de seguridad para cuando no lo
  detecta, no la sustituye.
- El heartbeat de ~25 s del servidor se mantiene. El margen de silencio que
  elija el plan será varias veces ese periodo, para no declarar muerta una
  conexión por una pausa normal.
- Un solo operador por instancia es lo común, pero varias pestañas abiertas del
  mismo usuario son posibles y no deben estorbarse.
- El reporte de iOS 18 se trata como riesgo creíble sin confirmación oficial.
  El diseño no depende de que sea cierto: vigilar el silencio protege igual
  contra proxies que cortan, redes que cambian y servidores que se reinician.
