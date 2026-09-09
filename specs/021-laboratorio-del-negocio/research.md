# 021 — Investigación: de dónde deberían salir los casos del Laboratorio

**Estado**: investigación cerrada, **spec sin escribir**. Se para aquí para
decidir juntos.

Todo lo de abajo sale de leer el código en `f13fd19`, no de memoria. Los
archivos: `src/server/lab/{personas,runner,judge}.ts`,
`src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`,
`src/app/api/lab/**`, `src/app/api/kb/**`, `src/components/lab/lab-client.tsx`,
`src/server/seed/demo.ts`, `src/server/dev/ai-mock.ts`,
`src/instrumentation-node.ts`, `src/lib/db/schema.ts`, `tests/unit/judge.test.ts`,
`tests/unit/lab-sandbox.test.ts` y `tests/e2e/us4-lab.md`.

---

## 0. El hallazgo que reencuadra los dos problemas

**Las personas no están mal escritas: son el gemelo del negocio de demostración.**

`pnpm seed:demo` carga **"Ferretería El Martillo"** (FR-075). Y su comentario de
cabecera dice, literalmente, que el KB queda lleno **excepto garantías y
devoluciones** — *"hueco INTENCIONAL para que el Laboratorio encuentre algo real
en la primera corrida"*.

La persona `fuera_de_kb` pregunta exactamente eso: *"¿Cuál es su política de
garantías y devoluciones?"*. Y el `ai-mock` del self-test tiene esa pareja
cableada: si el conocimiento configurado **no** menciona garantías o
devoluciones, devuelve `rojo` con una sugerencia sobre garantías; si ya las
menciona, devuelve `verde`. El guion manual (`tests/e2e/us4-lab.md`) espera
score **83** en la primera corrida y **100 con delta +17** tras aplicar la
sugerencia.

O sea: el Laboratorio es una demostración cerrada y coherente **de la ferretería**
— corres, encuentras el hueco, lo tapas con un clic, vuelves a correr y el número
sube. Funciona perfecto sobre el fixture.

**El defecto no es que alguien escribiera guiones descuidados. Es que el
Laboratorio se construyó contra el fixture y nunca se re-apuntó al inquilino.**
Eso cambia el encuadre de la 021: no es "reescribir seis guiones", es "hacer que
el Laboratorio siga al negocio".

---

## 1. Cómo funciona hoy, en cuatro piezas

**Los casos.** `PERSONAS` es una constante de 6 elementos en
`src/server/lab/personas.ts`, con `script: string[]` de líneas fijas. No hay
tabla, ni configuración por organización, ni generación. El cliente simulado
**no usa LLM**: el comentario del archivo lo llama *"determinismo total del lado
del cliente"*.

**La corrida.** `POST /api/lab/runs` **no acepta parámetros**; `startRun()`
inserta los seis casos de golpe. Por cada persona: crea un contacto sintético
archivado (`[Prueba] …`, teléfono `52100000000X`, reutilizado entre corridas),
una conversación con `is_test = true`, y va insertando las líneas del guion como
mensajes entrantes, llamando después a `runAgentTurn()` — **el pipeline real**,
sin debounce y en secuencia. Corta al primer `handoff_at`. Lock de concurrencia
por índice parcial UNIQUE (`status = 'running'`), timeout global de 10 minutos, y
`cleanupOrphanRuns()` al arranque marca como fallidas las que quedaron vivas tras
un reinicio.

**El juez.** Una llamada por conversación. Recibe el transcript **más el KB y el
perfil del agente de la organización**, y una rúbrica estricta: responder sobre
algo que no está en el conocimiento → `fuera_de_kb`; afirmar datos concretos que
no están → `alucinacion`; cliente pidió humano y no hubo escalado →
`debio_escalar`; más `tono`.

**El score.** `verde` = 1, `amarillo` = 0.5, `rojo` = 0, sobre los casos juzgados;
`judge_failed` queda fuera del denominador. El historial muestra el score y el
**delta contra la corrida anterior con score**, que es la promesa de valor de la
pantalla: *¿mejoró mi agente?*

**Lo que sí es del negocio y lo que no**: el **agente** corre con el perfil, el
KB y las etapas de la organización, y el **juez** evalúa contra ese mismo KB. Lo
único genérico son **las preguntas**. Por eso el desajuste se paga entero en el
score.

### Un segundo defecto, independiente de los guiones

El prompt del agente le ordena: *"Si la pregunta NO está cubierta por el
conocimiento → NO inventes: responde que lo confirmarás o escala"*. La rúbrica
del juez, en cambio, dice: *"Si el agente respondió sobre un tema que NO está en
el conocimiento → hallazgo `fuera_de_kb`"*.

**La rúbrica no distingue "contestó algo que no sabía" de "dijo correctamente que
no lo sabía".** Un agente que obedece al pie de la letra puede cosechar hallazgos
por hacer justo lo que se le pidió. Esto **sobrevive a cualquier cambio de
guiones** — con casos del negocio pasaría menos veces, pero el sesgo sigue ahí.
Y el juez recibe el nombre de la persona (`PERSONA SIMULADA: …`) sin que la
rúbrica diga **qué se espera de cada una**: no hay noción de resultado esperado.

---

## 2. Los tres caminos

### Lo que los tres necesitan igual (y conviene contar una sola vez)

1. **Una tabla de casos por organización** (etiqueta + guion ordenado + activo)
   → toca `drizzle/` → **ensayo del Principio X otra vez**. La 020 dejó el
   procedimiento escrito y probado, así que el coste ya no es descubrirlo: es
   media hora.
2. **El runner deja de leer `PERSONAS`** y lee los casos de la organización.
   `PERSONA_LABELS` y `agent_test_case.persona` (hoy una clave de texto) tienen
   que pasar a **guardar una copia de lo que se corrió**: si los casos se pueden
   editar, una corrida vieja debe seguir siendo legible y comparable.
3. **El `ai-mock` hay que rehacerlo**: hoy despacha por la cadena `fuera_de_kb` y
   por si el KB menciona garantías. Con casos del negocio, esa pareja desaparece.
   Sin esto, el self-test de la 021 no puede ser determinista.
4. **`tests/e2e/us4-lab.md` se reescribe**: espera score 83 y delta +17 sobre la
   ferretería.
5. **Qué recibe un negocio el día 0** — y aquí es donde los tres caminos se
   separan de verdad.

### (a) Los escribe el dueño — lista editable en Ajustes

**Qué habría que construir.** CRUD completo de casos: listar, crear, editar,
reordenar líneas, activar/desactivar, borrar. Es la misma forma que el KB, que ya
existe (`/api/kb` + la pantalla del agente), así que se copia un patrón del repo
en vez de inventarlo. Más el estado vacío, más la validación (una etiqueta y N
líneas de cliente), más decidir dónde vive: junto al KB en `/agent`, o dentro del
propio Laboratorio.

**Negocio recién desplegado.** Es el peor de los tres en frío: sin casos, el
Laboratorio no puede correr. Se tapa con un **juego inicial deliberadamente
neutro** —lo que cualquier negocio comparte: pide hablar con una persona,
pregunta horario, pregunta precio, llega enojado, escribe con faltas, pregunta
algo que casi seguro no está en el KB— que es honesto porque **no finge conocer
el negocio**. Es exactamente lo que hoy no se hace: hoy el juego inicial finge
ser una ferretería.

**Determinismo.** **Se conserva entero.** Siguen siendo cadenas fijas; sólo
cambian de sitio (de la constante a la base). El cliente sigue sin usar LLM.

**Pegas.**
- Es trabajo del dueño, y **quien más necesita el Laboratorio es quien menos va a
  escribir buenos casos**.
- **Sesgo de confirmación**: uno escribe las preguntas que ya sabe que su agente
  contesta. El Laboratorio deja de sorprender, que es para lo que sirve.
- **Deriva**: el negocio cambia y los casos no.
- **Comparabilidad**: si el examen se edita, el delta entre corridas miente. Hace
  falta una respuesta explícita (fijar el juego de casos en cada corrida y avisar
  en el historial de que el examen cambió).

### (b) Generados desde su base de conocimiento

**Qué habría que construir.** Un generador (una llamada con `chatJson` y un
esquema Zod que devuelva N casos), un momento para regenerar (a petición; o al
cambiar el KB, que es más traicionero), **una pasada de revisión antes de que se
usen** —no quieres que un examen aparezca solo—, y que el mock sepa responder al
prompt del generador de forma determinista.

**Negocio recién desplegado.** Mejor que (c) y peor que un juego inicial neutro:
**un negocio nuevo tampoco tiene KB**. Pero el KB es lo *primero* que se
configura —sin él el agente no sirve—, así que el huevo-y-gallina es más débil:
en la práctica, cuando alguien va a estrenar el Laboratorio ya tiene KB.

**Determinismo.** Aquí está el matiz que más importa de toda esta investigación:
**(b) no obliga a perder el determinismo**. Si se genera **una vez**, se
**persiste** y se **revisa**, cada corrida sigue siendo determinista y comparable;
lo que se movió es la aleatoriedad a un acto aparte, deliberado y auditable. Lo
que sí lo rompe es **generar en cada corrida**: entonces el examen cambia cada
vez y el delta —la promesa de la pantalla— pasa a ser ruido.

**Pegas.**
- **Circularidad**, y es la objeción de fondo: casos derivados del KB prueban si
  el agente sabe recitar el KB. **Por construcción no pueden descubrir lo que al
  KB le falta** — que es justo lo que la demo de la ferretería presume de
  encontrar. Se puede pedir al generador una fracción de casos "adyacentes pero
  no cubiertos", pero eso es pedirle que adivine los puntos ciegos del negocio,
  que es lo único que no puede saber.
- Un KB pobre produce un examen pobre y **un score halagador**.
- Coste: una llamada por regeneración (despreciable frente a la corrida).

### (c) Sacados de conversaciones reales pasadas

**Qué habría que construir.** Selección (¿qué conversaciones? ¿cerradas?
¿las que escalaron? ¿recientes?), extracción de **solo los turnos del cliente**,
anonimización (nombres y teléfonos aparecen en el texto), revisión y aprobación,
almacenamiento y una política de cuántos casos. Es el más caro de los tres, y con
diferencia.

**Negocio recién desplegado.** El peor, y **está medido**: en el ensayo del
Principio X del 2026-09-08 restauré el respaldo real de LanCo —una instancia
desplegada y en uso— y tenía **1 conversación y 18 mensajes**. Los volcados de
ILTU (86 KB) y NuriaAndrea (80 KB) son del mismo orden. **Ninguna instancia de la
flota podría hoy fabricarse un examen con sus conversaciones reales.** (c) es un
camino que sólo se abre tras meses de uso.

**Determinismo.** Se conserva: vuelven a ser cadenas fijas.

**Pegas.**
- El arranque en frío de arriba, que hoy es total.
- Una conversación real contiene **las respuestas del agente de entonces**;
  replicar sólo los turnos del cliente es una re-escenificación, no la original —
  el cliente real decía lo que decía *porque* el agente le había contestado algo.
- **Sesgo de selección**: si eliges las que salieron mal mides la cola; si eliges
  al azar mides "hola, ¿precio?".
- **Privacidad (Principio I)**: las palabras de un cliente real pasan a ser un
  fixture permanente, replicado y visible en la pantalla del Laboratorio. Matiz
  honesto: ese texto **ya** pasa por el LLM en operación normal, así que lo nuevo
  no es la exposición sino **la repetición y la permanencia**.
- Los mensajes con adjuntos no se pueden replicar.

### La combinación existe, y no la elijo

(b) o un juego neutro para el día 0 · (a) como control del dueño · (c) como
**fuente de candidatos** cuando haya material ("estas 8 preguntas te las hicieron
de verdad: ¿cuáles conviertes en casos?"). Las tres piezas encajan porque las
tres acaban escribiendo en la misma tabla. Lo digo porque es información para
decidir, no porque haya elegido.

---

## 3. Qué compra el determinismo, y qué costaría abandonarlo

**Dónde está hoy.** Sólo en el **cliente**. El agente y el juez ya son LLM: dos
corridas del mismo examen **ya** pueden dar scores distintos. Lo que el cliente
fijo garantiza no es reproducibilidad total, es **que el examen sea el mismo**.

Con eso pagas cuatro cosas:

1. **Que el delta signifique algo.** Es la promesa de la pantalla. Con examen
   variable, "subiste 12 puntos" no dice si mejoró el agente o si el examen fue
   más fácil.
2. **Depurabilidad**: un caso rojo se lee entero y se reproduce.
3. **El self-test**: con el `ai-mock`, la cadena entera es determinista de punta a
   punta. Es lo que permite que el Laboratorio se pruebe sin gastar tokens.
4. **Coste acotado**: hoy una corrida son ~22 llamadas del agente + 6 del juez
   (el juez puede ir a un modelo más barato con `OPENROUTER_JUDGE_MODEL`).

**Conclusión operativa**: el determinismo del cliente **no hay que abandonarlo en
ninguno de los tres caminos**. Lo que hay que decidir es **cuándo se fija el
examen**. Generar y persistir = sigue determinista. Generar por corrida = se
pierde la comparabilidad, que es lo caro; la palabra "determinismo" se queda
corta para nombrar eso.

---

## 4. Problema 2 — el camino de aplicar sugerencias al KB

### Lo que hoy protege (y una corrección al planteamiento)

**No es un clic.** Son dos pasos: "Agregar al conocimiento" abre un formulario
**editable** con la pregunta y la respuesta sugeridas, y el escritura ocurre al
pulsar "Guardar en el KB", con ambos campos obligatorios y no vacíos.

Protecciones reales, las tres que hay:

1. **Autenticación y alcance por organización**: `withAuth` + `scoped()` sobre el
   `caseId`; la entrada se escribe con el `organizationId` de la sesión. No hay
   escritura cruzada entre inquilinos.
2. **Validación de forma**: Zod, pregunta ≤ 500 y respuesta ≤ 4000 caracteres.
3. **El paso de edición**: el texto del juez se puede corregir antes de guardar.

### Los huecos, que son más de los que parecía

1. **`hallazgoIndex` se acepta y NO se usa nunca.** El endpoint no comprueba que
   el caso tenga un hallazgo en ese índice, ni que el texto guardado tenga nada
   que ver con la sugerencia. En la práctica, `/api/lab/suggestions/apply` es
   *"crea una entrada de KB con el texto que quieras, dado un caseId de tu
   organización"*: un duplicado de `POST /api/kb` con un contrato **más débil**.
2. **No queda constancia del origen.** `kb_entry` no tiene ningún campo de
   procedencia. Una entrada nacida de una sugerencia del Laboratorio es, al
   segundo siguiente, **indistinguible** de una que escribió el dueño a mano.
   Esto es lo que hace difícil deshacer — no que falte el borrado.
3. **No es idempotente.** No hay UNIQUE por (organización, pregunta), y el
   "Agregado ✓" es estado local del componente: recargas la página y puedes
   aplicar la misma sugerencia otra vez, con entrada duplicada. Duplicar una P/R
   en el KB no es inocuo: el KB entero se inyecta en el prompt del agente.
4. **No se dice la consecuencia.** La entrada entra en el prompt del agente **en
   el turno siguiente**, contra clientes reales. La pantalla no lo menciona. El
   KB además tiene presupuesto (~24.000 caracteres, con aviso en la UI): una
   racha de sugerencias aplicadas se lo come en silencio.

### Qué haría falta para que no pueda pasar por accidente

- **Procedencia en `kb_entry`** (`source`, `sourceCaseId`). Es el habilitador de
  todo lo demás: sin ella no hay lista, ni filtro, ni deshacer dirigido.
- **Que el endpoint verifique el hallazgo** y guarde qué se sugirió frente a qué
  se guardó — o que desaparezca y se use `POST /api/kb` con procedencia.
- **Idempotencia**: rechazar (o proponer actualizar) cuando ya existe una pregunta
  igual en esa organización.
- **Deshacer a la vista**: tras aplicar, enlace a la entrada creada y un
  "Deshacer" mientras la corrida sigue en pantalla.
- **Decir dónde cae y qué cambia** en la confirmación.

### ¿Se puede deshacer hoy?

**Sí, pero a ciegas.** `DELETE /api/kb/:id` y `PATCH` existen, y el KB se lista en
la pantalla del agente ordenado por fecha de creación ascendente, así que la
entrada recién aplicada es la última. Pero **nada la enlaza con el hallazgo que la
originó** y el Laboratorio no da ningún enlace: deshacer es encontrarla a ojo. En
un KB de tres entradas es trivial; en uno de sesenta, no.

---

## 5. ¿Se pueden borrar las corridas?

**Confirmado: no desde el producto, y hay más de lo que sabíamos.**

- **No existe `DELETE`** de corridas ni de casos: los únicos `DELETE` de la API
  son de KB, etapas del pipeline, suscripciones de push y credenciales. Tampoco
  hay botón, ni archivar, ni ocultar.
- El historial devuelve **las últimas 50** (`limit(50)`): una corrida vieja
  desaparece de la lista, pero **sigue en la base**.
- **Sí hay un camino que las borra, y es una escopeta**: `seedDemo()` hace
  `DELETE` de `agent_test_case` y `agent_test_run` de la organización… **y
  también de todo `kb_entry` de la organización**. Se llega por `POST
  /api/seed/demo` (sólo si `isDomainEmpty()`) o por CLI con `--force`.
- **Consecuencia de las claves foráneas** para cualquier borrado futuro:
  `agent_test_case.run_id` cae en cascada con la corrida, pero
  `agent_test_case.conversation_id` es `set null`. Es decir, **borrar una corrida
  deja huérfanas sus conversaciones `is_test` y sus mensajes**, invisibles en la
  bandeja pero vivos en la base. Una función de borrado tiene que decidir qué
  hace con eso.
- `cleanupOrphanRuns()` al arranque sólo marca `running` → `failed`. Una corrida
  fallida también se queda para siempre.

**Lectura**: hoy toda evaluación es permanente, y la única salida es un seed
destructivo que además borraría el conocimiento del negocio. Eso condiciona
cuánto se puede experimentar, y es argumento suficiente para que la 021 incluya
borrar (o archivar) corridas.

---

## 6. Otros hallazgos del Laboratorio que no sabíamos

1. **`seedDemo()` borra el KB entero de la organización**, no sólo las entradas
   demo. Y el guardia de la API, `isDomainEmpty()`, **sólo mira si hay
   contactos**: una organización que configuró su conocimiento y todavía no tiene
   contactos pasa el filtro y **pierde su KB** al cargar la demo. Es el gemelo
   destructivo del problema 2 y no está en el encargo, pero conviene decidirlo.
2. **`seedDemo()` busca los contactos previos sin filtrar por organización**
   (`where(inArray(contact.phone, demoPhones))`, sin `organization_id`). Es una
   violación del Principio III. Hoy es inerte —una instancia, una organización—
   pero es una mina si eso cambia.
3. **`pide_humano` nunca llega al modelo**: `matchesHandoffIntent()` la atrapa por
   patrón antes del LLM. Una de las seis "evaluaciones del agente" no evalúa al
   agente.
4. **El juez no sabe qué se espera de cada caso**. Recibe el nombre de la persona
   y una rúbrica genérica; no hay resultado esperado por caso. Cualquier rediseño
   puede arreglar esto casi gratis y mejoraría el score más que cambiar los
   guiones.
5. **El Laboratorio no está en el arnés automático.** Su guion (`us4-lab.md`) es
   manual; lo único que lo ejercita solo es el escenario C del arnés de push
   (020), y de refilón.
6. **El estado vacío promete "6 clientes simulados"**, número cableado en el
   texto de la UI. Otro sitio a tocar.
7. **El score no dice sobre cuántos casos se calcula en el historial** —donde
   vive el delta—, aunque el reporte sí avisa de los `judge_failed` excluidos. Un
   score de 100 sobre un caso juzgado y cinco fallidos se ve, en la lista, igual
   que un 100 limpio.
8. **Las conversaciones de prueba se acumulan**: cada corrida crea 6 nuevas
   (los contactos sí se reutilizan). Invisibles en la bandeja, accesibles por id,
   y sin nadie que las recoja nunca.
9. **El Laboratorio salta el interruptor global del agente**
   (`if (!conversation.isTest && !profile.enabled) return`): se puede evaluar el
   comportamiento configurado antes de encender el agente. Deliberado y bien.
10. **Coste de una corrida**: ~22 llamadas del agente + 6 del juez con los guiones
    actuales. No es gratis experimentar, y hoy además no se puede borrar el
    resultado del experimento.

---

## 7. Lo que hay que decidir antes de escribir la spec

1. **De dónde salen los casos**: (a), (b), (c) o la combinación — y, si hay
   combinación, **qué entra en la 021 y qué se aparta**.
2. **Qué recibe una instancia el día 0**: ¿juego neutro incluido, o Laboratorio
   vacío hasta que alguien escriba?
3. **Cuándo se fija el examen**, si hay generación: una vez y revisado, o por
   corrida. (De esto depende que el delta siga significando algo.)
4. **Qué pasa con el historial cuando el examen cambia**: ¿se fija el juego en
   cada corrida y se avisa en la lista?
5. **Borrado de corridas**: ¿entra en la 021? ¿Y qué se hace con las
   conversaciones `is_test` que quedarían huérfanas?
6. **Alcance del problema 2**: ¿procedencia + idempotencia + deshacer, o sólo lo
   mínimo para que no se escriba por accidente?
7. **Los dos hallazgos de `seedDemo`** (borra el KB; consulta sin `organization_id`):
   ¿021, o feature aparte?
8. **La rúbrica del juez** (no distingue "no lo sabía" de "no debía saberlo"):
   ¿021 o aparte? Es barato y afecta al score más que los guiones.
