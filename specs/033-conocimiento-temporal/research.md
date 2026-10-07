# Research: 033 — Conocimiento temporal

Decisiones de diseño, cada una con lo que se eligió, por qué y qué se descartó. La base
es la 007 de Kosmo (`kosmo-crm/specs/007-conocimiento-temporal`, commit `ce3aea7`): lo
que se hereda tal cual se dice; lo que en Uniko tiene que ser distinto, también, con su
porqué.

---

## D-01 — El estado se DERIVA, no se almacena *(heredada)*

**Decisión**: «vencida» no es una columna ni un flag: es comparar `valid_until` con hoy,
en cada lectura.

**Por qué**: un estado guardado exige un proceso que lo actualice, y ese proceso es un
sitio donde fallar en silencio: si un día no corre, el agente pasa el día afirmando
datos vencidos y nada avisa. Una comparación no puede «no haber corrido».

**Descartado**: columna `is_expired` mantenida por un job; mover la fila a una tabla de
archivados al vencer (hay que deshacerlo al renovar y rompe la identidad de la entrada).

---

## D-02 — Una FECHA, inclusiva *(heredada)*

**Decisión**: `valid_until` es `date`, no `timestamp`. La entrada vale todo el día
indicado y deja de valer al empezar el siguiente, en la zona del negocio.

**Por qué**: el dueño piensa «la promoción es hasta el 15», no «hasta el 15 a las
23:59:59». «Hasta el 15» incluye el 15 en español; excluyente, la entrada moriría la
noche del 14.

**Descartado**: `timestamp` con hora elegible (precisión falsa); `timestamp` normalizado
a fin de día al guardar (congela la zona horaria en el dato).

---

## D-03 — Una sola puerta de lectura y un guard anclado a la RAÍZ *(heredada)*

**Decisión**: toda lectura de `kb_entry` pasa por `src/server/kb/vigencia.ts`. Una prueba
escanea `src/` y falla si `from(schema.kbEntry)` (o `from(kbEntry)`, o
`query.kbEntry`) aparece en cualquier otro archivo.

**Por qué**: el riesgo de la feature no es la columna, son los **seis lectores**: el
agente (`pipeline.ts`), la API del bot (`api/bot/profile`), la pantalla (`api/kb`), el
contador (`api/kb/size`), el juez (`lab/runner.ts`) y el generador (`lab/generar.ts`).
Filtrar cinco y olvidar uno no rompe nada visible: el producto miente. Y el séptimo
lector, el que alguien añada mañana, no tiene forma de enterarse de la regla. El mismo
patrón ya sostiene la bitácora de etapas (`stage-history-guard.test.ts`): prohibir en
la raíz, con la excepción anclada a la ruta concreta.

Las escrituras (`insert`/`update`/`delete` en las rutas del CRUD, la sugerencia del
juez y el seed) no pasan por la puerta: no leen, así que no pueden afirmar nada vencido.

**Descartado**: repetir el filtro en cada consulta; una vista `kb_entry_vigente` en la
base (alguien consulta la tabla en vez de la vista y nada lo detecta).

---

## D-04 — El corte va en CÓDIGO, no en SQL *(desvío de Kosmo)*

**Decisión**: la puerta trae todas las entradas de la organización (con `scoped()`) y
filtra con una función pura (`soloVigentes(entradas, hoy)`).

**Por qué**: Kosmo puso el corte en el `where` (su D-04). Aquí no se puede: el doble de
base de las pruebas unitarias de Uniko **ignora el `where`**, así que un filtro en SQL
sería invisible para cualquier unitario. Es la lección de los dos bugs de la agenda que
encontró el dueño en WhatsApp real con 824 tests verdes (`agenda-cita-actual.test.ts`,
memoria «fallos que solo aparecen con el tiempo»): un corte temporal se decide en código
para que una prueba pueda verlo.

El argumento de Kosmo para el SQL —que el contador de tamaño no mienta y que ningún
consumidor tenga que acordarse del descarte— se cumple igual: el descarte vive DENTRO
de la puerta, y el contador lee por la puerta. Traer todo no cuesta: el conocimiento
entero ya se inyecta en cada turno, así que es por construcción del tamaño de un prompt.

---

## D-05 — La zona del negocio: la de la agenda o México

**Decisión**: una función `zonaDelNegocio(organizationId)` en `src/server/negocio/zona.ts`:
con `AGENDA` encendida devuelve la zona de la agenda (`getSettings().timezone`); si no,
`ZONA_DEL_PRODUCTO = "America/Mexico_City"`. La constante vive en
`src/lib/time/zona.ts` y el `DEFAULT_TIMEZONE` de la agenda pasa a ser esa misma
constante (un solo valor, no dos que diverjan).

**Por qué**: decisión del dueño (Q4): México para todos por ahora. Pero la agenda ya
deja elegir zona, y en un mismo turno «hoy» tiene que ser el mismo día para la fecha del
prompt, los horarios de la agenda y el corte del conocimiento (FR-1804). Con la agenda
apagada no se lee su fila aunque exista (la agenda estuvo encendida antes): un ajuste de
un módulo apagado no gobierna nada.

**Descartado**:
- **Fijar México en todo** (lo que hizo Kosmo): casi igual, pero con la agenda en otra
  zona habría dos «hoy» en el mismo turno.
- **Una zona propia del negocio** (columna nueva + ajuste en la pantalla + que la agenda
  lea de ahí): es lo correcto el día que haya un negocio fuera de México; hoy obliga a
  tocar la agenda recién estabilizada para un valor que todos llenarían igual. El
  comentario de `pipeline.ts` que pedía esto se reescribe para apuntar a esta función.

---

## D-06 — El corte se evalúa en cada turno *(heredada)*

**Decisión**: el agente resuelve el conocimiento vigente en cada turno. **Por qué**: una
conversación de WhatsApp dura días. Costo cero: el pipeline ya lee el conocimiento en
cada turno; cambia por dónde lo lee. **Efecto aceptado**: la respuesta de ayer puede ser
el «lo confirmo» de hoy: el dato dejó de ser verdad entre las dos.

---

## D-07 — El CRUD devuelve TODO, con el estado calculado por el servidor *(heredada)*

**Decisión**: `GET /api/kb` devuelve todas las entradas, cada una con `validUntil` y
`estado` (`vigente` | `por_vencer` | `vencida`). **Por qué**: el dueño ve lo suyo entero,
y la pantalla necesita las tres categorías a la vez. Si el estado lo calculara el
navegador, dependería del reloj y la zona del dispositivo del dueño, y vería estados
distintos de los que el agente aplica.

---

## D-08 — «Por vencer» = 14 días, constante del producto *(heredada)*

Dos semanas dan tiempo a reaccionar sin que la marca esté encendida siempre. Cambiar una
constante es más barato que retirar un ajuste que alguien ya configuró.

---

## D-09 — Migración: una columna nullable, sin backfill y sin índice *(heredada)*

`NULL` = permanente = el comportamiento de hoy: SC-002 se cumple por construcción. Sin
índice: la lectura siempre va por organización (`kb_org_idx`) y el corte es en código.
Re-ejecutable (`ADD COLUMN` dentro del registro de migraciones de drizzle). Reversión:
redesplegar el commit anterior deja la columna sin uso (el código viejo hace `select()`
de todas las columnas y simplemente no la mira).

---

## D-10 — Laboratorio: el instante es el `started_at` de la corrida *(desvío de Kosmo)*

**Decisión**: la corrida evalúa el conocimiento contra su propio `started_at` (el valor
que devuelve el `insert` de la corrida) y pasa ese mismo instante a cada turno del
agente de prueba (`runAgentTurn(id, { ahora })`) y al juez. Sin columna nueva.

**Por qué**:
- Kosmo agregó `agent_test_run.evaluated_at` para registrar el instante, pero su agente
  de prueba seguía tomando su propio `new Date()` en cada turno: si la corrida cruza la
  medianoche, el juez evalúa contra el conocimiento del día en que empezó y el agente
  contesta con el del día siguiente — exactamente el «rojo fabricado» que su FR-030
  quería evitar. Aquí el instante se pasa al agente.
- Con el instante = `started_at`, el registro existe por construcción: no es «suponer
  que se evaluó cuando empezó», es que se evalúa contra ese valor. La columna de Kosmo
  sobra y la migración queda en una sola columna.

**Consecuencia**: en el Laboratorio, la fecha del prompt del agente queda fija en el
inicio de la corrida (dura minutos). Los separadores de día del historial tratan como
«de hoy» lo que llegue después de ese instante (ver D-11).

**Descartado**: columna `evaluated_at` (redundante con `started_at`); resolver por
turno en el Laboratorio (el juez evaluaría contra otro mundo al cruzar la medianoche).

---

## D-11 — Fecha y separadores de día SIEMPRE *(extensión de Uniko)*

**Decisión**: `pipeline.ts` calcula la zona con `zonaDelNegocio()` en todos los turnos:
`AHORA ES:` y `withDayMarkers()` dejan de depender de la agenda. En `withDayMarkers`,
«anterior» pasa a ser «de un día ANTES de hoy» (antes: «de un día distinto de hoy»),
para que un mensaje posterior al instante fijo del Laboratorio cuente como de hoy.

**Por qué**: Kosmo dio la fecha a todos en su #30; en Uniko solo existía con agenda
(015, ajuste 2026-09-26), porque la zona salía de la agenda. Sin fecha, ninguna regla
temporal sirve en los dos clientes de la flota, que no tienen agenda. La línea de la
fecha añade «y del conocimiento»: también hay fechas escritas en el texto de entradas
sin vigencia.

---

## D-12 — La regla del historial *(extensión de Uniko)*

**Decisión**: una regla dura nueva en el prompt (siempre, no solo con agenda): lo dicho
en mensajes de días anteriores sobre promociones, precios, fechas, cupos o inscripciones
pudo cambiar; no se repite como vigente; lo vigente es el conocimiento de hoy y, si ya
no aparece, se ofrece confirmarlo.

**Por qué**: Kosmo no lo cubrió. Ocultar una entrada vencida no basta si el agente la
encuentra en su propio mensaje de hace tres días («la promo es hasta el 15»): ese texto
sigue en el hilo y el modelo lo puede repetir. Es la misma familia que la regla de la
agenda («un "mañana a las 10" dicho hace dos días ya pasó»), generalizada al
conocimiento. Los separadores de D-11 son lo que le permite al modelo saber qué es «de
días anteriores».

**Límite honesto**: el ai-mock no puede probar que un modelo real obedece una regla; los
unitarios prueban que la regla y los separadores llegan al prompt. La obediencia se
verifica en vivo en la instancia de pruebas.

---

## D-13 — El ai-mock contesta según el conocimiento que recibió *(heredada)*

**Decisión**: si el mensaje del cliente trae un tema marcado `KBTOK-<algo>`, el mock
busca ese tema en la sección del conocimiento de su prompt (entre «CONOCIMIENTO DEL
NEGOCIO» y «Etapas del pipeline») y responde `SI_CONOZCO <tema>` o
`NO_CONOZCO <tema>: no cuento con esa información, la confirmo con el equipo.`.

**Por qué**: el mock responde con eco a todo lo que no reconoce
(`"Respuesta de prueba sobre: …"`): contestaría igual supiera o no supiera, y la prueba
principal pasaría siempre midiendo nada. Kosmo cayó en esto y lo encontró su arnés. El
gancho por token no cambia ninguna respuesta existente (nadie manda `KBTOK-`), así que
los checks que esperan el eco siguen igual.

---

## D-14 — La pantalla: fecha por entrada, por vencer, obsoletos y edición de texto

**Decisión**: en la tarjeta del conocimiento: (a) una fecha opcional «Vigente hasta» en
el alta (vale para P/R y bloque), con la explicación de FR-1802; (b) en cada entrada, su
fecha editable, «Hacer permanente» y la marca de estado; (c) un aviso con el número de
entradas por vencer; (d) la sección «Conocimiento obsoleto» solo si hay alguna; (e)
**editar el texto** de cualquier entrada (Editar → Guardar/Cancelar), que hoy no existe.

**Por qué (e)**: renovar sin poder corregir el texto deja una contradicción («hasta el 15
de octubre» renovada a noviembre). La API ya acepta `PATCH` del texto; faltaba la
pantalla. Kosmo lo pedía en su FR-023 y solo lo entregó en la API.

---

## D-15 — Validación de la fecha *(heredada, con la convención de Uniko)*

**Decisión**: `fechaDeVigencia` (zod) exige `AAAA-MM-DD` y hace la ida y vuelta por
`Date` para rechazar «2026-02-31», sin lanzar (`toISOString()` lanza con una fecha
inválida y saldría como 500). El error sale por `parseBody`: `422 invalid_body` con el
mensaje que dice qué se esperaba (la convención del proyecto; Kosmo lo había planeado
como 400 y lo corrigió). En `PATCH`, campo ausente = no tocar, `null` = quitar, fecha =
poner o mover.

---

## D-16 — Sin bandera de despliegue

**Decisión**: la feature va sin bandera. **Por qué**: el Principio de módulos opcionales
es para lo que no usa toda instancia (canales, agenda, conectores con terceros). Esto es
una propiedad del conocimiento, que todas usan, sin terceros, y sin fechas no cambia
nada del conocimiento (D-09). Lo único que cambia para todas es que el agente sabe la
fecha (D-11): es la mitad de la feature y el dueño lo aprobó.
