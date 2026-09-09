# Implementation Plan: 022 — La guardia del seed demo

**Branch**: `022-guardia-seed-demo` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: [`specs/022-guardia-seed-demo/spec.md`](spec.md), ya clarificada (4 preguntas) y con checklist en [`checklists/requirements.md`](checklists/requirements.md).

## Summary

Sustituir `isDomainEmpty()` —que mira contactos, la única tabla garantizadamente
vacía en el negocio al que debía proteger— por una guardia que cubre **lo que la
operación destruye**: conocimiento, historial del Laboratorio y perfil del agente,
más los contactos como señal de negocio vivo. La guardia devuelve **el hallazgo**,
no un booleano; **la misma función** alimenta el render y la ejecución; y la
comprobación corre **dentro de la transacción** que borra, con cerrojo consultivo
para que dos siembras simultáneas no se entrelacen.

Sin migración. El arreglo del Principio III que viaja en el mismo PR (`93b7022`,
*"fix(seed): el seed demo no puede tocar los datos de otra organización"*) ya está
commiteado.

## Technical Context

**Language/Version**: TypeScript 5 estricto (`noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: Next.js 15 (App Router), Drizzle ORM, Better Auth, Zod

**Storage**: PostgreSQL 16 — **sin cambio de esquema** (FR-709)

**Testing**: Vitest con BD simulada (AC-1..AC-11, AC-13, AC-14) · `scripts/e2e-selftest.mjs` (AC-12) · verificación manual en local (FR-707 y la mitad visual de FR-706)

**Target Platform**: contenedor self-hosted, una instancia por negocio

**Project Type**: monolito web

**Performance Goals**: no aplica — es una acción de administración rara. La guardia añade cuatro consultas de conteo a un endpoint que se llama una vez en la vida de una instancia.

**Constraints**: no tocar `drizzle/`; no cambiar el comportamiento para una organización virgen (la demo se sigue cargando igual)

**Scale/Scope**: una organización por instancia; el seed escribe ~40 filas

## Constitution Check

*Contra `.specify/memory/constitution.md` v1.6.0.*

| Principio | Veredicto |
|---|---|
| **I — Seguridad de datos primero** | ✅ No toca secretos. Es, de hecho, una feature de protección de datos. |
| **III — Multi-tenancy real** | ✅ Toda consulta nueva pasa por `scoped()`. El bloque de limpieza ya se acotó en `93b7022`. |
| **IV — Idempotencia** | ✅ El seed sigue siendo re-ejecutable; el cerrojo hace además que dos ejecuciones simultáneas no se pisen. |
| **V — Calidad verificable** | ✅ Gate técnico completo + 14 criterios, cada uno con su observable nombrado. |
| **VI — Specs antes de código** | ✅ Carril **ligero** por definición (no toca modelo de datos ni contrato publicado); se hace spec + plan + tasks, que es más de lo exigido. Banda **FR-7xx** según la regla de la 1.6.0. |
| **IX — Verificación en vivo** | ✅ AC-12 contra la app real; la parte visual, en local — la spec dice por qué no puede ser en LanCo. |
| **X — Irreversibilidad** | ➖ **No aplica**: sin migración, sin ensayo. Nota: la operación que se protege **sí** es destructiva, y de ahí la feature. |

**Sin violaciones que justificar.** La tabla de Complexity Tracking queda vacía.

## Project Structure

### Documentation (this feature)

```text
specs/022-guardia-seed-demo/
├── spec.md                    # clarificada (4 preguntas)
├── plan.md                    # este archivo
├── quickstart.md              # cómo ejercerlo y verificarlo a mano
├── checklists/requirements.md # 8/16, con las ocho rojas justificadas
└── tasks.md                   # /speckit-tasks, todavía no
```

**No hay `research.md`**: no quedan incógnitas. Los dos hechos del código en los
que se apoya la spec —los guiones del Laboratorio son una constante y no filas del
seed; y el invariante de las claves foráneas— están verificados y citados **dentro**
de la spec.

**No hay `data-model.md`**: no cambia el modelo (FR-709).

**No hay `contracts/`**: `/api/seed/demo` lo consume la propia interfaz. No es
contrato publicado según el Principio VI, que nombra `/api/bot/*`, el webhook, SSE
y los DTO que consuma algo de fuera del repositorio.

### Source Code

```text
src/server/seed/
├── demo.ts                    # seedDemo(): transacción + cerrojo; deja de decidir
└── guardia.ts                 # NUEVO — la única función de la guardia (FR-703)

src/app/api/seed/demo/route.ts # POST usa el hallazgo para el 409; GET nuevo para el render
src/components/inbox/conversation-list.tsx  # estado vacío: frase o botón (FR-706, FR-707)
scripts/seed/demo.ts           # --force: conteos + mismo cerrojo (FR-708)

tests/unit/seed-demo-guardia.test.ts   # NUEVO — AC-1..AC-11, AC-13, AC-14
tests/unit/seed-demo-tenant.test.ts    # ya existe, se mantiene
scripts/e2e-selftest.mjs               # AC-12
tests/e2e/us-guardia-demo.md           # NUEVO — guion de la verificación manual
```

**Structure Decision**: la guardia sale a su propio módulo (`guardia.ts`) porque
FR-703 exige **una sola función** para dos llamadores. Dejarla dentro de `demo.ts`
invita a que la ruta acabe escribiendo "su" versión, que es exactamente el fallo
que esta feature arregla, repetido en otra capa.

---

## Decisiones de diseño

Cuatro cosas que la spec no fija y que aquí quedan resueltas.

### D1 — El fake de AC-7 afirma por AUSENCIA, acotado por categoría

**Decisión**: el fake registra el **manejador** de cada sentencia (`db` o `tx`) y
**su tipo**. La afirmación es por ausencia: por el `db` exterior no sale ninguna
sentencia **destructiva** —`DELETE`, `UPDATE`, `TRUNCATE`— ni la comprobación de
la guardia. No "estas siete salen por el `tx`".

Un octavo `DELETE` fuera de la transacción rompe el test **sin que nadie tenga que
acordarse de añadirlo a una lista**. Esa es la diferencia entre un test que
envejece y uno que no.

**Y los `INSERT` se quedan fuera**, como decidió FR-704: son la carga de la demo,
no su destrucción. Acotar por categoría da las dos cosas a la vez —la afirmación
fuerte y el alcance que la spec eligió— sin que el test dicte el diseño. Si el
seed entero debe ser transaccional algún día, se decidirá **por sus méritos**, no
porque a un test le quedara más cómodo.

**Consecuencia sobre el orden del código, y no es menor**: el `UPDATE` de
`agent_profile` **es** destructivo —sobrescribe nombre, tono, instrucciones,
reglas de escalado y saludo—, así que se mueve **dentro** de la transacción, junto
a los borrados y **antes** de las inserciones. Hoy está al final del seed, después
de insertar contactos y conocimiento; ahí quedaría fuera de la transacción y AC-7
lo cazaría. Con el movimiento, la transacción cubre **exactamente la superficie
que la guardia protege** — que es la frase que define esta feature entera.

### D2 — La clave del cerrojo se deriva de la organización y vive en otro espacio

**Decisión**: forma de **dos argumentos**,
`pg_advisory_xact_lock(22, hashtext(<organizationId>))`.

- **No colisiona con `on-signup.ts`**: PostgreSQL mantiene **espacios de bloqueo
  separados** para la forma de un argumento —`pg_advisory_xact_lock(874201)`, la
  del alta— y la de dos. Y aunque compartieran espacio, el `classid` 22, que es el
  número de esta feature, ya los separa. Doble cinturón a propósito: dos features
  serializándose entre sí sin pretenderlo es un fallo que sólo aparece bajo carga
  y no se reproduce cuando lo buscas.
- **Por organización**, no global: dos organizaciones distintas no se esperan
  entre sí.
- `hashtext()` es una función interna de PostgreSQL y **no garantiza estabilidad
  entre versiones mayores**. Aquí da igual: el valor no se persiste ni se compara
  con nada guardado; sólo tiene que ser consistente dentro del mismo clúster en el
  mismo instante.

### D3 — El `--force` del CLI salta la guardia, pero NO el cerrojo

**Decisión**: `seedDemo(db, organizationId, { forzar })`. El cerrojo y el cálculo
del hallazgo ocurren **siempre**, dentro de la transacción y en ese orden. Lo único
que cambia `forzar` es si el hallazgo **detiene** la ejecución.

Dos consecuencias buscadas:

1. Un `--force` lanzado dentro del contenedor **no puede entrelazarse** con un clic
   en la interfaz: los dos contienden por el mismo cerrojo.
2. El hallazgo se calcula aunque se vaya a ignorar, y de ahí salen los conteos que
   FR-708 manda imprimir. Saltarse la comprobación habría dejado al CLI sin nada
   que contar — el requisito y el atajo se habrían contradicho en silencio.

### D4 — La frase del estado vacío se compone del hallazgo, y el caso de UNO manda

**Decisión**: el hallazgo son **datos** —tipo y cuenta por comprobación
incumplida—; la frase se compone con un unidor de lista natural: `A` · `A y B` ·
`A, B y C`.

**El caso de un solo elemento es el que hay que diseñar primero**, porque es el más
probable en un despliegue nuevo: el negocio configuró su agente y todavía no tiene
ni conocimiento ni corridas. Debe leerse así:

> No se puede cargar la demo: **ya configuraste tu agente**. Reemplazaría lo que ya
> escribiste.

y **no** como una enumeración degenerada ("ya tienes: el agente"). Con dos y con
tres elementos la misma plantilla tiene que seguir leyéndose como una frase y no
como una lista con comas pegadas.

**Dos formateadores, un solo dato.** El texto del CLI (FR-708) y el de la pantalla
(FR-706) no comparten registro —"va a borrar 12 entradas de conocimiento" no es
"ya tienes 12 entradas y las reemplazaría"—, así que lo compartido es **el
hallazgo**, no la cadena. El test del formateador de pantalla cubre **uno, dos y
cuatro** elementos; el del CLI es AC-11.

---

## Aspiración registrada para AC-7

El observable elegido (BD simulada) atrapa el **error de programación**
—comprobar fuera, borrar dentro— pero **no prueba el aislamiento real de
PostgreSQL**. La forma fuerte es la **opción B** de la clarificación: base real y
una escritura concurrente desde otra conexión entre la comprobación y el borrado.

Queda **anotado como aspiración**: el día que este repositorio tenga carril de
tests con base de datos —por cualquier otra razón, no por esta feature—, AC-7 se
reescribe contra él. Montarlo ahora para un solo criterio es desproporcionado; y no
dejarlo escrito es exactamente cómo un límite conocido se convierte en un límite
olvidado.

## Complexity Tracking

Sin violaciones de la constitución. Tabla vacía a propósito.
