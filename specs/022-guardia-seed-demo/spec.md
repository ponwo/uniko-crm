# 022 — La guardia del seed demo

**Mini-spec.** Arreglo de seguridad de datos, no producto. Aterriza **antes** que
la 021 y viaja en el mismo PR que el arreglo del Principio III ya commiteado:
`93b7022` — *"fix(seed): el seed demo no puede tocar los datos de otra
organización"*. Va el asunto además del hash a propósito: un hash no sobrevive a
un rebase y el asunto sí.

**Rama**: `022-guardia-seed-demo`, desde `main` (`f13fd19`).
**Sin migración. Sin tocar el esquema.**

> ## Cambio de alcance (2026-09-09): el botón se elimina
>
> Decidido por el dueño con la Fase 3 ya implementada: **el botón "Cargar datos
> de demostración" desaparece de la interfaz**, en vez de protegerse.
>
> **Por qué ahora se puede.** Sólo servía para demostración y ya no hace falta:
> LanCo es la instancia de pruebas del dueño, y NuriaAndrea e ILTU tienen la base
> en blanco y **no están liberadas**, así que ninguna llegaría a verlo. Quitar el
> botón **elimina el riesgo entero** en vez de acotarlo — y una guardia es un
> cortafuegos, no un rediseño.
>
> **Lo que NO cambia**: el `POST /api/seed/demo` **se queda, protegido**, y con él
> toda la Fase 2 —guardia, cerrojo, transacción y el `UPDATE` del perfil dentro
> de ella—. Sigue siendo una operación destructiva y sigue necesitando su
> guardia. El motivo de conservar el endpoint es concreto y está comprobado:
> **`scripts/screenshots.mjs` lo llama** para poblar una instancia recién migrada
> antes de regenerar las capturas del README. No está en `package.json`, se corre
> a mano, y matar el endpoint lo rompería en silencio hasta que alguien fuera a
> regenerar capturas.
>
> **Y el `--force` del CLI se queda**, que era el otro camino destructivo.
>
> Qué decae con el botón: **FR-706 y FR-707** (derogados abajo, con su texto
> intacto), **FR-703** reescrito, el `GET` del render, la frase de pantalla y sus
> tests. Sin pantalla, esta feature **deja de tocar código de cliente**, y con eso
> desaparece el riesgo de bundle que el build destapó en la Fase 3.

---

## El problema, en una frase

**La guardia comprueba la única tabla que está garantizadamente vacía para el
negocio al que debería proteger.**

`POST /api/seed/demo` se protege con `isDomainEmpty()`, que mira si la
organización tiene **contactos**. Un contacto sólo existe cuando alguien escribe
al número. Así que un negocio que ya configuró su agente y su conocimiento pero
todavía no ha recibido su primer mensaje **pasa la guardia** — y es exactamente
el negocio con algo que perder.

Lo que la operación destruye, leído del código (`src/server/seed/demo.ts`):

| Qué | Cómo | Alcance |
|---|---|---|
| Conocimiento del negocio | `DELETE FROM kb_entry` | **todo**, no sólo lo de la demo |
| Historial del Laboratorio | `DELETE` de `agent_test_case` y `agent_test_run` | **todo** |
| Personalidad del agente | `UPDATE agent_profile SET name, tone, instructions, escalation_rules, greeting` | **sin guardia de ningún tipo** |
| Contactos, conversaciones, mensajes, leads | `DELETE` acotado a los teléfonos demo | sólo los de la demo |

Y el camino al accidente es **un clic sin confirmación**: el botón "Cargar datos
de demostración" vive en el estado vacío de la bandeja
(`src/components/inbox/conversation-list.tsx`), que es justo lo que ve un negocio
recién desplegado.

---

## Clarifications

### Session 2026-09-08

- Q: ¿Qué observa AC-7 para afirmar que la comprobación corre dentro de la
  transacción de la limpieza? → A: Opción A — BD simulada que vigila por qué
  manejador sale cada consulta (comprobación y borrados por el `tx`, ninguno por
  el `db` exterior).
- Q: ¿Dónde corren AC-1 a AC-5, si el repositorio no tiene carril de tests con
  base de datos? → A: Opción C — híbrido: los cinco en unitario con BD simulada,
  más un check en el arnés E2E que afirma el 409 con detalle contra la
  organización real del arnés, que ya es no virgen.
- Q: ¿La transacción tiene que impedir además dos siembras simultáneas? → A:
  Opción B — sí, con `pg_advisory_xact_lock` dentro de la misma transacción,
  como ya hace el alta.
- Q: Con la organización no virgen, ¿qué muestra el estado vacío? → A: Opción B —
  sin botón, y en su lugar una frase que nombra lo que ya hay configurado y dice
  que la demo lo reemplazaría. Mientras la comprobación viaja no se muestra
  ningún botón.
  **(Sin objeto desde el 2026-09-09: el estado vacío ya no ofrece la demo. La
  respuesta se conserva porque registra qué se decidió y cuándo, no lo que hoy
  hace el producto.)**

---

## Criterio

**La guardia cubre la misma superficie que la operación destruye.** Ni menos —lo
que falló aquí fue usar un indicador indirecto— ni más: no se comprueban las
plantillas, ni las credenciales de WhatsApp, ni las etapas del pipeline, porque
el seed no las destruye. El criterio dice qué comprobar **y qué no**.

### Dos comprobaciones que NO son superficie destruida, y por qué están

El criterio explica seis de las ocho cosas que mira la guardia. Las otras dos
están por una razón distinta, y conviene decirlo en vez de dejar que parezcan una
incoherencia:

- **Los contactos.** El seed sólo borra los contactos de los **teléfonos demo**,
  no todos. Exigir **cero contactos** no es proteger lo que se destruye: es
  **la señal de que el negocio está vivo**. Un negocio con clientes reales no
  quiere "datos de demostración" bajo ningún concepto, aunque técnicamente el
  seed no fuese a tocar a esos clientes — le llenaría la bandeja de conversaciones
  falsas de una ferretería.
- **`agent_profile.enabled`.** El `UPDATE` del seed **no toca** `enabled` (ver
  AC-9). Se comprueba por el mismo motivo que los contactos: un agente encendido
  es un negocio en marcha.

Las dos son deliberadamente **más estrictas** que el criterio. Lo que el criterio
prohíbe es lo contrario —comprobar **menos** de lo que se destruye—, que es
exactamente el fallo que esta feature arregla.

---

## Dos hechos del código en los que se apoya esta spec

### 1. Los guiones de ferretería son CÓDIGO, no filas del seed

`PERSONAS` es una constante de módulo en `src/server/lab/personas.ts:17`, con las
seis claves `comprador_decidido`, `pregunton_precios`, `cliente_enojado`,
`fuera_de_kb`, `pide_humano`, `errores_modismos`. **Ninguna tabla guarda
guiones**: en el esquema, lo único que existe es
`agent_test_case.persona text NOT NULL` (`src/lib/db/schema.ts:875`), que es una
**clave**, no un guion.

Lo que `seedDemo()` escribe del Laboratorio es **una corrida falsa**: un
`agent_test_run` con `score: 83` (`src/server/seed/demo.ts:329`) y seis
`agent_test_case` con transcripts escritos a mano que imitan lo que esas personas
producirían.

**Consecuencia para esta spec**: borrar la demo no quita los guiones de
ferretería —viven en el binario de toda instancia— y por eso la 021 existe. Lo
que la comprobación "sin corridas del Laboratorio" protege son **filas**: la
corrida sembrada y, sobre todo, las corridas reales que el negocio ya haya hecho,
que hoy **no se pueden borrar por ningún otro camino**.

### 2. El esquema SÍ garantiza que no hay conversación, mensaje ni lead sin contacto

Transcrito del esquema y confirmado contra el SQL aplicado
(`drizzle/0000_*.sql`), sin que ninguna migración posterior lo afloje —el único
`DROP NOT NULL` sobre `contact` es el de `phone`, en `0001_old_sabra.sql:67`:

```
conversation.contactId:  text("contact_id").notNull()
                           .references(() => contact.id, { onDelete: "cascade" })
message.conversationId:  text("conversation_id").notNull()
                           .references(() => conversation.id, { onDelete: "cascade" })
lead.contactId:          text("contact_id").notNull()
                           .references(() => contact.id, { onDelete: "cascade" })
```

`message` **no tiene** `contact_id`: cuelga del contacto a través de la
conversación.

**Los tres son `NOT NULL` y los tres van en cascada.** Por tanto:

- no puede existir una conversación sin contacto;
- no puede existir un mensaje sin conversación y, transitivamente, sin contacto;
- no puede existir un lead sin contacto.

**Consecuencia**: "sin contactos" **cubre** conversaciones, mensajes y leads. **No
hacen falta comprobaciones adicionales.** Pero la guardia queda apoyada en un
invariante del esquema, y un invariante en el que te apoyas se afirma en un test
(AC-6): el día que alguien haga nullable un `contact_id`, tiene que romperse aquí
y no en producción.

---

## Requisitos

### FR-701 — Qué comprueba la guardia

La guardia DEBE considerar la organización **virgen** sólo si las cuatro son
ciertas:

1. **sin contactos** — `contact` sin filas de la organización. Ojo: **no es
   superficie destruida**, es señal de negocio vivo — ver "Dos comprobaciones que
   NO son superficie destruida";
2. **sin conocimiento** — `kb_entry` sin filas;
3. **sin corridas del Laboratorio** — `agent_test_run` sin filas (cualquier
   estado: `running`, `done` o `failed`);
4. **perfil del agente sin tocar** — tal como lo deja el alta
   (`src/server/auth/on-signup.ts:54`, que inserta sólo `id` y
   `organization_id`): `enabled = false`, `name = 'Asistente'` (el default de la
   columna) y `tone`, `instructions`, `escalation_rules`, `greeting` **todos
   NULL**.

Si alguna falla, la organización **no** es virgen.

### FR-702 — Devuelve el hallazgo, no un booleano

La función DEBE devolver **qué encontró**: por cada comprobación incumplida, qué
es y cuánto hay (número de entradas de conocimiento, número de corridas, qué
campos del perfil están tocados). Un booleano no permite explicar nada, y
explicar es la mitad del arreglo: hoy, cuando la guardia dice que no, el botón
**desaparece en silencio**.

`isDomainEmpty()` desaparece. No se conserva como envoltorio: un booleano
disponible es un booleano que alguien vuelve a usar.

No lleva criterio propio porque **lo atrapa el typecheck**: si queda un uso, el
gate se pone rojo antes que cualquier test. Se dice aquí para que la ausencia de
AC se lea como una decisión y no como un olvido.

### FR-703 — Una sola implementación de la guardia

La comprobación DEBE existir **una sola vez**, en su módulo, y todo el que decida
si la demo se carga DEBE llamarla ahí. Nadie escribe su propia versión
"parecida".

> **Reescrito el 2026-09-09**, al eliminarse el botón. Antes decía "una sola
> función, **dos usos**" —render y ejecución— y ese enunciado se queda sin objeto
> cuando el render desaparece: sólo queda un llamador.
>
> **No se deroga, se reescribe**, porque su valor de fondo sobrevive intacto: que
> `seedDemo()` **no traiga su propia comprobación**. Esa es la forma exacta del
> fallo que esta feature arregla —la guardia vieja miraba una tabla y la
> operación destruía otras cuatro— y basta con que alguien "consulte aquí que es
> más cómodo" para reproducirla en otra capa. Lo sigue afirmando AC-14.

### FR-704 — La comprobación de ejecución, dentro de la transacción de la limpieza, y con cerrojo

La comprobación que autoriza el borrado DEBE correr **en la misma transacción**
que la limpieza, y esa transacción DEBE **tomar un cerrojo consultivo**
(`pg_advisory_xact_lock`) **antes** de comprobar nada.

Hoy hay dos viajes separados: la ruta comprueba, y después `seedDemo()` borra. Una
entrada de conocimiento creada entre medias **la destruye una comprobación que
nunca la vio**. Es una ventana estrecha y real, y cerrarla cuesta un
`db.transaction()` — el patrón ya está en el repo (`on-signup.ts:24`,
`stage-history.ts:63`).

**Y el cerrojo, por la otra carrera.** Dos clics a la vez sobre una organización
virgen no chocan de forma benigna: las dos siembras pasan la guardia, las dos
limpian y las dos insertan, y `contact` tiene índice único
(`contact_org_channel_identity_uq`), así que la segunda revienta con violación de
unicidad — **500 y demo a medio cargar**. Con el cerrojo, la segunda espera, se
encuentra la organización ya **no virgen** y recibe un 409 correcto, que es
exactamente lo que debería recibir.

Se usa el mismo mecanismo que el alta (`on-signup.ts:27`) con una **clave
distinta** de la suya (874201). Clave fija y no por organización: una instancia es
un negocio, y serializar entre organizaciones —si algún día las hubiera— no hace
daño en una acción tan rara como cargar la demo.

> **Fuera de alcance, dicho a propósito**: el resto del seed (los inserts) sigue
> sin transacción, como hoy. Un fallo a mitad deja la demo a medio cargar. Con la
> guardia corregida eso sólo puede pasarle a una organización que no tenía nada,
> así que no es urgente; ensancharlo a todo el seed es una decisión aparte y no
> se toma aquí.

### FR-705 — 409 con detalle

Con la organización no virgen, `POST /api/seed/demo` DEBE responder **409** con el
detalle de **qué se perdería**, no sólo un mensaje genérico. El cuerpo mantiene la
forma de `apiError` (`{ error: { code, message } }`) y añade el detalle
estructurado del FR-702.

### FR-706 — El estado vacío explica en vez de esconder ~~(DEROGADO)~~

> **DEROGADO el 2026-09-09, antes de llegar a `main`.** El estado vacío ya no
> ofrece cargar la demo, así que no hay nada que explicar en él: el botón se
> elimina en vez de protegerse (ver "Cambio de alcance" arriba).
>
> **El texto se conserva y no se reescribe.** Estuvo implementado —el estado
> vacío llegó a consultar la guardia y a componer su frase— y describe una
> decisión que se tomó con su razón. Borrarlo dejaría el commit `08cb859`
> hablando de un requisito que no existe.

Con la organización no virgen, el estado vacío de la bandeja DEBE **decir por qué
no se puede cargar la demo**, nombrando lo que se perdería. Hoy el botón
simplemente no aparece tras un fallo, que es la peor de las opciones: el usuario
no sabe si es un error suyo, un fallo del producto o una decisión.

**La forma, decidida**: **no hay botón**, y en su lugar va una frase que nombra lo
que ya hay configurado y dice que la demo lo reemplazaría. Por ejemplo: *"No se
puede cargar la demo: ya tienes 12 entradas de conocimiento y el agente
configurado. Reemplazaría lo que ya escribiste."*

**No un botón deshabilitado**: un botón que no se puede pulsar es una promesa rota
a la vista, y provoca justo la pregunta que esto quiere evitar —"¿por qué no
puedo?"—. La frase responde antes de que la pregunta se formule.

**Y mientras la comprobación viaja**: **no se muestra ningún botón**. Un botón que
aparece y desaparece medio segundo después es peor que uno que tarda en aparecer,
y en este caso el que desaparece es el que destruye datos.

### FR-707 — La etiqueta dice lo que hace ~~(DEROGADO)~~

> **DEROGADO el 2026-09-09, antes de llegar a `main`.** No hay botón cuya
> etiqueta corregir. Mismo tratamiento que FR-706: el texto se conserva.
>
> Y con él decae también lo que decía de la confirmación. Ese razonamiento
> —"con la guardia corregida, el clic sólo alcanza a una organización que no
> tiene nada que perder"— era correcto y ahora es innecesario: **sin clic no hay
> nada que confirmar**.

El botón DEBE decir que **sustituye la configuración del agente**, no sólo que
carga datos. "Cargar datos de demostración" es verdad y es incompleto: no
menciona que reemplaza el conocimiento y la personalidad del agente.

**Sin diálogo de confirmación** (decidido): con la guardia corregida, el clic sólo
alcanza a una organización que no tiene nada que perder. Meter fricción ahí es
fricción sin riesgo. La honestidad va en la etiqueta, no en un modal.

### FR-708 — El `--force` del CLI se queda, y cuenta lo que va a destruir

`pnpm seed:demo --force` DEBE seguir existiendo: está documentado y se usa dentro
del contenedor. Pero antes de destruir DEBE imprimir **los conteos de lo que va a
borrar** (entradas de conocimiento, corridas, contactos demo) y si el perfil del
agente está configurado.

Quien tiene shell puede destruir; lo que no debe es hacerlo sin que quede en el
log.

### FR-709 — Sin migración

Las cuatro comprobaciones se responden con lo que ya hay en el esquema. Esta
feature **no toca `drizzle/`** y por tanto **no requiere ensayo del Principio X**.

### FR-710 — Derogación parcial de FR-075 (001-uniko-core)

Eliminar el botón **deroga en parte un requisito de otra feature**, y eso se
registra en los dos sitios, no sólo aquí.

`FR-075` de [`001-uniko-core`](../001-uniko-core/spec.md) dice: *"Con base de
datos vacía, la UI **MUST** ofrecer «Cargar datos de demostración» (también vía
script y variable), sembrando el negocio demo […] de forma idempotente."*

- **Lo que se deroga**: la primera parte — que **la UI** lo ofrezca.
- **Lo que sigue vigente**: el resto. El negocio demo se sigue sembrando por
  script (`pnpm seed:demo`) y sigue siendo idempotente.
- **Por qué**: ver "Cambio de alcance". Ninguna instancia de la flota llegaría a
  usar ese botón, y quitarlo elimina un camino destructivo de un clic.

**La spec de la 001 NO se reescribe**: se le añade una marca junto a FR-075
apuntando aquí, en el mismo PR que elimina el botón. Un requisito citado en
commits y comentarios es una dirección estable; lo que se anota es que está
derogado, no se cambia lo que decía.

> Esta anotación cruzada no es invento de esta spec: se propone como regla en el
> `constitution.md`, junto a la de las bandas de numeración. Si esa enmienda no
> se aprueba, esta feature la aplica igualmente **en este caso concreto**, porque
> el problema que resuelve es real — quien abra la 001 dentro de un año se
> encuentra un MUST vigente que el producto incumple.

---

## Criterios de aceptación (van como tests)

### Dónde corre cada uno

Este repositorio **no tiene carril de tests con base de datos**: Vitest corre en
`node` y el arnés E2E corre contra la app viva. Eso reparte los criterios en dos
sitios, y conviene decirlo antes de leerlos:

- **AC-1 a AC-11: unitarios, con BD simulada** (el patrón de
  `tests/unit/seed-demo-tenant.test.ts`, que pasa la conexión como parámetro). El
  observable de "no se borró nada" es **que no se emitió ningún borrado**, no que
  las filas sobrevivan: sin base real no hay filas que contar, y afirmar lo que
  no se puede observar es peor que afirmar menos.
- **AC-12: en el arnés E2E**, contra la app real.

**Por qué el arnés no puede cubrir más.** La organización del arnés **nunca es
virgen** —tiene contactos desde la primera corrida— y el registro se cierra tras
la primera organización, así que **no hay forma de fabricar una organización
virgen** ahí. AC-1 y AC-5 no tienen dónde correr por HTTP. Y AC-5 ("virgen ⇒
carga") destruiría los datos del propio arnés si pudiera correr.

Esa misma asimetría es lo que hace valioso AC-12: la organización del arnés es
**naturalmente** el caso que hay que proteger, así que el 409 se afirma contra la
app real **sin destruir nada**.

- **AC-1 — Alta real ⇒ virgen.** Una organización creada por **el camino real de
  alta** (`onUserCreated()` en `src/server/auth/on-signup.ts:22`) es considerada virgen por
  la guardia.
  > Este test **acopla a propósito** la definición de "virgen" al alta: si el alta
  > cambia —un campo nuevo con default, un perfil que ya no nace apagado— este
  > test rompe. **Eso es lo que se quiere**: la alternativa es que la guardia se
  > desactualice en silencio y vuelva a dejar pasar lo que debía frenar.
  >
  > **Cómo se observa sin base de datos**: se corre `onUserCreated()` contra la BD
  > simulada y se **captura el `INSERT` de `agent_profile`** que hace el alta.
  > Esa fila capturada —no una escrita a mano en el test— es la que se le da a la
  > guardia. Si el test construyera el perfil por su cuenta, estaría comprobando
  > que la guardia coincide con el test, que es lo único que no importa.

- **AC-2 — Conocimiento y cero contactos ⇒ rechazo y ningún borrado.** Con al
  menos una entrada de `kb_entry` y ningún contacto: la guardia rechaza **y el
  fake no registra ni un solo `DELETE`**. No basta con comprobar que dijo que no:
  hay que comprobar que no borró.

- **AC-3 — Corridas del Laboratorio y cero contactos ⇒ rechazo y ningún
  borrado.** Con al menos un `agent_test_run` y ningún contacto: la guardia
  rechaza **y no se emite ningún `DELETE`** — en particular ninguno sobre
  `agent_test_run` ni `agent_test_case`. Que la guardia hable no basta; lo que
  hay que ver es que nadie tocó las corridas.

- **AC-4 — Perfil tocado ⇒ rechazo, un caso por campo.** Seis casos independientes,
  cada uno con lo demás virgen: `enabled = true`; `name` distinto de "Asistente";
  y `tone`, `instructions`, `escalation_rules`, `greeting` no nulos, uno por uno.
  Un solo test con los seis campos a la vez pasaría aunque la guardia mirase sólo
  uno.

- **AC-5 — Virgen ⇒ carga.** Con las cuatro comprobaciones limpias, el seed corre:
  el fake registra **los `INSERT` de la demo** y **ninguna sentencia de rechazo**.
  La guardia tiene que dejar pasar el caso para el que existe — un cortafuegos que
  también apaga la cocina no sirve.

- **AC-6 — El invariante del esquema, afirmado.** Un test declara que
  `conversation.contactId`, `message.conversationId` y `lead.contactId` son
  `NOT NULL`. La guardia se apoya en ese invariante para no comprobar
  conversaciones, mensajes ni leads; el día que deje de ser cierto, esto tiene que
  romperse aquí.

- **AC-7 — Lo destructivo, dentro de la transacción: por AUSENCIA y con ancla de
  vitalidad.** Con la BD simulada del patrón que ya usa
  `tests/unit/seed-demo-tenant.test.ts`, el fake registra **por qué manejador sale
  cada sentencia y de qué tipo es**. Se afirma que `seedDemo()` abre una
  transacción y que **por el `db` exterior no sale NINGUNA sentencia destructiva**
  —`DELETE`, `UPDATE`, `TRUNCATE`—.

  La afirmación es **por ausencia, no por lista**: un octavo `DELETE` escrito
  fuera de la transacción la rompe sin que nadie tenga que acordarse de añadirlo
  a ningún inventario. Y falla igual en el caso original: comprobar fuera y
  entrar en la transacción sólo a borrar.

  **Y con ancla de vitalidad, que son dos cosas y no una**: se afirma (a) que **el
  callback de la transacción corrió** y (b) que **por el `tx` salieron sentencias
  destructivas** — los borrados de la limpieza y el `UPDATE` del perfil.

  > **Por qué el ancla no es opcional.** Una afirmación por ausencia se cumple
  > sola cuando no se ejecuta nada. Un fake cuyo `transaction()` no invoque el
  > callback —que es lo primero que sale al escribirlo— deja este criterio en
  > verde con la transacción **sin ejercer**: no hubo destructivas fuera porque no
  > hubo destructivas en ningún sitio. Es el mismo fallo que el arnés de la 020 ya
  > pagó una vez, cuando un silencio que era falta de espera se leyó como silencio.

  > **La comprobación de la guardia NO se afirma aquí.** Con la guardia real son
  > `SELECT` de conteo, indistinguibles del `SELECT` de `pipelineStage` que el
  > propio seed hace; reconocerlos exigiría clasificar por texto de SQL, que es la
  > fragilidad que este criterio existe para evitar. Que la comprobación ocurra
  > dentro de la transacción lo afirma **AC-14**, que tiene el manejador delante
  > como argumento.

  > **Los `INSERT` se quedan fuera a propósito**, como decide la nota de FR-704:
  > son la **carga** de la demo, no su destrucción. Acotar por categoría es lo que
  > permite tener las dos cosas — la afirmación fuerte y el alcance que la spec
  > eligió. Si algún día el seed entero debe ser transaccional, se decidirá por
  > sus méritos y en su momento, no porque a un test le quedara más cómodo.

  > **Consecuencia sobre el orden del código**: el `UPDATE` de `agent_profile`
  > **es** destructivo —sobrescribe la personalidad que el negocio configuró— así
  > que entra en la transacción junto a los borrados, **antes** de las
  > inserciones. Con eso la transacción cubre **exactamente la superficie que la
  > guardia protege**, que es la misma frase que da nombre al criterio de esta
  > feature.

  > **Lo que este AC no prueba, dicho a propósito**: que Postgres aísle de verdad
  > a otra conexión concurrente. Eso exige una base real, y este repositorio no
  > tiene carril de tests con base de datos ni en local ni en CI. El observable
  > elegido atrapa el **error de programación** —comprobar fuera, borrar dentro—,
  > no el del motor. Montar ese carril para un solo AC es desproporcionado; si
  > algún día existe por otra razón, este AC se refuerza con él.

- **AC-8 — Un caso del Laboratorio no puede quedar huérfano.** Un test declara
  que `agent_test_case.run_id` es `NOT NULL` con `ON DELETE cascade`. La guardia
  no cuenta casos, sólo corridas: se apoya en que no puede haber un caso sin su
  corrida. Igual que AC-6, el día que eso deje de ser cierto tiene que romperse
  aquí.

- **AC-9 — Lo que el seed sobrescribe del perfil está TODO vigilado.** El test
  captura las columnas del `UPDATE` sobre `agent_profile` que hace `seedDemo()`
  —quitando `updated_at`, que es metadato— y las compara con el conjunto que
  inspecciona FR-701 #4. Rompe si divergen **en la dirección peligrosa**: toda
  columna que el seed escriba tiene que estar vigilada.

  > **No es igualdad de conjuntos, y la diferencia importa.** Hoy el seed escribe
  > `name`, `tone`, `instructions`, `escalation_rules` y `greeting`, y la guardia
  > mira esas cinco **más `enabled`**, que el seed no toca. Exigir igualdad
  > estricta haría fallar el test desde el primer día por una asimetría
  > deliberada. Lo que se exige es: **vigilado ⊇ escrito**, con `enabled`
  > declarado explícitamente como "vigilado a propósito aunque no se escriba". Si
  > mañana alguien añade un campo al `UPDATE` sin vigilarlo, rompe; si alguien
  > deja de vigilar uno que se escribe, rompe.

- **AC-10 — La respuesta de rechazo nombra lo que se perdería.** La función que
  construye el rechazo del FR-705 incluye el **detalle estructurado** del FR-702
  —qué comprobación falló y cuánto hay— además del mensaje. Se prueba dándole un
  hallazgo de ejemplo, sin HTTP: es la mitad mecanizable del FR-706, porque sin
  ese dato la pantalla no puede explicar nada. Que el detalle llegue de verdad
  por la red lo comprueba AC-12.

- **AC-11 — Los conteos del `--force` salen de la misma función.** El texto que
  el CLI imprime antes de destruir (FR-708) se construye desde el hallazgo del
  FR-702, no de un recuento propio. El test cubre la función que lo formatea:
  con un hallazgo de ejemplo, el texto nombra las entradas de conocimiento, las
  corridas y el perfil configurado.

- **AC-13 — El cerrojo se toma dentro de la transacción y ANTES de comprobar.**
  Con la misma BD simulada de AC-7, se afirma que la **primera** sentencia que
  sale por el `tx` es el `pg_advisory_xact_lock`, antes que la consulta de la
  guardia y que cualquier borrado. Un cerrojo que se toma después de comprobar no
  sirve para nada, y ese error no se ve leyendo el código por encima.

- **AC-14 — Una sola implementación de la guardia, afirmada en la frontera del
  módulo.** Dos afirmaciones, ninguna a través de los handlers HTTP:

  1. **Runtime**: con `vi.mock` sobre `@/server/seed/guardia`, ejercer
     `seedDemo()` y comprobar que el espía registró la llamada **y que su primer
     argumento es el `tx` que entregó `db.transaction()`, no el `db` exterior**.
     El manejador viaja como argumento, así que se observa sin clasificar SQL: es
     lo que cierra FR-704 por el lado de la comprobación, donde AC-7 no llega.
  2. **Estática**: el módulo de la ruta **no inspecciona por su cuenta ninguna
     tabla que la guardia vigila** — ni `kb_entry`, ni `agent_test_run`, ni
     `agent_profile`, ni `contact`—. Si alguien decide que "aquí es más cómodo
     consultarlo directamente", esto se pone rojo.

     > **Reescrita el 2026-09-09.** Antes afirmaba que la ruta **importa**
     > `revisarDemo`, y eso deja de ser cierto al eliminarse el `GET` del render:
     > la ruta pasa a importar sólo `cuerpoDeRechazo`, porque la comprobación
     > ocurre dentro de `seedDemo()`. Afirmar una importación que ya no existe
     > habría convertido este criterio en rojo permanente por la razón
     > equivocada. Lo que se conserva es lo que de verdad protegía: **que no haya
     > una segunda implementación**.

  > **El doble del módulo devuelve un hallazgo bien formado** (`virgen: true`), no
  > un `vi.fn()` pelado: `seedDemo()` lee el resultado para decidir, y un
  > `undefined` reventaría el test por una razón que no es la que se prueba.

  > **Por qué no se ejerce el camino de render.** El `GET` va envuelto en
  > `withAuth`, que responde 401 antes de llegar al cuerpo, así que probarlo
  > exigiría **construir simulación de sesión** — y hoy **ningún test unitario de
  > este repositorio ejerce un handler autenticado**: no hay patrón que copiar.
  > Montar esa maquinaria es una decisión propia, con sus méritos, y no algo que
  > deba salir de un criterio de aceptación de una mini-spec.

  > **Lo que sí atrapa**, que es el riesgo real: que alguien **reimplemente** la
  > comprobación en el render en vez de llamar a la única que hay — dos caminos
  > que comprueban "casi" lo mismo es el fallo original de esta feature repetido
  > en otra capa. **Lo que no atrapa**: que el `GET` la invoque de verdad en
  > tiempo de ejecución. Eso se ve en la corrida manual del quickstart, donde la
  > pantalla enseña la frase correcta o no la enseña.

- **AC-12 — En la app real, la organización del arnés recibe 409 con detalle.**
  En `scripts/e2e-selftest.mjs`: `POST /api/seed/demo` contra la organización del
  arnés —que **no es virgen**: el propio arnés le crea contactos y conocimiento
  antes de llegar aquí— responde **409**, el cuerpo
  trae el **detalle estructurado** del FR-702 nombrando qué se perdería, y una
  lectura posterior confirma que **el conocimiento del arnés sigue ahí**. Es el
  único criterio que se ejerce contra HTTP real, y es seguro precisamente porque
  el resultado esperado es que **no pase nada**.

  > **Encogido el 2026-09-09**: tenía un quinto check —que la lectura del render
  > coincidiera con la ejecución— y se va con el `GET`. Quedan cuatro. El valor
  > del criterio no cambia: sigue siendo el único sitio donde el 409 y su detalle
  > se ejercen contra HTTP real, y donde se comprueba que **nadie borró**.

  > Se afirma **lo que hace falta** —que no es virgen— y no un inventario. El
  > arnés crea contactos y conocimiento, pero las **corridas del Laboratorio** las
  > crea `e2e-push.mjs`, que corre **después** en la cadena: enumerar un estado
  > que la propia corrida no establece es una premisa que sólo se cumple, por
  > casualidad, a partir de la segunda pasada.

### Lo que se verifica a mano, y dónde

> **Reducido el 2026-09-09.** Sin botón no hay pantallas que juzgar: **las cuatro
> del nivel 3 desaparecen**, y con ellas la parte que sólo una persona podía
> aprobar —si la frase de un solo elemento sonaba a español—. Lo que queda es el
> CLI, y sigue mereciendo una persona: **los conteos que `--force` imprime antes
> de destruir los lee alguien, y conviene que no sea quien los escribió.**
>
> Lo que se verifica a mano pasa a ser: `pnpm seed:demo` negándose y diciendo qué
> encontró, y `pnpm seed:demo --force` imprimiendo los conteos **antes** de
> destruir. Sigue siendo local: hace falta una organización con datos, y la del
> arnés sirve.

Lo que sigue, tachado, es lo que decía cuando había pantalla. Se conserva porque
FR-706 y FR-707 se conservan derogados, no borrados:

- **FR-707 (la etiqueta del botón)** y **la mitad visual de FR-706**: que con la
  organización no virgen **no haya botón** sino la frase que nombra lo
  configurado, y que **mientras la comprobación viaja no aparezca ningún botón**.
  Este repositorio no tiene pruebas de componentes —Vitest corre en `node`, sin
  biblioteca de render— y montarlas para dos textos y un estado de carga es más
  máquina que problema.
- **Dónde se verifican: en local, con una organización recién dada de alta**, y
  **no en LanCo**: la pantalla vacía sólo aparece con cero conversaciones, y LanCo
  tiene conversaciones reales desde hace semanas. **Ninguna instancia de la flota
  puede enseñar este estado sin ensuciarla**, así que el nivel 3 de esta
  mini-spec es local por necesidad, no por comodidad.
- **FR-709 (sin migración)**: no lleva criterio automático porque es una
  afirmación **sobre el diff**, no sobre el comportamiento — `git diff` no toca
  `drizzle/`. Se comprueba al revisar el PR y se declara ahí. Un test que
  inspeccionara el árbol de trabajo comprobaría el repositorio, no el producto.
- **Se registra** en el guion de la historia, con la regla de siempre: lo que no
  se vio no se marca.

---

## Relación con la 021, en los dos sentidos

**Esto aterriza antes.** La 021 es producto y va a llevar su tiempo; esto es un
agujero por el que un negocio pierde su configuración con un clic, y no espera.

**Y el arreglo definitivo se monta sobre la 021.** Una guardia es un cortafuegos,
no un rediseño: el seed **sigue siendo destructivo**, sólo que ahora únicamente
puede destruir de una organización que no tenía nada. Lo correcto es que el seed
borre **sólo lo que él mismo creó**, y eso necesita procedencia en `kb_entry` —
la columna `source` que **la 021 ya va a añadir** para marcar las entradas
aplicadas desde el Laboratorio. Cuando exista, el seed marca las suyas y borra
sólo esas, y esta guardia pasa de ser lo único que separa a un negocio de su
conocimiento a ser una segunda capa.

> **Y una advertencia que no hay que perder**: esa columna **no cubre el perfil
> del agente**. `agent_profile` es una fila única por organización que el seed
> **sobrescribe**, no una tabla de filas con procedencia: no hay "entradas de
> perfil de la demo" que borrar selectivamente. Guardar y restaurar el perfil
> previo, o no tocarlo, es un problema **distinto y sin resolver**. Que la 021
> añada `source` a `kb_entry` **no** cierra este caso.

---

## Fuera de alcance

- **El borrado de corridas del Laboratorio.** Sigue sin existir; que esta guardia
  cuente las corridas no lo arregla. Es su propio problema y arrastra las
  conversaciones `is_test` huérfanas por las claves foráneas.
- **Que el seed deje de ser destructivo.** Depende de la 021 (arriba).
- **Guardar o restaurar el perfil del agente.** Sin resolver, y dicho arriba.
- **Transaccionalidad del resto del seed.** FR-704 y su nota.
