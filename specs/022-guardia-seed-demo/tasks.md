# Tasks: 022 — La guardia del seed demo

**Input**: [`spec.md`](spec.md) (clarificada) · [`plan.md`](plan.md) · [`quickstart.md`](quickstart.md) · [`checklists/requirements.md`](checklists/requirements.md)

**Tests**: SÍ. La spec los pide explícitamente: los catorce criterios de aceptación
"van como tests", y once de ellos son automáticos.

**Organización**: esta mini-spec **no tiene historias de usuario** —tiene nueve
requisitos y catorce criterios—, así que las fases no llevan etiqueta `[US*]`. Se
agrupan por **incremento entregable**: cada fase deja el producto en un estado
coherente y verificable por sí mismo.

## Format: `[ID] [P?] Description`

- **[P]**: se puede hacer en paralelo — archivo distinto, sin dependencia pendiente.
- Los tests que comparten archivo **no** llevan `[P]`, aunque sean independientes
  entre sí.

---

## Fase 1: La guardia existe y dice qué encontró

**Objetivo**: la función que decide, con su hallazgo, probada en aislamiento. Al
terminar esta fase nada ha cambiado para el usuario todavía.

**Verificación independiente**: `pnpm test` en verde con los criterios nuevos; la
app se comporta exactamente como antes.

- [x] T001 Crear `src/server/seed/guardia.ts` con el tipo del hallazgo
      (`{ virgen: boolean; encontrado: Hallazgo[] }`, donde cada `Hallazgo` lleva
      qué comprobación falló y cuánto hay) y la función `revisarDemo(db, organizationId)`
      con las cuatro comprobaciones de FR-701 — contactos, `kb_entry`,
      `agent_test_run` y perfil sin tocar—, **todas por `scoped()`** (FR-701, FR-702)
- [x] T003 Crear `tests/unit/seed-demo-guardia.test.ts` con la BD simulada del
      patrón de `tests/unit/seed-demo-tenant.test.ts` (conexión por parámetro,
      captura de sentencias)
- [x] T004 AC-1 en `tests/unit/seed-demo-guardia.test.ts`: correr `onUserCreated()`
      contra la BD simulada, **capturar el `INSERT` de `agent_profile`** y dárselo
      a la guardia; afirmar que la considera virgen. El perfil **no** se escribe a
      mano en el test
- [x] T005 AC-4 en `tests/unit/seed-demo-guardia.test.ts`: **seis casos
      independientes**, uno por campo del perfil (`enabled`, `name`, y los cuatro
      textos), cada uno con lo demás virgen
- [x] T006 AC-2, AC-3 y AC-5 en `tests/unit/seed-demo-guardia.test.ts`: con
      conocimiento y cero contactos, y con corridas y cero contactos, **rechazo y
      ningún `DELETE` emitido**; con todo limpio, la carga procede
- [x] T007 AC-6 y AC-8 en `tests/unit/seed-demo-guardia.test.ts`: los invariantes
      del esquema en los que se apoya la guardia — `conversation.contactId`,
      `message.conversationId` y `lead.contactId` `NOT NULL`, y
      `agent_test_case.runId` `NOT NULL` con cascada

---

## Fase 2: Que no se pueda destruir por accidente

**Objetivo**: la guardia manda, dentro de la transacción y con cerrojo. Es el
incremento que cierra el agujero.

**Verificación independiente**: con conocimiento y sin contactos, `POST /api/seed/demo`
responde 409 y no borra nada. Con la organización virgen, la demo se carga igual
que siempre.

- [x] T008 En `src/server/seed/demo.ts`: envolver **cerrojo → comprobación →
      limpieza** en un `db.transaction()`, tomando
      `pg_advisory_xact_lock(22, hashtext(<organizationId>))` como **primera
      sentencia** (FR-704, decisión D2 del plan)
- [x] T009 En `src/server/seed/demo.ts`: **mover el `UPDATE` de `agent_profile`
      dentro de la transacción**, junto a los borrados y antes de las inserciones.
      Hoy está al final del seed; ahí queda fuera y AC-7 lo caza. Es destructivo:
      sobrescribe nombre, tono, instrucciones, escalado y saludo
- [x] T010 En `src/server/seed/demo.ts`: firma `seedDemo(db, organizationId, { forzar })`.
      El cerrojo y el cálculo del hallazgo ocurren **siempre**; `forzar` sólo decide
      si el hallazgo detiene la ejecución (decisión D3 del plan). `forzar` lleva
      **valor por defecto `false`**: sin él, cambiar la firma obliga a editar la
      ruta en esta misma tarea, y eso arrastraría T002 y T011 de vuelta aquí
- [x] T002 Eliminar `isDomainEmpty()` de `src/server/seed/demo.ts` y sustituir su
      uso en `src/app/api/seed/demo/route.ts`. **No dejar envoltorio booleano**:
      un booleano disponible es un booleano que alguien vuelve a usar (FR-702)

      > **Por qué vive aquí y no en la Fase 1**: no es la redacción de una frase.
      > Dejarla allí abre una ventana —una fase entera— en la que la guardia **ya
      > rechaza** con las cuatro comprobaciones pero el usuario recibe el **mensaje
      > viejo, sin detalle**: sabe que no puede y no sabe por qué. Entra junto a
      > T011 para que rechazar y explicar lleguen a la vez.
- [x] T011 En `src/app/api/seed/demo/route.ts`: el `POST` responde **409 con el
      detalle estructurado** del hallazgo, no sólo un mensaje (FR-705)
- [x] T012 AC-7 en `tests/unit/seed-demo-guardia.test.ts`: el fake registra
      **manejador y tipo** de cada sentencia. Se afirma que por el `db` exterior
      **no sale ninguna destructiva** (`DELETE`, `UPDATE`, `TRUNCATE`) —por
      ausencia, no por lista— **y el ancla de vitalidad, que son DOS
      afirmaciones**: (a) que el callback de la transacción **corrió** y (b) que
      **por el `tx` salieron sentencias destructivas**. Quedarse en (a) deja
      pasar un fake que ejecuta el callback y no borra nada; quedarse en la
      ausencia deja pasar uno que no ejecuta nada
- [x] T013 AC-13 en `tests/unit/seed-demo-guardia.test.ts`: la **primera** sentencia
      del `tx` es el `pg_advisory_xact_lock`, antes de la comprobación y de
      cualquier borrado
- [x] T014 AC-9 en `tests/unit/seed-demo-guardia.test.ts`: capturar las columnas del
      `UPDATE` de `agent_profile` —quitando `updated_at`— y afirmar **vigilado ⊇
      escrito**, con `enabled` declarado como vigilado a propósito aunque el seed
      no lo escriba
- [x] T015 AC-10 en `tests/unit/seed-demo-guardia.test.ts`: la función que construye
      el rechazo incluye el detalle estructurado además del mensaje
- [x] T016 En `scripts/seed/demo.ts`: `--force` sigue existiendo y **imprime los
      conteos de lo que va a destruir** antes de hacerlo — entradas de
      conocimiento, corridas, contactos demo y si el perfil está configurado
      (FR-708)
- [x] T017 AC-11 en `tests/unit/seed-demo-guardia.test.ts`: el texto del CLI se
      construye **desde el hallazgo**, no de un recuento propio; con un hallazgo de
      ejemplo nombra las tres cosas

---

## Fase 3: Que la pantalla lo explique

**Objetivo**: el usuario entiende por qué no puede, sin pulsar nada.

**Verificación independiente**: las cuatro pantallas del
[quickstart](quickstart.md) en local.

- [ ] T018 En `src/app/api/seed/demo/route.ts`: añadir el `GET` que devuelve el
      hallazgo para el render, llamando a **la misma** `revisarDemo()` (FR-703)
- [ ] T019 Crear el formateador de la frase de pantalla en `src/server/seed/guardia.ts`
      (o módulo hermano): compone desde el hallazgo con unidor de lista natural
      —`A` · `A y B` · `A, B y C`— y **se lee como una frase con UN solo
      elemento**, que es el caso más probable en un despliegue nuevo (FR-706,
      decisión D4 del plan)
- [ ] T020 Test del formateador en `tests/unit/seed-demo-guardia.test.ts`: **uno,
      dos y cuatro** elementos. El de uno es el que manda
- [ ] T021 En `src/components/inbox/conversation-list.tsx`: el estado vacío consulta
      el `GET`; con la organización no virgen **no muestra botón** sino la frase; y
      **mientras la comprobación viaja no muestra ningún botón** (FR-706)
- [ ] T022 En `src/components/inbox/conversation-list.tsx`: la etiqueta del botón
      dice que **sustituye la configuración del agente**, no sólo que carga datos
      (FR-707)
- [ ] T023 AC-14 en `tests/unit/seed-demo-guardia.test.ts`: espiar
      `@/server/seed/guardia` con `vi.mock` —devolviendo un hallazgo **bien
      formado**, no un `vi.fn()` pelado— y afirmar que `seedDemo()` lo llama **y
      que el primer argumento es el `tx`, no el `db` exterior**; más la
      comprobación estática de que `guardia.ts` exporta una sola función de
      decisión y el módulo de la ruta la importa de ahí. **Sin simulación de
      sesión**: los handlers no se ejercen aquí

---

## Fase 4: Verificación y cierre

- [ ] T024 AC-12 en `scripts/e2e-selftest.mjs`: `POST /api/seed/demo` contra la
      organización del arnés responde **409** con detalle, y una lectura posterior
      confirma que **el conocimiento del arnés sigue ahí**
- [ ] T025 [P] Crear `tests/e2e/us-guardia-demo.md` con las cuatro pantallas del
      quickstart y el hueco para registrar la corrida, con la regla de siempre:
      **lo que no se vio no se marca**
- [ ] T026 Corrida manual en local siguiendo el [quickstart](quickstart.md): base
      desechable, alta real, los cuatro casos —incluido **sólo el perfil tocado**—
      y el CLI con y sin `--force`. Registrar en `tests/e2e/us-guardia-demo.md`
- [ ] T027 Gate técnico desde la ruta real:
      `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] T028 Al abrir el PR: declarar **FR-709** —el diff no toca `drizzle/`— y que
      el PR lleva también el arreglo del Principio III (`93b7022`)
- [ ] T029 **Puerta de promoción, condición 3**: con LanCo ya desplegada con este
      commit, `POST https://uniko.lanco.cloud/api/seed/demo` responde **409 con el
      detalle**, y una lectura posterior confirma que su conocimiento sigue ahí.
      Registrar el resultado en `tests/e2e/us-guardia-demo.md`

      > No es un extra ni una repetición de T024. El Principio IX y la condición 3
      > de la puerta exigen el self-test **contra la instancia desplegada, no sólo
      > contra `localhost`**, y T024 corre en el arnés local. Aquí sale barato y es
      > seguro: lo que se espera es que **no pase nada**.

---

## Dependencias

- **T001 bloquea todo lo demás**: sin el hallazgo no hay nada que devolver ni que
  formatear.
- **T003 antes que T004..T007, T012..T015, T017, T020 y T023**: comparten archivo.
- **T001 → T002 → T011**: la ruta no puede llamar a la guardia antes de que
  exista, y T011 reescribe la respuesta de la misma llamada que T002 introduce.
  Los tres cambios del rechazo viajan juntos, a propósito.
- **T008 antes que T012, T013 y T023**: no se puede afirmar sobre una transacción
  —ni sobre el `tx` que AC-14 mira— que todavía no existe.
- **T009 antes que T012**: mientras el `UPDATE` del perfil siga al final del seed,
  AC-7 falla — y debe fallar.
- **T010 antes que T016**: el CLI necesita la firma con `forzar`.
- **T018 y T019 antes que T021**: la pantalla necesita el dato y la frase.
- **T024..T029 al final**, cuando hay algo que verificar. **T029 es posterior al
  despliegue**, no sólo al merge.

## Paralelismo

Poco, y conviene decirlo en vez de fabricarlo: **casi todos los tests viven en un
solo archivo** (`tests/unit/seed-demo-guardia.test.ts`) y las tres piezas de
producción son tres archivos que se tocan en orden.

Lo que sí es paralelo:

- **T025** (el guion `.md`) con cualquier tarea de código.
- **T016** (CLI) con **T018..T022** (pantalla), en cuanto T010 esté hecha: son
  archivos distintos y no se cruzan.

## MVP

**Fases 1 y 2.** Con eso el agujero está cerrado: la guardia cubre lo que la
operación destruye, corre dentro de la transacción y con cerrojo, y la ruta
responde 409 sin borrar nada. La Fase 3 hace que el usuario **entienda** por qué,
que es valioso y no es lo urgente.

Dicho de otra forma: al final de la Fase 2 el negocio ya no pierde su
conocimiento; al final de la Fase 3, además, sabe por qué el botón no está.

## Cobertura de requisitos

| Requisito | Tareas |
|---|---|
| FR-701 — qué comprueba la guardia | T001, T004..T007 |
| FR-702 — devuelve el hallazgo, sin booleano | T001, T002, T015 |
| FR-703 — una sola función, dos usos | T018, T023 |
| FR-704 — transacción y cerrojo | T008, T009, T012, T013 |
| FR-705 — 409 con detalle | T011, T015, T024, T029 |
| FR-706 — el estado vacío explica | T019, T020, T021 |
| FR-707 — la etiqueta dice lo que hace | T022, T026 |
| FR-708 — `--force` cuenta lo que destruye | T010, T016, T017 |
| FR-709 — sin migración | T028 |
