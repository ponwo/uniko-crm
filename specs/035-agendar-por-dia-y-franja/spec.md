# 035 — Agendar por día y franja: primero el día, después mañana o tarde, y entonces los horarios

**Feature Branch**: `035-agendar-por-dia-y-franja`

**Created**: 2026-10-12

**Status**: Implementada; verificada en local (unitarios + arnés E2E con mocks). Falta
la prueba en vivo en uniko-lanco con el modelo real.

**Carril**: **ligero** (`spec.md` únicamente). No toca el modelo de datos —sin
migración: la oferta sigue en `offered_slot`, la misma tabla de la 015— ni un contrato
publicado: `offer_slots` es una acción interna del agente incluido; `/api/bot/*`, el
webhook y los DTO que consumen otros repos no cambian. El Constitution Check vive aquí
abajo, como exige el Principio VI para este carril.

**Banda de requisitos**: FR-20xx, derivada del número de feature —`(35−15)×100`—.

---

## El problema, en una frase

**Cuando un cliente pide una cita, el agente le contesta de golpe con cuatro horarios
de los primeros días libres, que casi nunca son el día que el cliente tenía en mente.**

---

## Problema

Pedido del dueño (2026-10-12): *«actualmente si pides una agenda solo muestra los
horarios como lo habíamos acordado, pero eso no es muy natural; podríamos primero
preguntar para qué día está buscando, y después preguntar si prefiere por la mañana o
por la tarde, y entonces sí ofrecer los 4 horarios de la tarde si están disponibles o
los 4 de la mañana si es que están disponibles, pero ya tenemos el día que está
buscando el cliente»*.

Hasta aquí, `offer_slots` sin franja enseñaba los cuatro primeros huecos del catálogo
(denso en los dos días próximos, ralo después). El cliente que quería el jueves
recibía «hoy a las 11:00, 11:30, 12:00…», tenía que decir el día de todos modos, y
el menú que vio no le servía de nada.

**Decisiones del dueño (2026-10-12)**, al plantearle el diseño:

1. **Cuáles cuatro**: con más de cuatro huecos en la franja, cuatro **repartidos** que
   la cubran entera (p. ej. 12:00, 14:00, 15:30, 17:30), no los cuatro primeros.
2. **Franja llena ese día**: enseñar lo que sí hay ese día en la otra franja y, en una
   línea, el día más cercano que sí tiene la franja pedida.

---

## Comportamiento

```
Cliente: Hola, quiero agendar una cita
Agente:  ¿Para qué día te gustaría la cita?
Cliente: Para el miércoles
Agente:  Para mañana miércoles 14 de octubre, ¿prefieres por la mañana o por la tarde?
Cliente: Por la tarde
Agente:  Para mañana miércoles 14 de octubre por la tarde tengo:
         • 12:00
         • 14:00
         • 15:30
         • 17:30
         ¿Cuál te queda mejor? Si prefieres otra hora, dímela y la reviso.
Cliente: El primero
Agente:  ¡Perfecto, queda agendado!
```

**Quién conduce: el motor.** El modelo solo extrae lo que el cliente ya dijo —día,
franja, hora— y lo pasa en `offer_slots`; el motor decide el siguiente paso con la
agenda real delante. No pregunta «¿mañana o tarde?» por un día que solo tiene tarde,
ni deja elegir franja en un día lleno. El modelo no podría saberlo —su lista de
ofrecidos es parcial— y un menú que promete lo que no hay es justo la clase de
afirmación falsa que la 015 lleva tres ajustes quitando (23, 25 y 26 de septiembre).

**El motor no guarda estado.** No recuerda qué preguntó: el modelo repite en cada
turno todo lo que el cliente ya dijo («jueves» + «tarde»). Una conversación retomada
días después, o un cambio de día a medio camino, no deja nada a medias.

**Los pasos** (`src/server/agenda/conduccion.ts`, puro):

| Lo que se sabe | Lo que contesta el motor | Oferta vigente |
|---|---|---|
| Nada | «¿Para qué día te gustaría la cita?» (con «por la tarde» si ya la dijo) | El catálogo ancho de la 015: «mañana a las 11» se agenda a la primera |
| Día con mañana y tarde | «Para el jueves 15 de octubre, ¿prefieres por la mañana o por la tarde?» | Ese día completo |
| Día con ≤ 4 huecos | Los enseña todos, sin preguntar | Ese día |
| Día con una sola franja | «… solo me queda espacio por la tarde:» y cuatro repartidos | Ese día |
| Día + franja | Cuatro repartidos de esa franja | Ese día |
| Día + franja sin lugar | La otra franja de ese día + «Si necesitas que sea por la tarde, el viernes 16 sí tengo.» | Ese día |
| Día sin lugar | Lleno, cerrado, ya pasó o fuera de la ventana (dicho como es) + hasta tres días cercanos con lugar (en la franja, si la dijo) | El catálogo ancho |
| Hora concreta | Los cuatro más cercanos a esa hora; si está ocupada, lo dice | Ese día |
| «Lo antes posible» | Los primeros, seguidos, del primer día con lugar | Ese día |
| Agenda llena | «Por ahora no me quedan horarios libres…» | Sin cambio |

Con un día sobre la mesa, la oferta es **ese día completo y nada más**: si el cliente
contesta «mejor a las 4», se le agenda sin otra vuelta, y «a las 4» no puede caer en
otro día de la lista.

**«El primero»** es el primero del ÚLTIMO menú que vio el cliente, no el 1 de la lista
de ofrecidos del prompt: la oferta es el día entero y el menú, cuatro repartidos.

---

## Requisitos

- **FR-2001** Sin día dicho, `offer_slots` MUST contestar preguntando el día, sin
  enseñar horarios. Si ya dijo la franja, la pregunta MUST nombrarla.
- **FR-2002** Con un día que tiene huecos en las dos franjas y más de cuatro en total,
  MUST preguntar «¿prefieres por la mañana o por la tarde?» nombrando ese día. Con
  cuatro o menos MUST enseñarlos todos; con una sola franja, MUST enseñarla diciendo
  que es lo único que queda.
- **FR-2003** Con día y franja, MUST enseñar cuatro huecos **repartidos** a lo largo de
  la franja —primero y último incluidos— y avisar que puede pedir otra hora cuando la
  franja tiene más de cuatro (decisión del dueño 1).
- **FR-2004** Si la franja pedida no tiene lugar ese día, MUST decirlo, enseñar la otra
  franja de ese día y nombrar en una línea el día más cercano (hacia adelante primero)
  que sí la tiene (decisión del dueño 2).
- **FR-2005** Si el día pedido no tiene nada, MUST decir por qué —lleno, cerrado, ya
  pasó o fuera de la ventana de la agenda— y proponer hasta tres días cercanos con
  lugar, filtrados por la franja si la dijo.
- **FR-2006** Con una hora concreta, MUST enseñar los cuatro huecos de ese día más
  cercanos a ella y, si esa hora no está libre, decirlo. Sin día, MUST usar el primer
  día que tenga esa hora libre.
- **FR-2007** «Lo antes posible» MUST enseñar los primeros huecos seguidos del primer
  día con lugar (en la franja, si la dijo).
- **FR-2008** El día y la hora MUST traducirse en código (`src/server/agenda/pedido.ts`),
  no en el modelo: «jueves», «el próximo jueves», «este martes», «mañana», «pasado
  mañana», «15 de octubre», «21/10», ISO, «el 20»; «a las 4», «4 de la tarde», «11am»,
  «y media», «mediodía». Lo que no se entiende MUST contar como no dicho.
- **FR-2009** La oferta vigente MUST ser el día completo cuando hay un día sobre la
  mesa, y el catálogo ancho de la 015 cuando no lo hay (FR-027 sigue en pie: «mañana a
  las 11» se agenda a la primera).
- **FR-2010** La frase de entrada del modelo (`reply`) MUST descartarse si describe
  horarios o disponibilidad, pregunta, o abre una lista: el texto de cada paso lo
  escribe el motor.
- **FR-2011** `offer_slots` MUST aceptar `null` y números en `dia`, `franja` y `hora`
  sin reintentar el turno.
- **FR-2012** El prompt MUST pedirle al modelo que repita en cada `offer_slots` todo lo
  que el cliente ya dijo, que distinga la «mañana» día de la «mañana» franja por la
  última pregunta del sistema, y que lea «el primero» contra el último menú.
- **FR-2013** El juez del Laboratorio MUST saber que preguntar día y franja antes de
  enseñar horarios es el flujo correcto, no evasión.

---

## Constitution Check

Evaluado antes de escribir código, como exige el carril ligero.

- **I (Seguridad de datos)** — Ningún secreto ni dato nuevo.
- **II (Soberanía)** — Sin dependencias nuevas.
- **III (Multi-tenancy)** — La oferta se sigue escribiendo y leyendo por `scoped()`
  (`offers.ts`, sin cambios). La conducción es pura.
- **IV (Idempotencia)** — Sin escrituras nuevas. La oferta se reemplaza entera en cada
  paso, como en la 015.
- **Sandbox** — Sin cambios: ofrecer no toca conectores, y reservar sigue por el mismo
  motor que ya protege las citas de prueba.
- **Módulos opcionales (015, 016)** — Todo detrás de `AGENDA`: apagada, ni la acción ni
  el texto del prompt existen.
- **V y IX (Calidad)** — Gate técnico completo; unitarios de cada rama del conductor y
  del intérprete; el arnés conduce el flujo nuevo de punta a punta por wa-mock.
- **VI (Specs antes de código)** — Carril declarado arriba.
- **X (Irreversibilidad)** — **No toca `drizzle/`**: ni migración ni ensayo. Reversión:
  redesplegar el commit anterior devuelve el menú de siempre; las ofertas en curso son
  filas de `offered_slot` que el motor viejo lee igual.

**Sin violaciones que registrar.**

---

## Criterios de éxito

- **SC-001** Arnés con la agenda encendida, por wa-mock:
  - «quiero agendar una cita» → pregunta el día, sin horarios;
  - el día → pregunta mañana o tarde nombrando ese día;
  - la tarde → exactamente los cuatro repartidos de la tarde de ese día;
  - «el primero» → la cita queda en el primer horario de ese menú;
  - pedir la tarde sin día pregunta el día recordando la tarde;
  - pedir el cambio de una cita empieza por el día y la mueve (030 sigue en verde);
  - una hora fuera del menú se sigue agendando (FR-027).
- **SC-002** Unitarios de cada rama de `conducirOferta` con huecos fabricados (día
  lleno, cerrado, fuera de ventana, franja sin lugar, hora ocupada, «lo antes
  posible», agenda llena) y del intérprete de día y hora.
- **SC-003** Gate técnico (`typecheck`, `lint`, `build`, `test`) en verde.
- **SC-004** En vivo en uniko-lanco, con el modelo real (`glm-5.3-flash`): una cita por
  WhatsApp siguiendo el flujo, y un turno en que el cliente diga todo de una vez
  («el jueves por la tarde») que salte directo al menú.

---

## Cómo salió — 2026-10-13

En local, worktree `035-agendar-por-dia` (puerto 3005, base `uniko_035a` fresca):

- 1159 unitarios en verde, 26 de ellos del conductor y 19 del intérprete.
- Arnés `e2e-selftest.mjs`: todos los checks de agenda en verde, incluidos los de la
  030 (la cita manual se mueve empezando por el día) y el de mover la cita.
- Conversación real producida por el motor a través de wa-mock (el ai-mock antepone
  «¡Claro!» como frase de entrada):

  ```
  ¡Claro! ¿Para qué día te gustaría la cita?
  ¡Claro! Para mañana miércoles 14 de octubre, ¿prefieres por la mañana o por la tarde?
  ¡Claro! Para mañana miércoles 14 de octubre por la tarde tengo:
  • 12:00
  • 14:00
  • 15:30
  • 17:30
  ¿Cuál te queda mejor? Si prefieres otra hora, dímela y la reviso.
  ¡Perfecto, queda agendado!
  ```

**Pendiente**: SC-004, la prueba en vivo con el modelo real. Lo que el mock no puede
medir es si `glm-5.3-flash` repite el día al contestar la franja y si lee «el
primero» contra el menú y no contra la lista; las dos cosas están en el prompt
(FR-2012) y son lo primero que hay que mirar en el Laboratorio si algo falla.

---

## Fuera de alcance, y por qué

- **Rangos de días** («la próxima semana», «entre semana»): cuentan como no dichos y se
  vuelve a preguntar el día. Proponer días de un rango es otra conversación; si el
  cliente real lo pide seguido, se mide primero.
- **Recordar el paso en la base**: el motor sin estado es lo que hace que una
  conversación retomada días después no quede a medias. Guardar «ya pregunté la
  franja» pediría migración para nada.
- **La «noche» como franja propia**: se trata como tarde. Un negocio que atiende de
  noche aparte lo pedirá con su caso.
