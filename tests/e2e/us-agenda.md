# E2E — Motor de agenda universal (015)

Guion de comportamiento observable. Automatizado en la sección `015` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `ZOOM_BASE_URL`/`ZOOM_OAUTH_BASE_URL` →
zoom-mock, `BOT_API_KEY` y la BD migrada. La bandera `AGENDA` decide qué mitad
del guion corre: ambas se ejercitan en la matriz de CI.

---

## US1 — La instancia decide si la agenda existe

Con `AGENDA` ausente:

1. `GET /api/calendar/settings`, `/api/calendar/availability` y `/api/bookings`
   responden **404**.
2. `GET /api/bot/availability` responde **404** — antes incluso de mirar la
   llave: el endpoint no existe aquí.
3. La pantalla `/bookings` responde 404 y la navegación no la menciona.

Con `AGENDA=on`, las mismas rutas responden con normalidad.

## US2 — El negocio define cuándo atiende

1. Una instancia recién encendida devuelve **defaults usables** (cita de 30
   min, conector `enlace-fijo`) con 200, no un 404.
2. Se guarda un horario y una sala fija; la disponibilidad devuelve huecos.
3. Cada hueco trae el **día en palabras** además de la hora — la etiqueta corta
   ya agendó una cita el día equivocado en producción.
4. Una zona horaria inventada se rechaza con **422** en vez de guardarse y
   romper el motor después.

## US3 — Las dos garantías

1. **Solo se reserva lo que se ofreció**: un instante libre y válido, pero
   nunca ofrecido a esa conversación, se rechaza con `409 slot_not_offered` y
   la respuesta trae lo que sí se ofreció.
2. **Camino feliz**: reservar un hueco ofrecido responde **201 Created** (no
   200), con etiqueta y enlace; el hueco desaparece de la disponibilidad y la
   cita aparece en Citas marcada como agendada por la IA.
3. **La carrera**: un segundo intento sobre el mismo instante responde `409`
   con el sobre **anidado** y `slots` como **hermano**; en la base queda **una
   sola cita activa** en ese instante.
4. Las alternativas del `409` ya son la oferta vigente: reservar una de ellas
   responde 201 de inmediato.
5. **Reprogramar** por la superficie del bot responde **200**, no 201.

## US4 — El operador

1. Cancelar dos veces no falla (idempotente).
2. Reintentar el enlace de una cita que ya lo tiene responde 422.
3. **El proveedor caído no cuesta la conversión**: con el conector externo sin
   credenciales, reservar responde **201 igualmente**, con
   `linkPending: true` y `meetingLink: null`, y la cita se ve como "sin enlace"
   en Citas.

## US5 — Conector Zoom

1. Unas credenciales que el proveedor rechaza responden 422 y **no se
   guardan**: la conexión sigue sin existir.
2. Unas válidas se guardan y hacia el navegador solo salen sus **últimos 4** —
   el secreto no aparece en la respuesta.
3. Agendar crea la reunión: el proveedor la recibe con su tema y su hora, y el
   enlace vuelve en la respuesta.
4. Cancelar la cita **borra** la reunión en el proveedor.

## US6 — Conector Google

Cubierto por la suite de contrato (`tests/unit/connectors.test.ts`), que fija
lo que su mock reproduce: el enlace de Meet **no** viene en la respuesta de
crear el evento —la conferencia es asíncrona—, el conector re-lee, y si sigue
pendiente entrega el evento sin enlace en vez de fallar. Reintentar re-lee ese
mismo evento: **nunca** crea uno duplicado en el calendario del dueño.

## Sandbox del Laboratorio

1. Una conversación de prueba **puede** agendar (201) y la cita queda marcada
   como de prueba.
2. Con un conector externo activo, el estado del mock queda **vacío**: el
   proveedor jamás se entera de una cita de prueba. Se verifica por ausencia, y
   vale igual para crear, reprogramar y cancelar.

## El agente incluido ofrece y agenda (ajuste 2026-09-17, FR-023/FR-025)

Con `AGENDA=on`, el agente del CRM (no un cerebro externo) conduce la reserva
completa. Antes de este ajuste el LLM real ofrecía bien y después re-ofrecía en
bucle: nunca veía el instante exacto de lo ofrecido y el motor compara por epoch.

1. Con el agente encendido, un lead escribe por wa-mock «Hola, quiero agendar
   una cita» → la respuesta trae **horarios reales** con viñetas
   (`offer_slots`; los pega el sistema).
2. El mismo lead escribe «El primer horario, agéndamelo por favor» → la
   respuesta **confirma la cita** y comparte la sala fija (`book_slot` copió el
   `startUtc` del bloque HORARIOS OFRECIDOS del prompt).
3. En **Citas** aparece la cita con `source: ai`, en el **primer hueco libre**
   que había antes de ofrecer.
4. Camino infeliz (modelado por el ai-mock): sin el bloque de ofrecidos en el
   prompt, «el primer horario» **no reserva** y vuelve a ofrecer — el check 3 se
   pone rojo. Es exactamente el fallo observado en LanCo, y por eso el arnés lo
   detectaría si el contexto dejara de viajar.

## El cliente pide SU hora, no la del menú (ajuste 2026-09-23, FR-027/FR-029)

Medido en vivo en LanCo con un cliente real: tras ver tres horarios pidió «para
mañana a las 11am», las 11:00 estaban libres y el agente le contestó que no
había disponibilidad — el catálogo solo registraba tres huecos por día.

1. Un lead nuevo escribe «Hola, quiero agendar una cita» → el menú enseña tres
   horarios **y avisa** de que hay más («si te acomoda mejor otra hora…»).
2. El mismo lead pide una hora libre **que no está en esos tres** («Mejor a las
   14:30») → el agente **la agenda**.
3. La cita queda en **esa** hora, no en una del menú.
4. La respuesta **no** contiene «no hay disponibilidad», «ocupado» ni «lleno»:
   el agente no puede saberlo, así que tiene prohibido afirmarlo.

## Un modelo distinto solo para elegir horario (AGENDA_MODEL, FR-030)

1. Con `AGENDA_MODEL` definido, el turno de ENTRADA («quiero agendar») lo
   conduce el modelo de siempre: ahí solo hay que reconocer la intención.
2. El turno de ELEGIR horario («mejor a las 14:30») lo conduce `AGENDA_MODEL`:
   es donde se decide la cita.
3. Sin la variable, todos los turnos usan `OPENROUTER_MODEL`.

Se comprueba con el modelo que el ai-mock recibió en cada turno
(`GET /api/dev/ai-mock/_state`), no de palabra: la promesa es de COSTO y de
otro modo solo se podría verificar mirando la factura del proveedor.

## Cambiar de opinión: mover la cita (ajuste 2026-09-25, FR-031)

Medido en el Laboratorio de LanCo con el LLM real: ante «uy, a esa hora ya no
puedo, ¿me la cambias a la tarde?» el agente escalaba a un humano. Tenía razón
con lo que sabía —el prompt solo hablaba de cancelar—, pero el motor sí sabe
mover, y cambiar de hora es lo más común que pasa de verdad.

1. Con una cita ya agendada, el cliente pide cambiarla → el agente **vuelve a
   ofrecer** (reservar borra los horarios ofrecidos, y el instante nuevo
   también tiene que haberse ofrecido). No escala ni dice que no hay hueco.
2. El cliente elige la hora nueva → el agente **mueve** la cita.
3. Queda **UNA sola** cita, en la hora nueva, y con el mismo enlace de reunión:
   el conector mueve el evento, no crea otro.
4. La conversación **no** queda escalada: mover es trabajo del agente.
5. Cancelar sigue fuera: eso es irreversible y va con una persona.

Camino infeliz cubierto por el mock: sin `CITA ACTUAL` en el prompt, elegir una
hora reserva una SEGUNDA cita — que es justo lo que el arnés detectó.
