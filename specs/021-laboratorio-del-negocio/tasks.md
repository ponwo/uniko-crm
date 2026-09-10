# Tasks: 021 — El Laboratorio sigue al negocio

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## Format: `[ID] [P?] Description`

`[P]` = puede ir en paralelo con las demás marcadas `[P]` del mismo bloque.

---

## ⛔ Dos reglas de orden

### 1. El test de la regresión va ANTES de reescribir los guiones

T004 escribe el test que afirma que ningún guion nombra un giro concreto, y se
ve **fallar contra los guiones de ferretería** antes de tocarlos. Un test
escrito después de la corrección pasa a la primera y nunca demuestra que
detecta nada.

### 2. El arnés se falsifica antes de darlo por bueno

T012 no está hecha cuando el arnés pasa: está hecha cuando se ha comprobado que
**falla** si se rompe a mano lo que dice comprobar. Un arnés verde que no
falsifica nadie es un arnés que afirma sin mirar.

---

## Entrega 1 — Los seis dejan de ser una ferretería

### Fase 1: La red, antes del cambio

- [x] **T001** Leer `src/server/lab/personas.ts` entero y anotar, por persona,
      qué mide hoy. Es la entrada de FR-602: la reescritura tiene que conservar
      la medición, no solo el nombre.
- [x] **T002** Confirmar contra `src/server/ai/handoff.ts` qué frase exacta de
      `pide_humano` dispara `HANDOFF_BACKUP_REGEX` (FR-604).
- [x] **T003** [P] Confirmar que ningún test de unidad afirma hoy el contenido
      de un guion. Si alguno lo hace, entra en el alcance.
- [x] **T004** `tests/unit/lab-personas.test.ts`: (a) ningún guion contiene
      términos de giro concreto; (b) las seis claves siguen siendo las de
      siempre; (c) `pide_humano` dispara `matchesHandoffIntent()`.
      **Se corre y se ve FALLAR (a) contra los guiones actuales.**

### Fase 2: Los guiones

- [x] **T005** Reescribir los seis `script` de `PERSONAS` agnósticos de giro
      (FR-601). Claves, `phone`, `label` y `contactName` **sin tocar** (D1).
- [x] **T006** Añadir a cada persona el comentario de **qué mide** y qué se
      rompe si se reescribe (FR-603).
- [x] **T007** Correr T004: los tres checks en verde.

### Fase 3: El mock deja de hablar de ferretería

- [x] **T008** `src/server/dev/ai-mock.ts`: el gancho del juez pasa de
      `garant|devoluc` a cancelaciones/reembolsos (D2, FR-605). La mecánica y
      la aritmética (83 → 100, delta +17) no cambian.
- [x] **T009** Comprobar que la rama de `pide_humano` del mock sigue
      disparando con el guion nuevo.

### Fase 4: El arnés — lo que hoy no existe

- [x] **T010** `scripts/e2e-lab.mjs` nuevo, siguiendo el patrón de
      `scripts/e2e-push.mjs` y reutilizando `contextoConSesion()`. Los seis
      checks de D3, incluido el **outbox vacío** del sandbox.
- [x] **T011** Encadenarlo en `test:e2e` (`package.json`).
- [x] **T012** **Falsificar el arnés**: romper a mano cada cosa que dice
      comprobar y ver que se pone rojo. Sin esto T010 no está hecha (regla 2).
- [x] **T013** `tests/e2e/us4-lab.md` al día: el tema cambia, los números no.
      Anotar que ya tiene arnés y cuál.

### Fase 5: El gate y el cierre

- [x] **T014** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
      verde.
- [x] **T015** Los arneses que este cambio puede alcanzar, en verde contra la
      app viva con mocks: `e2e-selftest.mjs`, `e2e-lab.mjs` y `e2e-push.mjs`
      (por su escenario C del Laboratorio). `e2e-sse-reconexion.mjs` y
      `e2e-pwa.mjs` quedan fuera con su razón — ver el registro al final.
- [x] **T016** Marcar como **pendiente de verificación humana** lo único que no
      se puede automatizar: que un guion neutro le sirva a un negocio real
      (plan, "Lo que NO se puede verificar automáticamente").

---

## Entrega 2 — El juez deja de castigar el escalado

> **El alcance cambió antes de escribir código**, con la corrida real de LanCo
> del 2026-09-10. La premisa original —que la rúbrica castiga declinar bien—
> **se cayó**: ese caso era el único verde. Lo que apareció es peor y es lo que
> se implementa aquí. Evidencia completa en el spec, "La corrida de LanCo".

### Fase 1: El hecho, antes de la rúbrica

- [x] **T101** Verificar en el código que `judgeCase()` no recibe el escalado y
      que `applyHandoff` puede no dejar mensaje (`farewell` opcional; el
      respaldo por patrón nunca escribe). Sin esto, el diagnóstico es una
      conjetura sobre un reporte.
- [x] **T102** `Persona` gana `expected`: el resultado esperado del escenario,
      en palabras, para el juez (FR-611). Las seis lo declaran; el de
      `pide_humano` dice que escalar **es** el acierto.
- [x] **T103** `runConversation()` devuelve `handoff: {ocurrio, motivo}`, leído
      de `handoffAt`/`handoffReason` (FR-610). No se deduce del transcript: ahí
      es invisible.
- [x] **T104** `judgeCase()` y `buildJudgePrompt()` aceptan y transportan las
      dos cosas.

### Fase 2: La rúbrica

- [x] **T105** Reescribir la rúbrica: prohibir deducir el escalado del texto
      (FR-610); escalado esperado = acierto (FR-612); `debio_escalar` acotado a
      que NO hubo escalado (FR-613); el final sin respuesta tras escalar no es
      silencio (FR-614); declinar bien sigue sin ser hallazgo (FR-615).
- [x] **T106** `tests/unit/judge-rubrica.test.ts`: 10 checks sobre el prompt y
      sobre las personas. **Falsificado** — ver el registro.

### Fase 3: Que el arnés proteja el arreglo

- [x] **T107** El `ai-mock` **modela** la rúbrica nueva: `pide_humano` sale
      verde solo si el prompt dice que hubo escalado. Sin el hecho, devuelve
      `debio_escalar` y el score cae de 83 a 67.
- [x] **T108** Check nuevo en `scripts/e2e-lab.mjs`: *"el juez NO lo castiga:
      pide_humano sale verde y sin hallazgos"*.
- [x] **T109** **Falsificar**: quitar el hecho del prompt y ver el arnés rojo.

### Fase 4: Gate y cierre

- [x] **T110** Los cuatro gates en verde.
- [x] **T111** Arneses alcanzables en verde contra base limpia.
- [x] **T112** Pendiente de verificación humana: la corrida de LanCo **con la
      rúbrica nueva**, para confirmar contra modelos reales lo que el mock
      afirma de forma determinista. **HECHA el 2026-09-10** — ver abajo.

> **FR-616 NO entra en la Entrega 2, y esto es la corrección de un descuido.**
> El requisito —que un cambio de rúbrica se vea en el histórico— se escribió en
> el spec de la Entrega 2 y la entrega se dio por hecha sin él.
>
> No es un olvido de implementación: hacerlo bien exige **versionar la rúbrica
> junto al sello del conjunto**, y eso es una columna en `agent_test_run` →
> toca `drizzle/` → ensayo del Principio X. Pertenece a la **Entrega 3**, que
> ya abre esa puerta para el sello. Lo que sí fue descuido es no haberlo dicho
> aquí en su momento; se corrige en el PR de la 023.

---

## Cómo salió de verdad — Entrega 2, 2026-09-10

**La regla del plan se cobró su valor.** El plan (D4) decía que esta entrega se
escribía mirando veredictos reales, no desde el diseño. Si se hubiera escrito
desde el plan, habría arreglado **lo que ya funcionaba** y dejado intacto el
defecto que de verdad hundía el score.

**La falsificación, en dos frentes:**

- **Unidad**: quitar la línea del escalado del prompt e invertir la regla de "no
  lo deduzcas" pone rojos 4 de los 10 checks.
- **Arnés**: quitar el hecho del prompt tumba 5 checks — el score cae **83 → 67**
  y `pide_humano` sale rojo con `debio_escalar`, que es exactamente el fallo
  observado en LanCo. El arnés ahora **protege el arreglo**; antes habría pasado
  verde sin probar nada.

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` | limpios |
| `test` (unidad) | **538 pasan**, 63 archivos (10 nuevos) |
| `scripts/e2e-lab.mjs` | **20/20** (base limpia) |
| `scripts/e2e-selftest.mjs` | **103/103**, sin daño colateral |

### T112 — la corrida de LanCo con la rúbrica nueva (2026-09-10)

Corrida contra `main` @ `456df0d`, modelos reales. **Score 75: 3 verdes, 3
amarillos, 0 rojos** (antes: 42, con 2 rojos).

**La prueba no es el número, son dos casos casi controlados:**

| Caso | Qué hizo el agente | Antes | Ahora |
|---|---|---|---|
| `pide_humano` | escaló, mudo — transcript de forma **idéntica** | `debio_escalar` | **limpio** |
| `cliente_enojado` | escaló con mensaje, las dos veces | `fuera_de_kb` | **limpio** |

Cambió el juez, no el agente. `errores_modismos` perdió además el hallazgo que
citaba literalmente *"AGENTE: [sin respuesta]"*.

**El control negativo aguantó**: la alucinación de `comprador_decidido` **sigue
ahí**. La rúbrica dejó de castigar el escalado sin ablandarse con lo inventado —
que era el riesgo de este cambio.

**El +33 no es atribuible y se dice**: `pregunton_precios` y `errores_modismos`
corrieron el guion completo esta vez y antes se cortaron. Son conversaciones
distintas, no la misma medida repetida. Es FR-616 en carne viva: la pantalla
presenta como mejora del agente lo que en parte es cambio de examen.

**Lo que la corrida dejó de regalo**: quitado el ruido, casi todos los hallazgos
restantes son la misma familia — el agente inventa alrededor del *diagnóstico
gratuito* y el proceso de pago (*"el diagnóstico gratuito no expira"*, *"el
consultor sí puede revisar paquetes"*, *"el pago se coordina directo con el
equipo"*). Un hueco concreto del conocimiento de LanCo, encontrado por el
Laboratorio. Que es para lo que existe.

---

## Entrega 3 — El negocio genera sus escenarios

**Toca `drizzle/`.** Es el primer cambio de esquema desde la 020, así que
arrastra el ensayo del Principio X y plan de reversión declarado en el PR.
Diseño en [plan.md](plan.md), D5 a D9.

### ⛔ Regla de orden: la migración se ensaya ANTES de construir encima

T204 (el ensayo) va antes que la Fase 2. Si el ensayo destapa algo, cambiar el
esquema con medio producto construido encima cuesta el triple — y la migración
es lo único de este proyecto que no se arregla volviendo atrás.

### Fase 1: El esquema — la parte irreversible

- [x] **T20' `schema.ts`: tabla `lab_scenario` y las columnas
      `scenario_set` y `rubric_version` en `agent_test_run`, **ambas
      nullable** (D5). Índices únicos `(org, key)` y `(org, phone)`.
- [x] **T20' `pnpm db:generate` → migración nueva en `drizzle/`.
- [x] **T20' **Leer el SQL generado a mano**: que sea aditivo puro — sin
      `DROP`, sin `ALTER … SET NOT NULL` sobre tabla con datos, sin
      `DEFAULT` que reescriba filas. Drizzle acierta casi siempre; "casi" no
      es un gate.
- [x] **T204** **Ensayo del Principio X**: respaldo real restaurado en un
      PostgreSQL desechable, migración corrida contra esa copia, app arrancada
      contra ella. **HECHO el 2026-09-10** — registro abajo.

#### El ensayo del Principio X — corrida del 2026-09-10

Registrado tal como pasó.

**Contra qué datos**: respaldo de **LanCo** —instancia real, en producción—,
ejecución `fudmvgnalivsnhimvegduhsh` del 2026-09-10 20:56 UTC,
`pg-dump-uniko-1789073816.dmp`, **106.697 bytes** (tamaño verificado contra lo
que reporta Coolify **antes** de restaurar nada). Descargado por el dueño desde
el panel: esa parte no se puede automatizar desde esta máquina y está explicado
en el [quickstart de la 020](../020-notificaciones-push/quickstart.md).

**Base desechable**: `uniko_ensayo_lanco_20260910` en el PostgreSQL 16 local.
Nunca `uniko_dev`, nunca una instancia de la flota. **Borrada al terminar**, y
comprobado: solo queda `uniko_dev`.

**Venía por detrás de la migración**, que es lo que hace que el ensayo pruebe
algo: 14 entradas en el diario de Drizzle (es decir, en la 0013), sin
`lab_scenario` y sin las dos columnas nuevas.

| Paso | Resultado | Tiempo |
|---|---|---|
| `pg_restore` del volcado | limpio, sin errores | **632 ms** |
| `drizzle-kit migrate` | `migrations applied successfully` | **1.317 ms** |
| `next start` contra la copia | `/api/health` → `{"ok":true}`, sin errores de arranque | — |

**Que es aditiva, medido y no supuesto.** Inventario de la misma base antes y
después:

| | antes | después |
|---|---|---|
| organizaciones | 1 | **1** |
| contactos | 8 | **8** |
| conversaciones | 14 | **14** |
| mensajes | 109 | **109** |
| entradas de KB | 4 | **4** |
| corridas del Laboratorio | 2 | **2** |
| casos del Laboratorio | 12 | **12** |

Y lo nuevo: `lab_scenario` creada y vacía con sus 4 índices, las 2 columnas
presentes, y **las 2 corridas preexistentes con `scenario_set` y
`rubric_version` en NULL** — que es exactamente lo que el diseño pide (D5): un
null dice "de esta no se sabe" en vez de inventarles un examen.

**Por qué este respaldo y no otro**: LanCo es la única instancia con corridas
del Laboratorio (2 corridas, 12 casos). La migración añade columnas a
`agent_test_run`, así que contra una base sin esas filas no se habría ejercido
la forma de los datos que la migración toca — que es justo lo que el Principio X
exige y lo que `seed:demo` no da.

### Fase 2: El modelo y sus guardarraíles

- [x] **T205** `src/server/lab/escenarios.ts`: rango de teléfonos reservado,
      derivación por hash de la clave, comprobación bloqueante contra contactos
      reales en las dos formas (D6, FR-628).
- [x] **T206** `validarGuion()`: entre 2 y 5 líneas, sin líneas vacías ni
      larguísimas, y **rechazo de líneas que dependen del contexto** —el
      cliente simulado no reacciona (FR-627).
- [x] **T207** CRUD: crear (con tope), editar, borrar **lógico** (FR-632).
- [x] **T208** Tests de T205–T207, **falsificados**.

### Fase 3: El sello y la rúbrica versionada

- [x] **T209** `src/server/lab/conjunto.ts`: `selloDeConjunto()` sobre el
      contenido, ordenado por clave, serializado con JSON (D8, FR-625).
- [x] **T210** Versión de rúbrica: constante junto a `buildJudgePrompt`, que se
      sube a mano cuando el prompt cambia (FR-616).
- [x] **T211** El runner guarda las dos en `agent_test_run`.
- [x] **T212** El histórico **avisa** cuando dos corridas difieren en sello o
      en rúbrica, en vez de mostrar un delta que no significa nada (FR-626).

### Fase 4: El runner concatena

- [x] **T213** `escenariosDe(org)` = los seis **+** los propios habilitados
      (D9, FR-624).
- [x] **T214** Las etiquetas del reporte se resuelven **sin filtrar por
      `enabled`**: borrar quita del futuro, no del pasado (FR-632).

### Fase 5: La generación

- [x] **T215** `buildScenarioPrompt()`: pide atacar los **huecos** del
      conocimiento (FR-621) y guiones que se sostengan sin saber qué contestó
      el agente (FR-627).
- [x] **T216** `src/server/lab/generar.ts`: `chatJson` con **el modelo del
      agente**, esquema permisivo y validación uno a uno (D7, FR-622).
- [x] **T217** Los caminos infelices con su mensaje: sin proveedor (FR-629),
      sin conocimiento (FR-630), respuesta inservible del proveedor.
- [x] **T218** El `ai-mock` sabe responder al prompt del generador de forma
      determinista, o el self-test de esta entrega no puede existir.
- [x] **T219** Rutas: listar, crear desde propuestas, editar, borrar, generar.

### Fase 6: La pantalla

- [x] **T220** Lista de escenarios propios, con su origen y su estado.
- [x] **T221** Revisar propuestas antes de confirmar: editar el texto y
      descartar las que no sirvan (FR-623).
- [x] **T222** Antes de correr, **anunciar** cuántos escenarios y cuánto tarda
      (FR-631).

### Fase 7: Verificación

- [x] **T223** Los cuatro gates en verde.
- [x] **T224** El arnés `e2e-lab.mjs` extendido: generar, confirmar, correr con
      los propios, y el aviso de sello distinto.
- [x] **T225** **Falsificar** lo nuevo del arnés.
- [ ] **T226** Pendiente de verificación humana: una corrida real en LanCo con
      escenarios generados de su propio conocimiento.

### MVP

**Fases 1 a 5.** Con eso el negocio ya genera y corre sus escenarios; la
pantalla (Fase 6) es lo que lo hace usable sin `curl`.

---

## Dependencies

- T004 antes que T005 (regla 1).
- T005 antes que T007, T008, T010.
- T010 antes que T011 y T012.
- T014 y T015 al final, sobre todo lo anterior.
- **Fuera de esta rama**: `gobernanza/bandas-fr` entra antes que el PR de esta
  feature — de ahí sale la banda FR-6xx.

## MVP

**Fases 1 a 3.** Con eso el Laboratorio ya deja de evaluar a NuriaAndrea e ILTU
con preguntas de tlapalería, que es el problema que abrió esta feature. Las
fases 4 y 5 son lo que impide que vuelva a pasar sin que nadie se entere — y
por la Definición de Hecho del proyecto, no son opcionales para declararla
terminada.

---

## Cómo salió de verdad — Entrega 1, 2026-09-09

Registrado tal como pasó, no como estaba escrito.

**Las dos reglas de orden se cumplieron, y sirvieron.**

- **T004 antes que T005**: el test se vio fallar contra los guiones de
  ferretería, señalando siete términos (`taladro`, `martillo`, `desarmador`,
  `clavo`, `lijadora`, `pintura`, `tiner`). Sin eso no habría forma de saber
  que detecta algo.
- **T012, la falsificación**, encontró lo que se buscaba en dos frentes:
  reintroducir `taladros inalámbricos` en un guion pone rojo **el test de
  unidad Y el arnés** (18/19, `— taladro`); cambiar la expectativa del outbox a
  `outboxAntes + 1` pone rojos los dos checks del sandbox (17/19). Los checks
  de score, veredicto, sugerencia y delta se falsificaron **solos**, ver abajo.

**Un fallo de montaje que valió la pena.** La primera corrida del arnés se hizo
contra la app en `next start` y dio 8 fallos con `score: null`. La causa no era
el Laboratorio: `isMockEnabled()` exige `NODE_ENV !== "production"`, así que en
modo producción **los mocks devuelven 404 por diseño** —la "instancia pública
endurecida" de la constitución— y el juez fallaba con `provider_error`. La
guarda hacía exactamente su trabajo. Quedó anotado en `tests/e2e/us4-lab.md`
para que nadie lo diagnostique dos veces, y de paso falsificó cinco checks.

**La base reutilizada mintió, y hubo que descartarlo.** El arnés principal daba
11 fallos contra `uniko_dev` —`window_closed`, medios, estado de handoff—.
Ninguno tocaba el Laboratorio, pero "no parece mío" no es una verificación. Se
creó una base desechable (`uniko_e2e_021`, creada y migrada con `db:dev`, y
borrada al terminar) y ahí el arnés principal dio **103/103**. Los once eran
datos viejos.

| Gate | Resultado |
|---|---|
| `typecheck` | limpio |
| `lint` | limpio |
| `build` | 0 errores |
| `test` (unidad) | **528 pasan**, 62 archivos |
| `scripts/e2e-selftest.mjs` | **103/103** (base limpia) |
| `scripts/e2e-lab.mjs` | **19/19** (base limpia, encadenado tras el anterior) |
| `scripts/e2e-push.mjs` | **31/31**, incluido "el Laboratorio no mandó NINGUNA notificación" (FR-503) |

`e2e-sse-reconexion.mjs` y `e2e-pwa.mjs` **no se corrieron**: no hay camino por
el que este cambio los alcance. Se dice en vez de dejarlo suponer.

**Divergencia de entorno declarada**: la máquina tiene **Node 24**, no el 22 que
exigen `.nvmrc` y `engines`. No se aflojó `engine-strict` —el `.npmrc` explica
por qué no— sino que se resolvieron las dependencias del checkout principal,
que comparte lockfile. La CI corre la matriz sobre Node 22, y es ahí donde esa
verificación cuenta.

**T016 — pendiente de verificación humana**: que un guion neutro le sirva a un
negocio real. Solo se sabe mirando una corrida de una instancia con su
conocimiento cargado.

---

## Cómo salió de verdad — Entrega 3, 2026-09-10

**La regla de orden se respetó**: el ensayo del Principio X (T204) se hizo
**antes** de construir encima. Su registro está más arriba.

**Tres cosas las encontró el trabajo, no el diseño:**

1. **`"El segundo, ¿cuánto?"` se escapaba del validador de guiones** por la
   coma: el matcher exigía un espacio detrás del comienzo sospechoso. Lo cazó
   el test. Ahora se pide que lo siguiente no sea letra ni dígito, y
   `"esotérico"` sigue sin confundirse con `"eso"`.
2. **Un regex mal escrito habría borrado los DÍGITOS** de las etiquetas al
   derivar la clave de un escenario. Invisible leyendo el código; hay test que
   lo fija.
3. **`contarEscenariosPropios` armaba su `WHERE` a mano** en vez de pasar por
   `scoped()`. Corregido: es la puerta que el Principio III exige y la que
   revienta con un `organizationId` vacío.

**Las falsificaciones, y una que se cobró un fallo del propio arnés:**

- **Tenant**: quitarle el `scoped()` a una lectura de `escenarios.ts` pone rojo
  el test con el SQL a la vista — `"lab_scenario"."enabled" = $1`.
- **Etiquetas (FR-632)**: dejar de resolver las etiquetas propias hace que el
  reporte enseñe **claves crudas** (`gen_pregunta_por_garantia_0_rsdcy`), que
  es exactamente lo que el requisito existe para impedir.
- Y esa falsificación destapó que **el arnés no era re-ejecutable**: limpiaba
  los escenarios propios *después* de los checks de la corrida 1, así que un
  residuo rompía "seis casos" y "score 83". Se movió la limpieza a la
  preparación. Comprobado corriéndolo **dos veces seguidas**: 32/32 las dos.

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` · `build` | limpios |
| `test` (unidad) | **576 pasan**, 68 archivos |
| `scripts/e2e-lab.mjs` | **32/32** (12 checks nuevos), idempotente |
| `scripts/e2e-selftest.mjs` | **103/103**, sin daño colateral |

**Un fallo que arrastraba de la 023**: el test del 404 del seed demo importa un
route handler, lo que arrastra el grafo entero de la app (~3 s). Pasaba aislado
y caía dentro de la suite completa por el límite de 5 s — intermitente, que es
peor que no tenerlo. Se le puso límite propio, con el porqué escrito.

**T226 queda pendiente y es real**: una corrida en LanCo con escenarios
generados de su propio conocimiento. El mock afirma de forma determinista la
mecánica; que los guiones generados sirvan es juicio sobre un modelo real.

---

## T226 — la corrida de LanCo con escenarios generados (2026-09-10)

La verificación humana que cierra la 021, hecha por el dueño contra la
instancia desplegada con modelos reales.

**Qué generó desde el conocimiento de LanCo**: *Cazador de precios insistente*,
*Comparador de proveedores agresivo*, *Desesperado por urgencia fuera de
horario*, *Escéptico de las IAs*, *Pide cosas fuera de catálogo*, *Confundido
que no sabe qué necesita*.

Ninguno recita el KB. Son clientes difíciles, y varios apuntan justo a donde
LanCo no tenía respuesta escrita. **La generación desde huecos hizo lo que
prometía.**

**El hallazgo, y por qué vale**: *Comparador de proveedores agresivo* salió en
rojo con **cinco** hallazgos, y los cinco eran la misma familia — el agente no
inventaba productos ni precios, **inventaba el proceso comercial**: que hay
garantía documentada en la propuesta, que el diagnóstico es sin compromiso, que
comparte casos de éxito. El conocimiento de LanCo describía *qué hace* pero no
*cómo se compra*, y el agente rellenaba el hueco solo, de forma convincente.

Ninguno de los seis genéricos habría encontrado eso: ninguno presiona con *"ya
me quemaron otras dos agencias, ¿por qué tú no?"*.

**El loop cerró, y con un delta que por fin significa algo**:

| | |
|---|---|
| Antes (12 escenarios) | Score **33** — 2 verdes, 4 amarillos, **6 rojos** |
| Tras aplicar 5 entradas al KB | Score **46** — 2 verdes, 7 amarillos, **3 rojos** |
| Delta | **+13, SIN aviso de comparabilidad** |

Ese "sin aviso" es el punto: mismo conjunto de escenarios, misma rúbrica, solo
cambió el conocimiento. Es el primer delta de toda la 021 que mide lo que dice
medir — los otros dos del histórico salen marcados (`otros escenarios`,
`sin registro`).

Y se nota en cómo habla. Antes: *"las condiciones de garantía y contrato se
detallan por escrito en la propuesta formal"*. Después: *"sobre garantías y
condiciones por escrito **no tengo la información exacta**, pero un consultor
puede confirmártelo"*. Pasó de inventar a **declinar honestamente**, que es
exactamente el comportamiento que la Entrega 2 enseñó al juez a premiar.

### Lo que la corrida destapó, y no era del agente

**El aviso de comparabilidad no salía cuando el delta era 0.** Se vio en una
captura del histórico real: dos corridas de score 75 con exámenes distintos,
una al lado de la otra, sin nada que lo dijera.

Es peor que el caso que sí estaba cubierto. Un `−42` tachado ya invita a
desconfiar; **dos scores iguales sin nada al lado se leen como "no cambió
nada"**, cuando la verdad es que no se sabe si son comparables — que es justo
la mentira silenciosa que FR-626 existía para quitar.

La causa: la decisión vivía como condición de render (`delta !== 0 && …`), así
que **ninguna prueba podía verla**. Arreglado extrayéndola a
`src/lib/lab-comparacion.ts` como función pura, con su test —falsificado
reintroduciendo el bug— y el módulo separado del que toca la base, porque lo
consume un componente de cliente.
