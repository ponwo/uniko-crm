# 018 — Fase 0: investigación

Resuelve los NEEDS CLARIFICATION del plan. Todo verificado contra
especificación o documentación del proveedor, no de memoria. Las respuestas que
cambian el alcance van primero.

---

## R1. ¿Es observable el `: ping` desde el cliente? — **NO**

**Decisión**: el heartbeat actual **no sirve** como señal de vida en el cliente.
La feature necesita un cambio de servidor.

**Fundamento**: la especificación HTML de server-sent events dice, en el
procesado del stream, que una línea que empieza por `:` se ignora sin más: *"If
the line starts with a U+003A COLON character (:) — Ignore the line."* No
despacha ningún evento y **no toca ningún estado observable**: ni el buffer de
datos, ni `lastEventId`, ni el tiempo de reconexión. Su único efecto es de red:
mantener viva la conexión frente a proxies que cortan por inactividad, que es
justo para lo que se puso.

**Consecuencia**: hay que emitir además un **evento con nombre**. Es aditivo y
FR-313 lo permite expresamente: un `EventSource` ignora los eventos con nombre
que no tiene registrados, así que ningún cliente existente se rompe.

**Alternativas descartadas**:
- *Sustituir el `: ping` por el evento con nombre*: funcionaría (un evento con
  nombre también mantiene viva la conexión) y ahorraría unos bytes, pero la spec
  lo excluye a propósito y el ahorro es despreciable. Se mantienen los dos.
- *Medir actividad solo con los eventos de dominio*: no sirve. Una instancia sin
  tráfico es indistinguible de una conexión muerta, que es exactamente el fallo
  a evitar.

**Fuente**: [HTML Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

## R2. ¿Qué eventos avisan de que la página volvió? — `visibilitychange` + `pageshow`; **`resume` no sirve en iOS**

**Decisión**: la detección se apoya en `visibilitychange` y `pageshow`. Los
eventos `freeze`/`resume` del Page Lifecycle API **no se usan**.

**Fundamento**: `freeze` y `resume` son de Chromium. La tabla de compatibilidad
los da como **no soportados en Safari de escritorio ni en Safari de iOS**
(tampoco en Firefox); solo Chrome 68+, Edge 79+, Opera y derivados. Es decir:
**no existen precisamente en la plataforma donde vive el fallo que motiva esta
feature.**

Esto confirma el diseño de la spec: la vigilancia por silencio (FR-301) es el
mecanismo que sostiene la feature, y los eventos de visibilidad la adelantan.
No al revés.

**Alternativa descartada**: seguir la recomendación de Chrome de cerrar
conexiones en `freeze` y reabrirlas en `resume`. Es buena práctica en Chromium y
no cuesta mucho, pero: (a) no ayuda en iOS, que es el caso que importa; (b)
añade un segundo camino de reconexión que hay que probar aparte; (c) el
vigilante ya cubre ese escenario al volver. Se descarta por simplicidad. Si el
futuro lo pide, entra como optimización, no como base.

**Fuentes**: [Page Lifecycle API — Chrome for Developers](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) ·
[caniuse — Document `freeze` event](https://caniuse.com/mdn-api_document_freeze_event)

---

## R3. Los temporizadores no corren mientras la página está congelada

**Decisión**: el vigilante **no puede** basarse en que un `setInterval` haya ido
disparando. Al volver a primer plano se compara un **sello de tiempo** (`last
traffic at`) contra el reloj actual.

**Fundamento**: en el estado *Frozen*, el navegador "suspende la ejecución de
tareas congelables; los temporizadores de JavaScript y las devoluciones de
llamada de fetch no se ejecutan". Un intervalo de 20 s no dispara tres veces
durante un minuto de suspensión: no dispara, y luego se reanuda tarde.

**Consecuencia de diseño**: la comprobación es *pull*, no *push*. Se registra
`lastTrafficAt` con cada dato recibido, y se evalúa `now - lastTrafficAt` en dos
momentos: cuando el intervalo llega a dispararse, y —lo importante— **en cuanto
la página se hace visible**. Un vigilante escrito como "si el intervalo no
disparó, está todo bien" sería exactamente lo contrario de lo que hace falta.

**Fuente**: [Page Lifecycle API — Chrome for Developers](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

---

## R4. ¿Qué hace `EventSource` ante un 401? — cierra para siempre

**Decisión**: FR-306 se implementa distinguiendo `readyState` tras el `error`.

**Fundamento**: la especificación distingue dos caminos. Si la respuesta no es
200 o el `Content-Type` no es `text/event-stream`, el agente de usuario **falla
la conexión**: pone `readyState` en `CLOSED`, dispara `error` y *"once the user
agent has failed the connection, it does not attempt to reconnect"*. Ante un
error de red, en cambio, **restablece** la conexión: espera el intervalo de
reconexión y reintenta.

**Consecuencia**: `error` con `readyState === CLOSED` significa "el servidor
rechazó o falló de forma terminal" — y ahí reconectar en bucle es justo lo que
no hay que hacer. `error` con `readyState === CONNECTING` significa "se está
reintentando solo", y basta con esperar. Esto da una regla limpia y sin
adivinar:

- `CONNECTING` → dejar que reintente; el vigilante cubre si no vuelve.
- `CLOSED` → un intento controlado; si vuelve a cerrar, declarar sesión
  terminada y **dejar de reintentar** (FR-306).

**Nota**: `EventSource` no expone el código de estado, así que "401" no se lee
directamente. `CLOSED` es la señal disponible, y `/api/events` ya responde 401
sin sesión, así que el comportamiento de servidor necesario ya existe.

**Fuente**: [HTML Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

## R5. Margen de silencio

**Decisión**: **60 segundos** sin tráfico alguno para declarar muerta la
conexión.

**Rationale**: el servidor emite cada 25 s (`HEARTBEAT_MS`). 60 s tolera **dos
heartbeats perdidos** más un margen de jitter, sin llegar al minuto y medio que
haría que el operador espere mirando una pantalla desactualizada. Menos de 50 s
produciría falsos positivos ante una pausa normal de red móvil.

**Alternativas**: 40 s (un solo heartbeat perdido) se descarta por frágil en
redes móviles; 90 s se descarta porque el usuario ya está mirando.

**Nota**: al volver a primer plano no se espera al margen (FR-302): se comprueba
de inmediato, porque ahí sabemos que hubo una suspensión.

---

## R6. Reintento

**Decisión**: espera creciente 1s → 2s → 4s → 8s → 15s, con tope en 15 s, y
reinicio del contador al conectar bien. Sin reintentos mientras
`document.hidden`; al volver a primer plano, intento inmediato y contador a cero.

**Rationale**: FR-305 pide no gastar batería en bucle apretado y no quedarse
reintentando en silencio. El tope de 15 s mantiene la recuperación rápida cuando
la red vuelve, sin martillear. No insistir en segundo plano es lo que evita el
gasto: sin push (fuera de alcance, feature 020) no hay nada que mostrar mientras
la app no está delante.

---

## R7. Cómo simular la muerte silenciosa en escritorio

**Decisión**: un endpoint de desarrollo que abre un stream SSE **válido que
deja de escribir** pasado un momento, sin cerrarlo, bajo
`src/app/api/dev/` y el gate existente `src/lib/dev-guard.ts`.

**Rationale**: es el síntoma exacto que hay que ejercer —conexión viva a nivel
de socket, sin datos, sin `error`, `readyState` en OPEN— y el único modo de
probar de forma determinista la detección por silencio en un navegador de
escritorio. Va en `api/dev/` porque ahí viven ya los mocks tras un gate único
con 404 incondicional en producción: no se inventa un segundo mecanismo ni se
mete una rama de prueba en una ruta de producción.

**Límite, ya escrito en la spec**: simula el síntoma, no la causa. No sustituye
la prueba en dispositivo real (nivel 3).

---

## Resumen de impacto sobre la spec

| Pregunta | Respuesta | ¿Cambia el alcance? |
|---|---|---|
| R1 `: ping` observable | No | **Sí**: añade trabajo de servidor (aditivo) |
| R2 eventos de vuelta | `visibilitychange` + `pageshow` | No; descarta `freeze`/`resume` |
| R3 temporizadores congelados | Comparar sellos de tiempo | No; condiciona el diseño |
| R4 401 | `CLOSED` = no reintentar | No; da regla limpia a FR-306 |
| R5 margen | 60 s | No |
| R6 reintento | 1→15 s con tope | No |
| R7 simulación | Endpoint tras `dev-guard` | No |

Ningún hallazgo obliga a reescribir la spec. El único que mueve trabajo es R1, y
la spec ya lo previó en FR-313.
