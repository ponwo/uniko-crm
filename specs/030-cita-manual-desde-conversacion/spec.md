# 030 — Agendar, mover y cancelar la cita desde la conversación

**Feature Branch**: `030-cita-manual-desde-conversacion`

**Created**: 2026-09-29

**Status**: Implementada; verificada en local y **en vivo en uniko-lanco** (2026-09-29)

**Carril**: **ligero** (`spec.md` únicamente). No toca el modelo de datos —sin
migración: una cita manual es la misma fila de `booking` que ya crea la 015— ni un
contrato publicado: `GET /api/bookings` es de la propia app (no es `/api/bot/*`, ni el
webhook, ni un DTO que consuma otro repo), y del SSE solo se escucha el evento
`booking.updated` que ya existe, sin cambiarlo. El Constitution Check vive aquí abajo,
como exige el Principio VI para este carril.

**Banda de requisitos**: FR-15xx, derivada del número de feature —`(30−15)×100`—.

---

## El problema, en una frase

**Solo el agente de IA puede agendarle una cita a un contacto: el operador que atiende
la conversación no tiene cómo hacerlo desde Uniko, ni ve ahí si el contacto ya tiene
cita.**

---

## Problema

Pregunta del dueño (2026-09-29): *«manualmente yo no puedo agendar una cita para el
contacto en cuestión, solo si el agente IA lo hace; ¿no deberíamos poder agendarla
desde el panel de conversación, así como podemos agregar ficha o notas?»*

El motor ya lo permite. La 015 dejó `POST /api/bookings` con `kind: "session"` para
el operador: origen manual, sin oferta previa, con la misma re-validación del hueco y
el mismo candado anti doble-reserva que el agente. El 2026-09-28 se usó a mano para
la prueba en vivo de la 029. Pero **ninguna pantalla lo usa**:

- *Citas* lista, reprograma, cancela y bloquea rangos, pero no crea citas;
- el panel de la conversación tiene contacto, IA, etapa, ficha y notas, y nada de la
  agenda.

Casos reales que hoy no tienen salida: la IA en pausa porque el operador atiende a
mano; el cliente que pide la cita por teléfono; la cita que el agente no llegó a
cerrar.

**Decisiones del dueño (2026-09-29)**, al plantearle el diseño:

1. **Aviso al contacto: no avisar.** Agendar, mover o cancelar desde el panel no le
   manda nada; el operador le escribe lo que quiera.
2. **Cita actual: ver, mover y cancelar** desde el panel.
3. **Horario: solo huecos libres**, los mismos que ofrecería el agente.

---

## Comportamiento

**Dónde**: una sección **«Cita»** en el panel de Detalles de la conversación, entre la
etapa del pipeline y la ficha. Solo existe con la agenda encendida.

**Sin cita próxima**: «Sin cita próxima» y el botón *Agendar cita*. Este abre el
selector:

1. los días con huecos libres;
2. las horas del día elegido;
3. una nota opcional;
4. *Agendar*.

**Con cita próxima**:

- **Qué se ve de cada una**: día y hora en la zona del negocio, duración, quién la
  agendó (la IA o manual), la marca de prueba si aplica, sus notas y el enlace de la
  reunión.
- **Acciones**: *Mover*, que abre el mismo selector, y *Cancelar*, que pide
  confirmación.
- *Agendar otra* sigue disponible debajo.

**Qué pasa al agendar** (todo es lo que ya hace la 015 con una cita manual):

- la cita queda con origen manual, ligada al contacto **y a la conversación**;
- se crea la reunión con el conector activo;
- el lead avanza de etapa.

Como queda ligada a la conversación, el agente la recibe como **CITA ACTUAL** (015,
ajuste 2026-09-25): si el cliente pide otra hora, el agente la mueve en vez de
reservar una segunda.

---

## Requisitos

- **FR-1501** La sección MUST existir solo con la agenda encendida. Con `AGENDA`
  apagada, su consulta responde 404, como toda la superficie de la agenda, y el
  panel no la pinta.
- **FR-1502** La sección MUST mostrar las citas **próximas** del contacto:
  - solo citas, no bloqueos;
  - en estado `agendada`;
  - que todavía no terminan (inicio + duración > ahora): una reunión en curso sigue
    visible con su enlace;
  - de la más cercana a la más lejana.

  El corte por tiempo MUST decidirse en código, con el "ahora" que pasa quien llama,
  y no en el `where` de SQL. Es la lección de
  `memory/fallos-que-solo-aparecen-con-el-tiempo`: el doble de base de los
  unitarios ignora el `where`, y un corte ahí no lo ve ninguna prueba.
- **FR-1503** Por cada cita próxima MUST verse:
  - día y hora en la zona del negocio y la duración;
  - quién la agendó y la marca de prueba si aplica;
  - las notas;
  - el enlace de la reunión o, si el proveedor no lo entregó, «Sin enlace» con el
    camino a *Citas*, donde está *Reintentar enlace*.
- **FR-1504** *Agendar cita* MUST ofrecer solo los huecos libres que ofrecería el
  agente (horario de atención, anticipación mínima, días hacia adelante, bloqueos y
  citas tomadas), agrupados por día. Confirmar MUST crear la cita:
  - con origen manual y ligada al contacto y a la conversación;
  - con una nota opcional;
  - por el camino de operador de la 015 (sin oferta previa, con re-validación del
    hueco).
- **FR-1505** Cada cita próxima MUST poder:
  - **moverse** a otro hueco libre: la reunión del proveedor se mueve y conserva su
    enlace;
  - **cancelarse** tras una confirmación explícita: la reunión se borra.

  Mismas reglas del motor que en *Citas*.
- **FR-1506** Agendar, mover o cancelar desde el panel MUST NOT mandar ningún mensaje
  al contacto (decisión del dueño).
- **FR-1507** La sección MUST actualizarse sola cuando cambia una cita: la agenda la
  IA en esa conversación, o se mueve o cancela desde *Citas* u otra pestaña. MUST
  NOT abrir otra conexión de tiempo real: la bandeja ya escucha el SSE, y su evento
  `booking.updated` refresca el panel igual que hoy lo hacen los mensajes y la
  conversación.
- **FR-1508** Si el hueco se ocupó entre verlo y confirmarlo, la sección MUST decirlo
  («Ese horario ya no está disponible») y recargar los huecos. Cualquier otro error
  MUST mostrarse sin colgar el panel. Sin huecos libres, MUST decirlo y remitir a
  *Ajustes → Agenda*.
- **FR-1509** La consulta de las citas de un contacto MUST pasar por `scoped()`. Un
  contacto de otra organización, o inexistente, da la lista vacía.

---

## Constitution Check

Evaluado antes de escribir código, como exige el carril ligero.

- **I (Seguridad de datos)** — Ningún secreto nuevo. El enlace de la reunión es el
  mismo que el operador ya ve en *Citas*.
- **II (Soberanía)** — Sin dependencias nuevas. La reunión la crea el conector
  opcional ya configurado, o el enlace fijo sin dependencias.
- **III (Multi-tenancy)** — La consulta nueva filtra por organización con `scoped()`
  y por contacto (FR-1509). Crear, mover y cancelar son los del motor, que ya van
  por `scoped()`.
- **IV (Idempotencia)** — Crear usa el índice único parcial anti doble-reserva de la
  015, y cancelar ya es idempotente.
- **Sandbox** — Una conversación de prueba produce una cita de prueba, que jamás
  llega a un conector. Es la regla de la 015 y la afirma
  `tests/unit/agenda-sandbox.test.ts`.
- **Módulos opcionales (015, 016)** — Todo detrás de `AGENDA`: con la bandera
  apagada, la consulta responde 404 y el panel queda como hoy.
- **V y IX (Calidad)** — Gate técnico completo, unitarios del corte por tiempo, un
  bloque nuevo en `scripts/e2e-selftest.mjs` que llega hasta el agente, y el
  recorrido en el navegador de vista previa.
- **VI (Specs antes de código)** — Carril declarado arriba, antes de escribir.
- **X (Irreversibilidad)** — **No toca `drizzle/`**: ni migración ni ensayo.
  Reversión: redesplegar el commit anterior quita la sección; las citas creadas
  desde ella son citas manuales normales y siguen en *Citas*.

**Sin violaciones que registrar.**

---

## Criterios de éxito

- **SC-001** Arnés, con la agenda encendida, sobre una conversación real del wa-mock:
  - una cita manual creada desde la API del operador, con la conversación, aparece
    entre las próximas del contacto: origen manual y ligada a esa conversación;
  - **ningún mensaje** sale hacia el contacto;
  - ante «¿me la cambias a las HH?», el agente **mueve esa misma cita** (mismo id,
    hora nueva, sigue siendo una sola): prueba de punta a punta de que la ve;
  - mover y cancelar por la API del operador funcionan, y una cancelada deja de
    aparecer;
  - la lista del contacto no trae citas de otros contactos, y un contacto
    inexistente da la lista vacía.
- **SC-002** Unitarios del corte por tiempo con reloj falso:
  - una cita que ya terminó queda fuera y una en curso queda dentro;
  - canceladas, realizadas, no-show y bloqueos quedan fuera;
  - orden ascendente.
- **SC-003** Recorrido en el navegador de vista previa:
  - agendar, ver el enlace, mover y cancelar;
  - una cita que agenda la IA en esa conversación aparece sola en el panel;
  - en móvil (375 px) cabe sin scroll horizontal.
- **SC-004** Con la agenda apagada, `GET /api/bookings?contactId=…` responde 404 y el
  panel no tiene la sección.
- **SC-005** Gate técnico (`typecheck`, `lint`, `build`, `test`) y el arnés completo en
  verde.

---

## Cómo salió — 2026-09-29

Desde un worktree (`.claude/worktrees/030-cita-manual`, app en el puerto 3002 con base
desechable propia), para no tocar el checkout que otra sesión estaba usando.

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` · `build` | limpios |
| `test` (unidad) | **893 pasan**, 98 archivos (6 casos nuevos en `agenda-proximas.test.ts`) |
| `scripts/e2e-selftest.mjs`, base limpia | **269/269**, bloque 030: 14/14 |

La configuración del arnés fue `AGENDA=on`, la app de agencia contra los mocks e
`INVENTARIO` encendido.

**SC-001.** La primera corrida dio 266/267, y la falla fue del propio arnés: la frase
«¿Qué horarios **tienes** para cambiar mi cita?» el ai-mock la leyó como consulta de
existencias, porque con `INVENTARIO` encendido «tienes», «tienen» y «hay» disparan
`check_stock`. Se cambió a «Quiero cambiar mi cita, ¿me pasas los horarios?» y el
bloque salió entero, incluido el paso que da sentido a ligar la cita a la
conversación: el agente, ante «Sí, a las 09:00», **movió la cita manual** («¡Listo, la
moví!»), la misma y sin reservar una segunda.

**SC-003**, en el navegador de vista previa, sobre la conversación del arnés:

- **Sección**: «Cita» entre la etapa y la ficha, con «Sin cita próxima» y *Agendar
  cita*.
- **Selector**:
  - chips de día «Hoy · mar 29 sep», «Mañana · mié 30 sep», «jue 1 oct»… hasta 7 días
    (el `maxDaysAhead` del arnés), las horas del día elegido y la nota;
  - *Agendar* desactivado hasta elegir hora.
- **Agendar** (mañana 11:00, «Llamada de seguimiento»):
  - la tarjeta muestra «miércoles 30 sep 2026 · 11:00», 30 min, «Manual», el enlace
    (la sala fija del conector) y la nota;
  - aparece «Cita agendada. Al contacto no le llega aviso.»;
  - el outbox del wa-mock sigue en 59 mensajes;
  - la etapa pasó sola de «En conversación» a «Interesado».
- **Mover** al jueves 1 de octubre, 16:00: la tarjeta cambia de hora y conserva nota y
  enlace.
- **En vivo** (FR-1507): una cita creada para el contacto por fuera del panel apareció
  sola como segunda tarjeta, sin tocar nada.
- **Cancelar** pide «¿Cancelar esta cita? Se borra la reunión.»; con *Sí, cancelar* la
  tarjeta se va y aparece «Cita cancelada…».
- **Hueco ocupado** (FR-1508): con las 09:30 del viernes elegidas, otra sesión las
  ocupó. *Agendar* respondió «Ese horario ya no está disponible: elige otro.», se
  recargaron las horas (las 09:30 ya no estaban), el día siguió elegido y no se creó
  ninguna cita.
- **Móvil (375 px, *Mostrar detalles*)**: la tarjeta y el selector caben en la
  sección, ningún chip se sale y no hay scroll horizontal.

**SC-004**: reiniciada con `AGENDA=off`, el panel muestra Detalles, Etapa, Ficha y
Notas, sin «Cita», y `GET /api/bookings?contactId=…` responde 404. La ruta está también
en la lista de superficies que el arnés comprueba en 404 con la bandera apagada.

### En vivo — uniko-lanco en `3e8c924` (2026-09-29)

1. **Despliegue**: ponwo/uniko-crm#50 mergeada, `/api/health` 10/10 en `3e8c924`.
2. **La sección, sin tocar nada** (sesión del dueño en su Chrome):
   - en la conversación de «Gerardo Parra» aparece «Cita» entre la etapa y la ficha,
     con «Sin cita próxima» y *Agendar cita*;
   - el selector trae el horario real de LanCo: de lunes a viernes, y el primer día
     con horas de 09:00 a 15:30;
   - se cerró sin agendar.
3. **La prueba real la hizo el dueño**, desde la conversación de su contacto «Gera
   Pm», con Google Calendar conectado de verdad: **agendó, movió y canceló**. Lo que
   quedó en la instancia:
   - una cita `manual` (`bk_r2bt…`), **ligada a esa conversación**;
   - entregada por el conector `google`, con Meet real
     `meet.google.com/yef-ugws-uzc` y sin enlace pendiente;
   - su última hora fue el miércoles 30 de septiembre a las 14:00, ya movida;
   - quedó `cancelada`, y el contacto no tiene citas próximas.
4. **El log de la instancia**, desde el arranque de ese despliegue, trae solo el
   arranque: ninguna advertencia de la agenda ni de Google al crear, mover y borrar
   el evento.

---

## Fuera de alcance, y por qué

- **Avisar al contacto** (decisión del dueño). Además evita el problema de la
  ventana de 24 h: un texto automático fuera de ella necesitaría una plantilla
  aprobada.
- **Agendar fuera del horario o encima de otra cita** (decisión del dueño). El motor
  solo acepta huecos del horario. Para una hora especial se abre la franja en
  *Ajustes → Agenda*.
- **«Nueva cita» en la página de *Citas* con buscador de contacto.** En la
  conversación el contacto ya está elegido, que es donde nace la necesidad. Se
  puede añadir después sin tocar nada de esto.
- **Marcar realizada o no asistió desde el panel.** Es de después de la cita y vive
  en *Citas*.
- **Reintentar el enlace desde el panel.** Pasa poco y está a un clic en *Citas*; el
  panel lo remite ahí (FR-1503).
