# 022 — La guardia del seed demo

**Mini-spec.** Arreglo de seguridad de datos, no producto. Aterriza **antes** que
la 021 y viaja en el mismo PR que el arreglo del Principio III ya commiteado:
`93b7022` — *"fix(seed): el seed demo no puede tocar los datos de otra
organización"*. Va el asunto además del hash a propósito: un hash no sobrevive a
un rebase y el asunto sí.

**Rama**: `022-guardia-seed-demo`, desde `main` (`f13fd19`).
**Sin migración. Sin tocar el esquema.**

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

### FR-601 — Qué comprueba la guardia

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

### FR-602 — Devuelve el hallazgo, no un booleano

La función DEBE devolver **qué encontró**: por cada comprobación incumplida, qué
es y cuánto hay (número de entradas de conocimiento, número de corridas, qué
campos del perfil están tocados). Un booleano no permite explicar nada, y
explicar es la mitad del arreglo: hoy, cuando la guardia dice que no, el botón
**desaparece en silencio**.

`isDomainEmpty()` desaparece. No se conserva como envoltorio: un booleano
disponible es un booleano que alguien vuelve a usar.

### FR-603 — Una sola función, dos usos

La MISMA función DEBE alimentar el **render** (qué enseña el estado vacío) y la
**ejecución** (si el seed corre). Dos criterios que se parecen acaban divergiendo,
y el que diverge en silencio es el de la ejecución.

El render la alcanza por una lectura HTTP; la ejecución la llama en el servidor.

### FR-604 — La comprobación de ejecución, dentro de la transacción de la limpieza

La comprobación que autoriza el borrado DEBE correr **en la misma transacción**
que la limpieza.

Hoy hay dos viajes separados: la ruta comprueba, y después `seedDemo()` borra. Una
entrada de conocimiento creada entre medias **la destruye una comprobación que
nunca la vio**. Es una ventana estrecha y real, y cerrarla cuesta un
`db.transaction()` — el patrón ya está en el repo (`on-signup.ts:24`,
`stage-history.ts:63`).

> **Fuera de alcance, dicho a propósito**: el resto del seed (los inserts) sigue
> sin transacción, como hoy. Un fallo a mitad deja la demo a medio cargar. Con la
> guardia corregida eso sólo puede pasarle a una organización que no tenía nada,
> así que no es urgente; ensancharlo a todo el seed es una decisión aparte y no
> se toma aquí.

### FR-605 — 409 con detalle

Con la organización no virgen, `POST /api/seed/demo` DEBE responder **409** con el
detalle de **qué se perdería**, no sólo un mensaje genérico. El cuerpo mantiene la
forma de `apiError` (`{ error: { code, message } }`) y añade el detalle
estructurado del FR-602.

### FR-606 — El estado vacío explica en vez de esconder

Con la organización no virgen, el estado vacío de la bandeja DEBE **decir por qué
no se puede cargar la demo**, nombrando lo que se perdería. Hoy el botón
simplemente no aparece tras un fallo, que es la peor de las opciones: el usuario
no sabe si es un error suyo, un fallo del producto o una decisión.

### FR-607 — La etiqueta dice lo que hace

El botón DEBE decir que **sustituye la configuración del agente**, no sólo que
carga datos. "Cargar datos de demostración" es verdad y es incompleto: no
menciona que reemplaza el conocimiento y la personalidad del agente.

**Sin diálogo de confirmación** (decidido): con la guardia corregida, el clic sólo
alcanza a una organización que no tiene nada que perder. Meter fricción ahí es
fricción sin riesgo. La honestidad va en la etiqueta, no en un modal.

### FR-608 — El `--force` del CLI se queda, y cuenta lo que va a destruir

`pnpm seed:demo --force` DEBE seguir existiendo: está documentado y se usa dentro
del contenedor. Pero antes de destruir DEBE imprimir **los conteos de lo que va a
borrar** (entradas de conocimiento, corridas, contactos demo) y si el perfil del
agente está configurado.

Quien tiene shell puede destruir; lo que no debe es hacerlo sin que quede en el
log.

### FR-609 — Sin migración

Las cuatro comprobaciones se responden con lo que ya hay en el esquema. Esta
feature **no toca `drizzle/`** y por tanto **no requiere ensayo del Principio X**.

---

## Criterios de aceptación (van como tests)

- **AC-1 — Alta real ⇒ virgen.** Una organización creada por **el camino real de
  alta** (`onUserCreated()` en `src/server/auth/on-signup.ts:22`) es considerada virgen por
  la guardia.
  > Este test **acopla a propósito** la definición de "virgen" al alta: si el alta
  > cambia —un campo nuevo con default, un perfil que ya no nace apagado— este
  > test rompe. **Eso es lo que se quiere**: la alternativa es que la guardia se
  > desactualice en silencio y vuelva a dejar pasar lo que debía frenar.

- **AC-2 — Conocimiento y cero contactos ⇒ 409 y no se borra nada.** Con al menos
  una entrada de `kb_entry` y ningún contacto: `POST /api/seed/demo` responde 409
  y **el conocimiento sigue ahí** después. No basta con comprobar el código de
  estado: hay que comprobar que no se borró.

- **AC-3 — Corridas del Laboratorio y cero contactos ⇒ 409 y no se borra nada.**
  Con al menos un `agent_test_run` y ningún contacto: responde 409 y **las
  corridas siguen ahí** después, contadas de nuevo. El código de estado dice que
  la guardia habló; sólo el recuento posterior dice que nadie borró.

- **AC-4 — Perfil tocado ⇒ 409, un caso por campo.** Seis casos independientes,
  cada uno con lo demás virgen: `enabled = true`; `name` distinto de "Asistente";
  y `tone`, `instructions`, `escalation_rules`, `greeting` no nulos, uno por uno.
  Un solo test con los seis campos a la vez pasaría aunque la guardia mirase sólo
  uno.

- **AC-5 — Virgen ⇒ carga.** Con las cuatro comprobaciones limpias, el seed corre
  y la demo queda cargada. La guardia tiene que dejar pasar el caso para el que
  existe.

- **AC-6 — El invariante del esquema, afirmado.** Un test declara que
  `conversation.contactId`, `message.conversationId` y `lead.contactId` son
  `NOT NULL`. La guardia se apoya en ese invariante para no comprobar
  conversaciones, mensajes ni leads; el día que deje de ser cierto, esto tiene que
  romperse aquí.

- **AC-7 — La comprobación y el borrado, atómicos.** Se afirma que la
  comprobación de ejecución ocurre dentro de la transacción que hace la limpieza
  (FR-604).

- **AC-8 — Un caso del Laboratorio no puede quedar huérfano.** Un test declara
  que `agent_test_case.run_id` es `NOT NULL` con `ON DELETE cascade`. La guardia
  no cuenta casos, sólo corridas: se apoya en que no puede haber un caso sin su
  corrida. Igual que AC-6, el día que eso deje de ser cierto tiene que romperse
  aquí.

- **AC-9 — Lo que el seed sobrescribe del perfil está TODO vigilado.** El test
  captura las columnas del `UPDATE` sobre `agent_profile` que hace `seedDemo()`
  —quitando `updated_at`, que es metadato— y las compara con el conjunto que
  inspecciona FR-601 #4. Rompe si divergen **en la dirección peligrosa**: toda
  columna que el seed escriba tiene que estar vigilada.

  > **No es igualdad de conjuntos, y la diferencia importa.** Hoy el seed escribe
  > `name`, `tone`, `instructions`, `escalation_rules` y `greeting`, y la guardia
  > mira esas cinco **más `enabled`**, que el seed no toca. Exigir igualdad
  > estricta haría fallar el test desde el primer día por una asimetría
  > deliberada. Lo que se exige es: **vigilado ⊇ escrito**, con `enabled`
  > declarado explícitamente como "vigilado a propósito aunque no se escriba". Si
  > mañana alguien añade un campo al `UPDATE` sin vigilarlo, rompe; si alguien
  > deja de vigilar uno que se escribe, rompe.

- **AC-10 — El 409 nombra lo que se perdería.** El cuerpo del 409 trae el detalle
  estructurado del FR-602 —qué comprobación falló y cuánto hay— y no sólo un
  mensaje. Es la mitad mecanizable del FR-606: sin este dato, la pantalla no
  puede explicar nada.

- **AC-11 — Los conteos del `--force` salen de la misma función.** El texto que
  el CLI imprime antes de destruir (FR-608) se construye desde el hallazgo del
  FR-602, no de un recuento propio. El test cubre la función que lo formatea:
  con un hallazgo de ejemplo, el texto nombra las entradas de conocimiento, las
  corridas y el perfil configurado.

### Lo que se verifica a mano, y dónde

Dos requisitos no llevan test automático, y se dice en vez de fingirlo:

- **FR-607 (la etiqueta del botón)** y **la mitad visual de FR-606** (que el
  estado vacío explique en vez de esconder). Este repositorio no tiene pruebas de
  componentes —Vitest corre en `node`, sin biblioteca de render— y montarlas para
  dos textos es más máquina que problema.
- **Dónde se verifican: en local, con una organización recién dada de alta**, y
  **no en LanCo**: la pantalla vacía sólo aparece con cero conversaciones, y LanCo
  tiene conversaciones reales desde hace semanas. **Ninguna instancia de la flota
  puede enseñar este estado sin ensuciarla**, así que el nivel 3 de esta
  mini-spec es local por necesidad, no por comodidad.
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

> **Sobre la numeración**: esta spec usa FR-601 en adelante siguiendo la
> costumbre del repositorio, pero **aquí no se decide ninguna banda**. La regla
> —si se adopta— es de gobernanza y va al `constitution.md`, no dentro de una
> feature. Propuesta de pasaje, aparte de esta spec.

---

## Fuera de alcance

- **El borrado de corridas del Laboratorio.** Sigue sin existir; que esta guardia
  cuente las corridas no lo arregla. Es su propio problema y arrastra las
  conversaciones `is_test` huérfanas por las claves foráneas.
- **Que el seed deje de ser destructivo.** Depende de la 021 (arriba).
- **Guardar o restaurar el perfil del agente.** Sin resolver, y dicho arriba.
- **Transaccionalidad del resto del seed.** FR-604 y su nota.
