# 020 — Research (antes de la spec)

Lo que había que resolver antes de escribir la spec, con lo que se comprobó y lo
que **no** se pudo comprobar. Fecha: **2026-09-07**.

---

## R1. El Principio II: por qué push no puede ser núcleo

**Resuelto en el [ADR-003](../../docs/adr-003-notificaciones-push.md).**

Lo esencial: Web Push **no se puede self-hostear**. Cuando el navegador crea la
suscripción, es él quien elige el servidor de entrega y devuelve un `endpoint`
que apunta ahí — FCM en Chrome/Android, autopush en Firefox, APNs en Safari/iOS.
El servidor de la instancia solo firma y manda al endpoint que le dieron.

Por tanto es un tercero en runtime, y entra como **conector opcional tras la
bandera `PUSH`**, apagado por defecto, con las cinco condiciones mapeadas una a
una en el ADR.

---

## R2. Claves VAPID: qué son, cómo se generan, dónde viven

### Qué son

Un par de claves de curva elíptica **P-256** que identifican al emisor. La
pública viaja al navegador al suscribirse (`applicationServerKey`); con la
privada se firma un JWT **ES256** en cada envío, que es lo que prueba al servicio
de push que el aviso sale de quien dice.

**No son credenciales de un tercero**: no hay cuenta que dar de alta en Google ni
en Apple. Las genera la instancia.

### Se generan sin dependencias

Node 22 trae todo lo necesario, así que **no hace falta librería**:

- `crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })` para el par;
- `crypto.sign` para el ES256 del JWT (con la conversión DER → R‖S, que son unas
  veinte líneas).

Esto importa por el Principio II: meter `web-push` como dependencia sería
aceptable —es una librería, no un servicio— pero no hace falta, y el repo ya
tiene el precedente de leer bytes a mano en vez de traerse una librería (el
`IHDR` del PNG en la 019).

### Dónde viven — tres opciones y su coste

| Opción | Coste operativo | Riesgos |
|---|---|---|
| **(a) Variables de entorno por instancia**, generadas por el dueño y pegadas en Coolify | Un paso manual **por instancia**, y otro por cada rotación. Con tres instancias son tres pegados; con treinta, treinta | Es el patrón que ya duele: `.env.example` no afecta a las instancias vivas, y **hace falta un redeploy por instancia** para que surtan efecto (memoria de la flota). Una instancia nueva no puede encender push sin tocar la plataforma |
| **(b) Generadas al encender la bandera y guardadas cifradas en la base** (`lib/crypto`) | **Cero pasos manuales.** La instancia se genera su par la primera vez que hace falta | Perder la fila invalida todas las suscripciones: los operadores tendrían que volver a activar los avisos. El respaldo de la base ya las lleva dentro |
| **(c) Híbrida**: usa la variable si existe, y si no, genera y guarda | Cero pasos en el caso normal, y deja la puerta abierta a fijarlas | Dos caminos que mantener y un "¿de dónde salió esta clave?" más difícil de responder |

**Recomendación: (b).** Encaja con el patrón de bandera —encenderla no debería
exigir además coordinar un secreto— y con el Principio I, que pide credenciales
cifradas en reposo, no en variables de entorno visibles en un panel. El coste de
(a) no es teórico: la flota ya tiene una cicatriz por variables que se pegan una
por una.

**Rotación**: sea cual sea la opción, rotar la clave **invalida todas las
suscripciones** — el navegador las ató a la pública anterior. La spec debe decir
qué se ve cuando eso pasa: el operador vuelve a ver "activar avisos".

---

## R3. ¿El aviso lleva datos del cliente, o no lleva nada?

No estaba en la lista de preguntas, y sale de la primera: decide **qué ve el
tercero** y cuánto código hay que escribir.

| | **Con contenido** (RFC 8291) | **Sin contenido** (aviso vacío) |
|---|---|---|
| Qué pasa por FCM/APNs | El texto cifrado del aviso | **Nada**: solo "hay algo" |
| Qué hace el service worker | Muestra lo que trae | Pide al servidor qué mostrar y lo muestra |
| Código propio | ECDH + HKDF + AES-128-GCM, ~100 líneas delicadas (o una librería) | Ninguno de cifrado |
| Qué se guarda de cada suscripción | `endpoint` + claves `p256dh` y `auth` | **Solo el `endpoint`** |
| Camino infeliz | Ninguno extra | Si la petición del worker falla (sin red), hay que mostrar un aviso genérico |

**Recomendación: sin contenido.** Tres razones: **ningún dato de un cliente del
negocio atraviesa a Google o Apple** —que es exactamente lo que el Principio I
pide y lo que un dueño preguntaría—; se guarda menos de cada dispositivo; y se
evitan cien líneas de criptografía propia cuyo fallo sería silencioso.

El coste es real y hay que aceptarlo con los ojos abiertos: **el aviso puede
llegar sin poder decir de quién es** si el teléfono no tiene red en ese instante.
La spec debe definir ese texto degradado — algo como *"Una conversación necesita
atención"*, que sigue siendo útil.

---

## R4. Una conversación, una notificación: ¿lo respeta iOS?

**No, y esto sí cambia el diseño.** La respuesta corta: en Android sí, en iOS
**no se puede dar por bueno**.

- **Android/Chrome**: la `tag` de la Notifications API hace justo lo pedido —
  una notificación con la misma etiqueta **reemplaza** a la anterior, sin lógica
  de agrupación ni ventanas de tiempo.
- **iOS/Safari**: está documentado que **la `tag` se ignora** y que cada push
  crea una notificación nueva; también que `icon` se ignora (usa el icono de la
  app) y que `getNotifications()` devuelve vacío. El reporte es de iOS 16.4 y
  **el issue sigue abierto**, sin confirmación de que se arreglara en versiones
  posteriores.
  → [mdn/browser-compat-data#19318](https://github.com/mdn/browser-compat-data/issues/19318)

**No lo doy por cerrado en ningún sentido**: no encontré fuente que confirme que
siga roto en iOS 26, ni que lo arreglaron. Va al nivel 3 como comprobación
explícita, y la spec debe funcionar en los dos casos.

> **Actualización tras el nivel 3 (2026-09-08, iOS 26.6.1): sigue abierta.** La
> corrida vio que **dos conversaciones distintas producen dos avisos**, igual que
> en Android. Eso **no discrimina**: dos conversaciones llevan `tag` distinta, así
> que dan dos notificaciones tanto si el sistema respeta la `tag` como si la
> ignora. Lo único que respondería es un segundo aviso **de la misma
> conversación**, y eso casi no se puede provocar por lo que dice la sección de
> abajo. Queda anotado como **no discriminado en 26.6.1** —no como resuelto— en
> [`tests/e2e/us-push.md`](../../tests/e2e/us-push.md).

### El hallazgo que hace pequeño el problema

Al leer el código aparece algo que cambia el tamaño del asunto: **el escenario
de "tres escalaciones en cinco minutos" casi no puede ocurrir.**

`applyHandoff()` es el **único** sitio que escala (cinco llamadas, todas en
`src/server/ai/pipeline.ts`), y el pipeline arranca con esta condición de
silencio:

```
if (conversation.handoffAt || !conversation.aiEnabled) return;
```

Es decir: **una vez escalada, el agente calla**. No hay segundo turno, y por
tanto no hay segunda escalación, hasta que un humano reactive la conversación.
La repetición solo aparece si alguien devuelve la conversación al agente y esta
se vuelve a escalar — que es un caso legítimo y raro.

**Conclusión de diseño**: se usa `tag` con el id de la conversación porque es
gratis y resuelve Android; **no se construye ninguna lógica de agrupación ni
ventanas de tiempo**; y el peor caso en iOS —dos avisos de la misma conversación
tras una reactivación— es tolerable y queda escrito como comportamiento conocido.

---

## R5. Qué exige iOS, además de estar instalada

- **App instalada en la pantalla de inicio** (`display: standalone` o
  `fullscreen` en el manifiesto). En una pestaña de Safari **no hay push**,
  aunque se conceda el permiso. Ya lo sabíamos; queda confirmado.
- **iOS/iPadOS 16.4 o superior.**
- **El permiso se pide con un gesto del usuario.** `Notification.requestPermission()`
  tiene que salir de un manejador de clic: en iOS no vale pedirlo al cargar la
  página. **Esto obliga a un botón explícito** ("Activar avisos"), que además es
  lo que queremos por producto.
- **Sin icono propio en la notificación**: usa el de la app. Otro motivo para que
  el icono instalado de cada negocio sea el suyo (019).
- **Sin medios enriquecidos** (imágenes, GIF, vídeo).
- **Caveat sin verificar**: una fuente secundaria afirma que en la UE las PWA
  perdieron el modo standalone —y con él el push— por la DMA. Apple anunció eso
  en 2024 y **después dio marcha atrás**, así que lo dejo como no confirmado. No
  afecta a esta flota (México), pero si algún día hay un cliente en la UE, hay
  que comprobarlo antes de prometer nada.

Fuentes:
[Web Push for Web Apps on iOS and iPadOS (WebKit)](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) ·
[PWA iOS limitations and Safari support](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) ·
[mdn/browser-compat-data#19318](https://github.com/mdn/browser-compat-data/issues/19318)

---

## R6. Dónde se engancha, según el código de hoy

- **Un solo punto de escalación**: `applyHandoff(conversationId, organizationId,
  reason)` en `src/server/ai/pipeline.ts`. Cinco llamantes, cuatro motivos:
  `cliente`, `modelo`, `error`, `ventana`. Ahí ya se publica
  `conversation.updated` por SSE; el aviso push es el hermano de esa línea.
- **El Laboratorio escala también.** Las conversaciones `is_test` pasan por el
  mismo pipeline. **Una escalación de prueba no puede mandar una notificación
  real**: es el mismo guardarraíl del sandbox que ya existe para el envío y para
  la agenda, y la spec debe declararlo como criterio propio, no como detalle.
- **Suscripciones por usuario, no por instancia** (decidido): una tabla con
  `organization_id` NOT NULL (Principio III), `user_id`, el `endpoint` como clave
  única, y sello de creación. Con eso, "avisar a todos" es hoy un `select` sin
  filtro y mañana un `select` con filtro, sin rehacer nada.
- **Caducidad**: cuando el servicio responde **410 Gone**, esa suscripción está
  muerta y se borra. Es idempotente y es el camino infeliz más común (Principio
  IV).

---

## R7. Cómo se va a verificar, y la regla que se hereda de la 018

El nivel 3 es incómodo y hay que decirlo desde ahora: exige **un teléfono con la
app instalada, el permiso concedido, y una escalación real del agente**.

La regla de la 018 se aplica igual: **una corrida en la que la notificación no
llegó no cuenta como verificación**. O se repite, o se registra explícitamente
como *no reproducida*. Un verde sin notificación recibida es ruido.

Lo que el nivel 3 tiene que responder, y ningún arnés puede:

1. ¿Llega la notificación con la app **cerrada** (no solo en segundo plano)?
2. En **iOS**, ¿reemplaza la segunda notificación de la misma conversación, o se
   apilan? — la pregunta abierta de R4.
3. ¿Al tocarla se abre la conversación correcta?
4. Si el teléfono no tiene red al recibirla, ¿aparece el texto degradado en vez
   de nada? (solo aplica si la spec elige el aviso sin contenido)

Los niveles 1 y 2 sí se pueden automatizar: la decisión de a quién avisar es
función pura; el envío se prueba contra un **mock del servicio de push** con sus
caminos infelices; y el arnés comprueba que con la bandera apagada no existe
nada, y que con ella encendida el service worker sigue **sin tocar
`/api/events`** — las dos mitades de la 019, que no se negocian.
