# Propuesta de enmienda constitucional — 1.4.0 → 1.5.0

**Estado**: PROPUESTA. Pendiente de ratificación del responsable del proyecto.
**Fecha de propuesta**: 2026-09-05
**Bump propuesto**: MINOR (ver "Nota sobre el bump" al final — hay un argumento
razonable para MAJOR y conviene decidirlo a conciencia).

Presentada conforme al procedimiento de enmienda del apartado Governance, que
exige propuesta por escrito con su motivación y aprobación del responsable. Sigue
el precedente de `specs/015-motor-agenda-universal/enmienda-constitucional.md`.

---

## Por qué esta enmienda ahora

Los tres cambios que siguen tienen una causa común: **la constitución todavía
describe el proyecto que Uniko era, no el que es.** Se escribió cuando esto era
un repositorio público que otros desplegarían, sin instancias vivas y sin datos
de nadie. Hoy hay tres despliegues sobre el mismo `main`, dos con clientes
reales, y LanCo a punto de dejar de estar vacía.

Ninguno de los tres es una idea nueva. Los tres ya están escritos, pero en
`docs/despliegue-flota.md`, que es un runbook: describe cómo se hace algo, no
constituye una regla que un PR tenga que cumplir. La diferencia importa
justamente en lo que esta enmienda cubre, porque es lo único irreversible que
hace el proyecto.

---

## Cambio 1 — Principio nuevo: X. Irreversibilidad ante Datos de Clientes

### Motivación

Es el desbalance más grande del repositorio. Todo lo que **sí** se puede
deshacer tiene máquina detrás: tipos, lint, build y tests corren en CI, en dos
configuraciones de matriz, en cada PR. Lo único que **no** se puede deshacer —
una migración aplicada sobre la base de un cliente — vive como promesa en un
documento, sin gate, sin checklist y sin mención constitucional.

La asimetría técnica es dura: las migraciones corren al arrancar el contenedor,
Drizzle las genera solo hacia adelante y no hay `down`. Redesplegar el commit
anterior devuelve el código, no el esquema. Un PR que borra una columna y llega
a `production` no tiene marcha atrás por redeploy en dos bases de clientes a la
vez.

Hay además un cambio de circunstancias que rompe una regla vigente del runbook.
Hoy dice que la vía limpia para probar una migración es *restaurar en LanCo un
respaldo de un cliente*. Eso funcionaba con LanCo vacía; con LanCo viva
significaría volcar datos de un cliente encima de una instancia que está
recibiendo los suyos por WhatsApp — precisamente el cruce que el Principio I
prohíbe. La enmienda separa las dos cosas que ese consejo tenía pegadas.

### Texto propuesto

> ### X. Irreversibilidad ante Datos de Clientes (NO NEGOCIABLE)
>
> Las migraciones de esquema son lo único que este proyecto hace sin marcha
> atrás. Corren al arrancar el contenedor, en todas las instancias de la flota,
> y se generan solo hacia adelante: no existe `down`. Redesplegar el commit
> anterior devuelve el código, nunca el esquema.
>
> - **Ensayo obligatorio contra datos reales.** Todo cambio que toque
>   `drizzle/` se ensaya, ANTES de llegar a `main`, contra un PostgreSQL
>   desechable con un respaldo real restaurado. Nunca contra base vacía: contra
>   una base vacía toda migración pasa; lo que rompe es la forma de los datos
>   que ya existen. `pnpm seed:demo` no satisface este requisito.
> - **Nunca sobre una instancia viva ajena.** El respaldo de un cliente se
>   restaura en un PostgreSQL aislado y desechable, jamás sobre otra instancia
>   de la flota. Restaurar datos de un cliente en la instancia de otro es una
>   violación del Principio I aunque la intención sea probar.
> - **Los cambios destructivos van en dos entregas.** Primero agregar (columna
>   nueva, nullable) y backfill; borrar lo viejo en una entrega posterior,
>   cuando ya se sabe que nadie lo usa. Una sola entrega que borra no se puede
>   deshacer con un redeploy.
> - **Un PR que toca `drizzle/` declara su plan de reversión.** Si la respuesta
>   honesta es que no se puede revertir, es que le falta partirse en dos
>   entregas.
>
> **Rationale**: El resto del proyecto está cubierto por gates que corren solos;
> esto no, y es lo único cuyo fallo no se arregla volviendo atrás. Una regla que
> solo vive en un runbook se cumple mientras alguien la recuerde — y el día que
> no, el costo lo pagan bases de datos de clientes que no participaron en la
> decisión.

---

## Cambio 2 — Corregir la premisa del producto (encabezado + Principio VIII)

### Motivación

El párrafo de apertura describe a Uniko como un producto *"open source (MIT),
self-hosted y gratuito, diseñado para que las agencias de IA lo desplieguen en el
VPS de sus clientes"*. Eso describe a Vocero, no a Uniko: hoy es un repositorio
privado, y las instancias no las despliegan agencias terceras sino el propio
operador de la flota.

No es cosmético, y esa es la razón de meterlo en una enmienda en vez de en un
`fix:` de redacción. El **Principio VIII usa esa premisa como criterio de
aceptación de alcance**: "toda feature MUST servir a la agencia que despliega o
al negocio que opera UNA instancia". Mientras diga eso, cada evaluación de
alcance —humana o de un asistente leyendo la constitución— se hace contra un
modelo de negocio que ya cambió, y "la agencia que despliega" es hoy un actor
que no existe.

Lo que **no** cambia y conviene dejar dicho para que nadie lo "limpie" después:
la licencia sigue siendo MIT y la atribución original a Vocero CRM y a Kevin
Belier se conserva en `LICENSE` y en los agradecimientos del README. Lo que dejó
de ser cierto es la distribución pública, no la licencia.

### Texto propuesto — encabezado

> Uniko CRM es un CRM de WhatsApp con agente de IA, self-hosted, operado como
> flota: una instancia = un negocio, un despliegue y una base de datos por
> cliente. Deriva de Vocero CRM (licencia MIT, atribución conservada) y hoy se
> desarrolla como repositorio privado. Esta constitución define las reglas no
> negociables del producto. Aplica a todas las fases del flujo de trabajo
> (specify, plan, tasks, implement). Cualquier conflicto entre una decisión de
> implementación y esta constitución SE RESUELVE A FAVOR de esta constitución.

### Texto propuesto — Principio VIII, tercer bullet

> - Toda feature MUST servir al negocio que opera UNA instancia, o al operador
>   de la flota en su trabajo de sostener las instancias. Lo que solo sirva a una
>   plataforma centralizada (billing, planes, multi-instancia) queda FUERA.

El resto del Principio VIII queda íntegro. También conviene revisar en el mismo
PR el comentario de cabecera de `.github/workflows/ci.yml`, que justifica la CI
diciendo que existe "sobre todo por los PRs de fuera" — supuesto heredado del
mismo origen. La CI sigue valiendo la pena; su razón es otra.

---

## Cambio 3 — Puerta de promoción a producción

### Motivación

El runbook describe el mecanismo (`main` → `production` por `--ff-only`, LanCo
sigue `main`, los clientes siguen `production`) pero no dice **qué tiene que ser
cierto para promover**. Hoy es "cuando convence", que es criterio del momento en
que se dice. El día con prisa, "pásalo" significa "ya jala".

El disparador sí es y debe seguir siendo humano: una señal explícita del
responsable, no un plazo. Un plazo mide reposo, no evidencia. Lo que la
enmienda agrega es la puerta que esa señal abre: la señal es la manija, la
checklist es la puerta.

Con `/api/health` devolviendo ya el commit desplegado (`resolveBuildCommit`), la
comprobación de cierre es verificable con `curl` en vez de por confianza — y eso
importa especialmente porque las migraciones corren al arrancar: un contenedor
que no levanta porque la migración reventó no avisa, pero su health sigue
reportando el commit viejo.

### Texto propuesto — añadir a "Flujo de Desarrollo y Puertas de Calidad"

> - **Puerta de promoción a producción**: un cambio pasa de `main` a
>   `production` —y con ello a las instancias de clientes— únicamente por señal
>   explícita del responsable, nunca por plazo transcurrido ni de forma
>   automática. La señal es el disparador; estas condiciones son la puerta, y
>   todas deben cumplirse antes:
>   1. CI en verde para ESE commit, en todas las configuraciones de la matriz.
>   2. El cambio ya corre en la instancia de pruebas (`main` desplegado, no
>      `main` recién mergeado) y ahí ejerció uso real.
>   3. El self-test de comportamiento del Principio IX ejecutado contra la
>      instancia de pruebas desplegada, no solo contra `localhost`.
>   4. Si algún commit toca `drizzle/`: el ensayo del Principio X está hecho.
>   5. `git log production..main` revisado: quien da la señal reconoce todo lo
>      que va a viajar.
>   6. Plan de reversión declarado, o el cambio partido en dos entregas.
>
>   La promoción es `git merge --ff-only`: si falla, alguien tocó `production` a
>   mano y se corrige antes de seguir, nunca se fuerza. Cierra verificando
>   `/api/health` en todas las instancias y comparando el commit reportado
>   contra el promovido — las bases de clientes migran al arrancar y a la vez.

---

## Artefactos dependientes a actualizar en el mismo PR

- `docs/despliegue-flota.md` — sustituir el consejo de restaurar un respaldo de
  cliente *en LanCo* por el ensayo en PostgreSQL desechable (Principio X);
  enlazar la puerta de promoción desde "Cómo se suelta un cambio".
- `CLAUDE.md` — añadir el Principio X y la puerta de promoción al bloque "Reglas
  de la constitución (no negociables)".
- `.github/workflows/ci.yml` — comentario de cabecera (Cambio 2).
- `.specify/templates/plan-template.md` — verificar que su Constitution Check
  no enumere principios de forma cerrada; si lo hace, incluir el X.
- `.specify/templates/spec-template.md`, `tasks-template.md` — revisar; se
  espera que queden compatibles sin cambios.
- `.specify/templates/constitution-template.md` — revisar por coherencia de
  formato con el nuevo principio.

## Nota sobre el bump

Se propone **MINOR**: se añade un principio nuevo y se expanden secciones
existentes, sin eliminar ninguno.

El punto discutible es el Cambio 2. El Principio VIII hoy admite features que
sirvan a "la agencia que despliega", y la redacción propuesta retira ese caso;
un lector estricto puede llamarlo redefinición incompatible y por tanto MAJOR.
El argumento a favor de MINOR es que no se retira una capacidad vigente sino una
premisa que ya era falsa: ninguna agencia tercera despliega Uniko hoy, así que
ninguna feature real queda fuera de alcance por este cambio. Queda a criterio
del responsable.

## Decisiones ratificadas por el responsable

1. **Bump**: MINOR (1.4.0 → 1.5.0).
2. **Encabezado**: se usa la redacción propuesta, con la palabra "flota".
3. **Puerta de promoción**: se conserva la condición 2 ("ya ejerció uso real"),
   aun sabiendo que es la única no verificable por máquina.
