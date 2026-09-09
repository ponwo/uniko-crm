# 021 — El Laboratorio sigue al negocio

**Feature Branch**: `021-laboratorio-del-negocio`

**Created**: 2026-09-09

**Status**: Draft

**Carril**: ciclo completo. La Entrega 3 **toca el modelo de datos** —una tabla
nueva de escenarios y una columna en `agent_test_run`—, así que arrastra
migración y con ella el ensayo del [Principio
X](../../.specify/memory/constitution.md). Las Entregas 1 y 2 no tocan
`drizzle/` y por eso van primero: valen solas.

**Banda de requisitos**: FR-6xx, derivada del número de feature (constitución
1.6.0). Esa regla vive hoy en `gobernanza/bandas-fr`, sin mergear — **este spec
depende de que ese PR entre antes**.

---

## El problema, en una frase

**El Laboratorio evalúa a todos los negocios con preguntas de ferretería.**

---

## Problema

Los seis clientes simulados son constantes de módulo en
`src/server/lab/personas.ts`, y su contenido es una tlapalería:

> *"¿Tienen taladros inalámbricos disponibles?"* · *"¿qué precio tiene el
> martillo?"* · *"Compré una lijadora la semana pasada y ya no prende"* ·
> *"ke onda, si benden pintura?"*

NuriaAndrea e I Love The Universe tienen hoy su agente evaluado con eso. El
score que produce no mide si el agente atiende bien a SU cliente: mide si sabe
de herramienta eléctrica. No sirve de ninguna manera.

**No es que alguien escribiera guiones descuidados.** La
[investigación](research.md) lo dejó claro: las personas son el gemelo del
negocio de demostración. El seed carga "Ferretería El Martillo" con el KB lleno
*excepto garantías y devoluciones* —hueco intencional—, la persona
`fuera_de_kb` pregunta exactamente por garantías y devoluciones, y el `ai-mock`
del self-test tiene esa pareja cableada. El Laboratorio se construyó contra el
fixture y nunca se re-apuntó al inquilino.

### El segundo defecto, que es el que muerde

El prompt del agente le ordena: *"Si la pregunta NO está cubierta por el
conocimiento → NO inventes: responde que lo confirmarás o escala"*. La rúbrica
del juez dice: *"Si el agente respondió sobre un tema que NO está en el
conocimiento → hallazgo `fuera_de_kb`"*.

**Declinar correctamente y contestar sin saber comparten casilla.** El juez
penaliza el comportamiento que el producto le exige al agente.

Hoy es un sesgo tolerable. Con escenarios generados que atacan los huecos del
conocimiento —que es lo que queremos— deja de serlo: por diseño la mitad o más
de las preguntas no tendrán respuesta documentada, el agente declinará bien en
casi todas, y el juez las suspenderá todas por la razón equivocada. **El score
bajaría cuanto mejor funcionara el agente.**

Por eso la rúbrica no es un extra de esta feature: es condición para la
Entrega 3.

---

## Las tres entregas

| | Qué | Toca `drizzle/` |
|---|---|---|
| **1** | Los seis dejan de ser una ferretería | no |
| **2** | El juez deja de castigar al agente por obedecer | no |
| **3** | El negocio genera sus escenarios desde su conocimiento | **sí** |

Las dos primeras valen por separado y se pueden soltar sin esperar a la
tercera. Si la 3 se aplaza, el Laboratorio ya habrá dejado de mentir.

---

## Escenarios

**Un negocio que no es una ferretería corre el Laboratorio.** Ve seis clientes
simulados que preguntan por lo que ofrece *ese* negocio —lo más popular, el
precio, si atienden sábados—, no por taladros. El score mide su agente.

**Un negocio con conocimiento cargado quiere ir más hondo.** Pide generar
escenarios; el sistema le propone unos cuantos escritos contra los huecos de su
propio conocimiento. Los lee, corrige lo que no le cuadra, descarta lo que no
sirve y confirma. A partir de ahí sus corridas incluyen esos escenarios además
de los seis.

**Un agente que declina bien saca buena nota.** Preguntado por algo que su
conocimiento no cubre, responde que lo confirmará con el equipo. El juez lo
marca verde: hizo exactamente lo que se le pidió.

**Un negocio recién desplegado, sin conocimiento.** El Laboratorio corre igual
con los seis. El botón de generar le dice por qué no puede todavía, y qué
hacer.

---

## Requisitos

### Entrega 1 — los seis genéricos

- **FR-601** Los seis escenarios que trae el producto MUST ser agnósticos del
  giro del negocio. Ninguno nombra un producto, un servicio ni un sector
  concreto.
- **FR-602** Los seis MUST seguir midiendo lo mismo que hoy: intención de
  compra, invención de cifras, manejo de un cliente molesto, pregunta fuera del
  conocimiento, petición de humano, y texto mal escrito con modismos.
- **FR-603** Cada uno MUST declarar en el código qué mide, para que quien lo
  edite dentro de un año sepa qué rompe si lo reescribe.
- **FR-604** El guion de `pide_humano` MUST conservar la frase que dispara
  `matchesHandoffIntent()`. La investigación encontró que esa persona nunca
  llega al modelo —el patrón la atrapa antes—, y eso se decide aparte
  (Fuera de alcance); mientras tanto, cambiar la frase rompería el test del
  respaldo sin arreglar nada.
- **FR-605** El `ai-mock` y `tests/e2e/us4-lab.md` MUST dejar de depender de la
  pareja *"garantías y devoluciones"* ↔ KB de la ferretería. Hoy el guion
  espera score 83 y delta +17 sobre ese fixture.

### Entrega 2 — la rúbrica del juez

- **FR-610** Declinar correctamente MUST contar como **verde**. Un agente que,
  preguntado por algo que su conocimiento no cubre, dice que lo confirmará o
  escala, hizo lo correcto y la rúbrica MUST decirlo.
- **FR-611** El hallazgo `fuera_de_kb` MUST reservarse para el agente que
  **respondió como si supiera** algo que no está en el conocimiento.
  `alucinacion` sigue siendo el caso más grave: afirmar datos concretos
  inventados.
- **FR-612** Cada escenario MUST llevar un **resultado esperado** que el juez
  recibe. Hoy recibe el nombre de la persona y una rúbrica genérica, sin saber
  qué debería pasar en ese caso concreto.
- **FR-613** El cambio de rúbrica MUST quedar visible en el histórico: un score
  de antes y uno de después no son comparables, y la pantalla no puede
  presentarlos como si lo fueran.

### Entrega 3 — escenarios propios generados

- **FR-620** El negocio MUST poder generar escenarios a partir de su
  conocimiento configurado.
- **FR-621** El generador MUST pedir explícitamente escenarios que ataquen los
  **huecos** del conocimiento, no que lo reciten. Un guion que el agente
  contesta perfecto no enseña dónde falla.
- **FR-622** La generación MUST producir **propuestas**, no escenarios. Nada se
  persiste hasta que el dueño las revisa y confirma. Sin estado intermedio
  guardado.
- **FR-623** El dueño MUST poder corregir el texto de una propuesta antes de
  confirmarla, y descartar las que no sirvan.
- **FR-624** Los escenarios propios MUST convivir con los seis, no
  sustituirlos. Los seis miden **comportamiento** y son comparables entre
  negocios; los propios miden si **ese** conocimiento tiene huecos.
- **FR-625** Cada corrida MUST guardar un **sello** del conjunto de escenarios
  contra el que se evaluó, calculado sobre el contenido de los guiones y no
  solo sobre sus claves. Editar una línea cambia el examen igual que añadir uno.
- **FR-626** El histórico MUST advertir cuando dos corridas tienen sellos
  distintos. Un delta entre exámenes distintos no significa nada, y presentarlo
  sin aviso es la forma más barata de mentir con un número.
- **FR-627** Un guion MUST sostenerse sin saber qué contestó el agente. El
  cliente simulado no reacciona: dispara su tercera línea diga lo que diga el
  agente. Un guion que asuma una respuesta produce diálogos absurdos y evalúa
  al agente por no adivinar.
- **FR-628** Un escenario propio MUST usar un teléfono de un rango reservado,
  distinto del de los seis, y el sistema MUST rechazar el que colisione con un
  contacto real de esa organización. Ver "Decisión: los teléfonos".
- **FR-629** Sin proveedor LLM configurado, generar MUST decir que no se puede
  y por qué; el Laboratorio sigue corriendo con los seis. Es distinto de un
  fallo del proveedor: uno se arregla configurando, el otro reintentando.
- **FR-630** Sin conocimiento cargado, generar MUST decir que no hay de qué
  generar. El Laboratorio **sigue corriendo** con los seis.
- **FR-631** Antes de correr, el sistema MUST anunciar cuántos escenarios va a
  evaluar y aproximadamente cuánto tarda. Una corrida que pasa de seis a
  catorce cuesta tiempo y tokens, y descubrirlo esperando es una mala
  experiencia.
- **FR-632** Borrar un escenario MUST quitarlo del futuro, no del pasado: el
  reporte de una corrida vieja tiene que seguir nombrándolo.

---

## Decisión: quién escribe las preguntas NO es el juez

La propuesta inicial del dueño era que **el propio agente evaluador** generara
las preguntas. Se descarta, y el motivo lo dejó escrito kosmo en su decisión
DD-02, que su código aplica: el generador usa **el modelo del agente**, no el
del juez.

> *"Con el modelo del juez, el juez acabaría calificando preguntas que él mismo
> escribió. Eso no solo comparte puntos ciegos con el evaluador — se los deja
> ELEGIR, y además es la única correlación que ningún prompt puede atacar,
> porque el juez nunca lee estas instrucciones."*

Ninguna de las dos opciones es limpia: generador y evaluado también comparten
modelo. Se elige **la correlación que sí se puede atacar desde el prompt**, y
FR-621 la ataca pidiéndole al generador los huecos de su propio conocimiento.

---

## Decisión: el examen se fija al confirmar, no al correr

La propuesta inicial era generar **antes de cada corrida**. Se descarta.

El histórico del Laboratorio muestra el score y el **delta contra la corrida
anterior**. Ese delta es la promesa entera de la pantalla: *¿mejoró mi agente?*
Con un examen que se regenera cada vez, *"subiste 12 puntos"* deja de decir si
mejoró el agente o si el examen salió más fácil.

Generar sigue siendo un acto deliberado del dueño, cuantas veces quiera. Lo que
no puede es pasar solo, en cada corrida. Y como regenerar **sí** cambia el
examen legítimamente, el sello de FR-625 es lo que mantiene el histórico
honesto en vez de prohibir el cambio.

---

## Decisión: sin conocimiento se bloquea la generación, no el Laboratorio

Un negocio en día 0 no tiene KB, y de un KB vacío no salen escenarios. Pero sí
puede preguntarse *"¿mi agente escala cuando le piden un humano?"* o *"¿inventa
precios?"* — y eso no necesita conocimiento ninguno.

Por eso los seis y los generados conviven (FR-624): miden cosas distintas. Lo
que el KB vacío apaga es el botón de generar (FR-630), no la herramienta.

---

## Decisión: los teléfonos de los escenarios propios

El Laboratorio resuelve el contacto de prueba **por teléfono**
(`upsertTestContact` en `runner.ts`). Un escenario cuyo número ya pertenezca a
un cliente real del negocio le colgaría **a esa persona** una conversación
simulada: mezclaría mensajes falsos con su historial real y le metería al
pipeline un lead que no existe.

No es validación de formulario: es integridad de los datos del inquilino, y por
eso FR-628 es **bloqueante**. Un escenario que no pasa la comprobación no se
guarda. Los seis del producto viven en `5210000000001`…`0006`; los propios
salen de un rango distinto para que las dos familias no se pisen.

---

## Constitution Check

- **I (Seguridad)** — Los guiones son texto del propio negocio. La
  comprobación de teléfono de FR-628 existe precisamente para que un escenario
  no toque datos de un cliente real.
- **II (Soberanía)** — La generación usa el adaptador LLM que ya existe
  (`chatJson`). **Ningún tercero nuevo.** Sin token configurado, generar no está
  disponible y el Laboratorio sigue entero con los seis (FR-629): degradación
  definida, no bloqueo.
- **III (Multi-tenancy)** — La tabla nueva lleva `organization_id` NOT NULL e
  indexado org-first; toda consulta pasa por `scoped()`.
- **V y IX (Calidad y comportamiento en vivo)** — El self-test tiene que seguir
  siendo determinista de punta a punta, lo que obliga a rehacer el `ai-mock`
  (FR-605) y a que sepa responder al prompt del generador. El Laboratorio hoy
  **no está en el arnés automático**: su guion es manual. Esta feature lo mete.
- **VI (Specs antes de código)** — Carril declarado arriba, antes de escribir
  código.
- **X (Irreversibilidad)** — La Entrega 3 toca `drizzle/`. La migración es
  **aditiva**: una tabla nueva y una columna nueva anulable en `agent_test_run`.
  **Plan de reversión**: redesplegar el commit anterior deja la tabla y la
  columna sin usar e inertes; ningún dato existente se transforma ni se borra.
  Ensayo del Principio X obligatorio contra un respaldo real restaurado en un
  PostgreSQL desechable — el procedimiento está escrito y probado en
  [`specs/020-notificaciones-push/quickstart.md`](../020-notificaciones-push/quickstart.md).

---

## Criterios de éxito

- **SC-001** Un negocio que no vende herramienta no ve ni una pregunta de
  ferretería en el Laboratorio.
- **SC-002** Un agente que declina correctamente una pregunta sin cobertura
  saca verde en ese caso.
- **SC-003** Un negocio con conocimiento genera escenarios, los revisa, corrige
  al menos uno y confirma; la corrida siguiente los incluye.
- **SC-004** Un escenario generado que apunta a un número de un contacto real
  no se guarda, y el sistema dice por qué.
- **SC-005** Dos corridas con exámenes distintos no se presentan con un delta
  como si fueran comparables.
- **SC-006** Sin token de IA, el Laboratorio corre igual con los seis y el
  botón de generar explica qué falta.
- **SC-007** Sin conocimiento cargado, el Laboratorio corre igual con los seis.
- **SC-008** El self-test del Laboratorio corre solo, sin gastar tokens, y
  entra en `pnpm test:e2e`.

---

## Fuera de alcance

- **Borrar o archivar corridas.** La investigación (§5) confirmó que hoy no se
  pueden borrar desde el producto y que el único camino era el seed destructivo
  —que esta misma feature retira de producción—. Es un hueco real, pero es una
  feature con su propia decisión (qué pasa con las conversaciones `is_test` que
  quedarían huérfanas, porque `agent_test_case.conversation_id` es `set null`).
  Meterla aquí infla la entrega sin necesitarlo.
- **Procedencia de las entradas de KB** (`source`, `sourceCaseId`) y el resto
  del problema 2 de la investigación: aplicar una sugerencia al KB no deja
  rastro, no es idempotente y no se puede deshacer dirigido. Toca el modelo de
  datos y merece su spec.
- **Recoger las conversaciones `is_test` que se acumulan.** Cada corrida crea
  seis y nadie las recoge nunca.
- **Que `pide_humano` llegue al modelo.** `matchesHandoffIntent()` la atrapa por
  patrón antes del LLM, así que una de las seis evaluaciones no evalúa al
  agente. Decidirlo cambia el pipeline, no el Laboratorio.
- **Vigencia del conocimiento.** Kosmo genera solo desde conocimiento vigente
  porque su feature 007 le puso caducidad al KB. Uniko no la tiene —`kb_entry`
  no lleva fechas de vigencia— así que aquí no aplica.

---

## Lo que encontramos en el código

Todo verificado en `f13fd19`, no de memoria.

1. **`kb_entry` no tiene vigencia** en Uniko: `kind`, `question`, `answer`,
   `content`, `createdAt`, `updatedAt`. La dependencia que kosmo tiene con su
   007 no se hereda.
2. **`agent_test_run` no tiene dónde guardar el sello**: `status`, `score`,
   `error`, `startedAt`, `finishedAt`. De ahí la columna nueva.
3. **El runner importa `PERSONAS` directo** (`runner.ts:8,43,117`) y crea el
   contacto de prueba con `upsertTestContact` (`:179`), marcando la
   conversación `isTest: true` (`:186`).
4. **El histórico devuelve las últimas 50** (`/api/lab/runs`, `limit(50)`): una
   corrida vieja desaparece de la lista pero sigue en la base.
5. **Las dos rúbricas —Uniko y kosmo— son idénticas.** Kosmo NO arregló el
   problema de FR-610; adoptar su generación sin arreglarlo importaría el
   defecto amplificado.
6. **Los seis genéricos de kosmo ya son agnósticos de giro** y llevan escrito
   qué mide cada uno. Son punto de partida directo para la Entrega 1.

---

## Supuestos

- El PR de `gobernanza/bandas-fr` entra antes que este spec; si no, la banda
  FR-6xx queda sin respaldo constitucional.
- El seed demo sale de producción por el trabajo que cierra la 022 (ver la nota
  de cierre de esa feature). Este spec no depende de que ocurra primero, pero
  sí asume que ocurre: mientras el seed siga en producción, la ferretería puede
  volver a entrar por ahí.
- Las tres instancias de la flota están **sin datos de demo y sin corridas del
  Laboratorio**, confirmado por el dueño el 2026-09-09. No hace falta limpieza
  de datos: esta feature evita que se ensucien, no las limpia.
