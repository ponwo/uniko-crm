# ADR-003 — Las notificaciones push entran como conector opcional, no como núcleo

**Fecha**: 2026-09-07 · **Estado**: aceptado · **Feature**: 020

## Contexto

La 020 quiere avisar al operador cuando el agente escala una conversación a un
humano, aunque no tenga la app delante. Eso es Web Push, y Web Push **no se puede
self-hostear**.

El motivo es estructural, no de comodidad: cuando el navegador crea una
suscripción, **es él quien elige el servidor de entrega** y devuelve un
`endpoint` que apunta ahí. Chrome/Android entrega por FCM (Google), Firefox por
el autopush de Mozilla, y Safari/iOS por APNs (Apple). El servidor de la
instancia no puede sustituirlos: solo puede firmar una petición y mandarla al
endpoint que le dieron. No hay versión "propia" de esto.

Es decir: la 020 mete **un tercero en runtime**, y el Principio II lo prohíbe
como dependencia del núcleo. La lista de dependencias permitidas es cerrada
—WhatsApp Cloud API y el proveedor LLM opcional—, y todo lo demás solo entra
como **conector opcional bajo cinco condiciones**.

Este ADR decide que push entra por esa puerta, y deja escrito cómo se cumple cada
condición. Se decide **antes de la spec** para que la spec no tenga que abrir el
debate a mitad de camino, que es lo que pasó en la 015 y en la 016 hasta que
existieron el ADR-001 y el ADR-002.

## Decisión

**Las notificaciones push son un conector opcional detrás de la bandera `PUSH`,
apagado por defecto**, con el mismo patrón que los canales (ADR-001) y los
conectores de agenda (ADR-002).

Las cinco condiciones de la constitución, una por una:

### 1. Apagada por defecto

Sin `PUSH` encendida, una instancia **no menciona push por ningún lado**: no
registra el handler en el service worker, no pide permiso de notificaciones, no
enseña el botón de activarlas, sus rutas responden 404, y no genera ni guarda
ninguna clave. Es indistinguible de una instancia que no tiene la feature.

La migración se aplica igual en toda la flota (tablas vacías inertes), como
manda el patrón: nunca una rama aparte.

### 2. Aislada tras un adaptador con contrato público

El dominio no sabe que FCM o APNs existen. `applyHandoff()` —el único sitio del
código donde el agente escala— llama a una capacidad de dominio ("avisa de esta
escalación"), y detrás vive `src/server/push/`, con un contrato estable:

```
enviarAviso(suscripcion, aviso) → entregada | caducada | fallo
```

Quien implementa ese contrato habla Web Push (VAPID + el endpoint del
navegador). Cambiar de mecanismo mañana no toca el dominio.

### 3. La instancia funciona completa sin ella, y su fallo degrada

El camino sin dependencia externa **ya existe y seguirá siendo el principal**: la
escalación se ve en la app en vivo por SSE (`conversation.updated`, la insignia
de *Atención humana* en la bandeja). Push no sustituye eso: **lo repite fuera de
la app** para quien no la tiene delante.

Degradación definida, y esta es la línea que no se cruza: **si el envío del aviso
falla, la escalación se registra igual**. El handoff no depende del push. Un FCM
caído, un endpoint caducado o una instancia sin claves producen exactamente el
comportamiento de hoy: el operador ve la escalación cuando abre la app.

### 4. Credenciales del propio negocio, cifradas en reposo

Cada instancia usa **su propio par de claves VAPID**, generado por ella misma y
con la privada cifrada en reposo (`lib/crypto`, AES-256-GCM). Jamás una cuenta
central ni claves compartidas por la flota: si LanCo y NuriaAndrea compartieran
clave, el servidor de push las trataría como el mismo emisor.

Matiz que este conector tiene y los demás no: **aquí no hay cuenta de tercero que
dar de alta**. No se le pide al dueño ninguna credencial de Google ni de Apple;
la identidad la genera la instancia. El tercero solo entrega.

### 5. Verificable apagada y encendida

La CI ejercita las dos configuraciones, y el conector tiene **mock con camino
infeliz**: endpoint caducado (410), rechazo del servicio, y tiempo de espera
agotado. La regla del arnés se mantiene: un check que no puede fallar no es un
check.

## Lo que se descartó

- **Push como parte del núcleo.** Viola el Principio II sin margen: obligaría a
  toda instancia a depender de Google o Apple para operar.
- **Self-hostear la entrega.** No es una opción cara: es imposible. El endpoint
  lo elige el navegador.
- **Un SaaS de push** (OneSignal, Pusher y parecidos). Añade un tercero que ve el
  tráfico de las tres instancias y, peor, obliga a **una cuenta central de
  plataforma** — exactamente lo que prohíbe la condición 4. Y no compra nada que
  no dé el estándar.
- **Notificar cada mensaje entrante.** Decisión de producto, no de arquitectura;
  su razón va en la spec. Aquí solo consta que el disparador es la escalación.
- **Reintentos, escalado a otro operador y alertas por no atender.** Cada una
  suena razonable por separado; juntas son otro producto. Van a "lo que NO se
  hace" de la spec.

## Consecuencias

- **Una instancia con `PUSH` apagada se comporta como hoy, byte a byte.** Es lo
  que hace que esta feature no toque a quien no la quiera.
- **Con la bandera encendida**, el navegador del operador habla con FCM o APNs.
  Ese tráfico no lo controla la instancia: es del navegador, y ocurre igual que
  cuando ese mismo navegador sincroniza cualquier otra cosa.
- **Qué ve el tercero**: lo decide la spec al elegir si el aviso lleva contenido.
  La investigación (R3) documenta que existe la opción de **no mandar ningún dato
  del cliente** por el servicio de push, y qué cuesta.
- **La 020 depende de la 019.** En iOS, el Push API solo existe si la app está
  instalada en standalone. Sin la 019 desplegada —y lo está desde hoy— esta
  feature no puede existir en iPhone.
- **El service worker gana un handler de push, y solo con la bandera encendida.**
  Su enrutado estático, que deja `/api/events` fuera de forma estructural, **no
  se toca**: es la garantía que la 019 dejó comprobada con las dos mitades, y
  seguirá comprobándose en cada corrida del arnés.
- **Aparecen secretos nuevos por instancia** por primera vez en el producto. El
  research (R2) plantea dónde deben vivir y qué cuesta cada opción; la decisión
  se toma en la spec.
