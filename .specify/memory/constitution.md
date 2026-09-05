<!--
SYNC IMPACT REPORT
==================
Versión: 1.4.0 → 1.5.0

Cambios:
  - Principio X "Irreversibilidad ante Datos de Clientes" → NUEVO: las
    migraciones de esquema son lo único sin marcha atrás (corren al arrancar,
    solo hacia adelante, sin `down`), y quedan bajo cuatro reglas: ensayo
    obligatorio contra un PostgreSQL desechable con respaldo real restaurado
    ANTES de `main` (`pnpm seed:demo` no basta), prohibición de restaurar el
    respaldo de un cliente sobre una instancia viva ajena (es violación del
    Principio I aunque la intención sea probar), cambios destructivos partidos
    en dos entregas (agregar + backfill, borrar después), y plan de reversión
    declarado en todo PR que toque `drizzle/`.
  - Encabezado → REEMPLAZADO: de "open source (MIT), self-hosted y gratuito,
    diseñado para que las agencias de IA lo desplieguen en el VPS de sus
    clientes" a self-hosted "operado como flota" (un despliegue y una base por
    cliente), derivado de Vocero CRM con licencia MIT y atribución conservada,
    desarrollado hoy como repositorio privado.
  - Principio VIII, tercer bullet → REEMPLAZADO: el criterio de aceptación de
    alcance deja de invocar a "la agencia que despliega" (actor que ya no
    existe) y pasa a "el negocio que opera UNA instancia, o el operador de la
    flota en su trabajo de sostener las instancias". El resto del VIII, íntegro.
  - "Flujo de Desarrollo y Puertas de Calidad" → EXPANDIDO: se añade la
    **Puerta de promoción a producción**. El disparador sigue siendo humano
    (señal explícita del responsable, nunca plazo ni automatismo); lo nuevo son
    las seis condiciones que deben cumplirse antes (CI verde para ESE commit en
    toda la matriz; el cambio ya corriendo en la instancia de pruebas con uso
    real; self-test del Principio IX contra la instancia desplegada; ensayo del
    Principio X si se toca `drizzle/`; `git log production..main` revisado; plan
    de reversión declarado) más el cierre verificando `/api/health` en todas las
    instancias contra el commit promovido.
  - Principios I, II, III, IV, V, VI, VII y IX: íntegros (sin cambio).
  - "Restricciones de Plataforma y Seguridad": sin cambio.
  - Governance: sin cambio.

Bump: MINOR (1.4.0 → 1.5.0) — se añade un principio nuevo (X) y se expande una
sección existente (puerta de promoción), sin eliminar ni renumerar nada.
El punto discutible es el tercer bullet del Principio VIII: retira el caso "la
agencia que despliega", y un lector estricto podría llamarlo redefinición
incompatible (MAJOR). Se resuelve como MINOR porque no se retira una capacidad
vigente sino una premisa que ya era falsa — ninguna agencia tercera despliega
Uniko hoy, así que ninguna feature real queda fuera de alcance por el cambio.
Decisión ratificada por el responsable (ver más abajo).

Motivación:
  La constitución seguía describiendo el proyecto que Uniko era —repositorio
  público, sin instancias vivas, sin datos de nadie— y no el que es: tres
  despliegues sobre el mismo `main`, dos con clientes reales, y LanCo a punto de
  dejar de estar vacía. Los tres cambios ya estaban escritos, pero en
  `docs/despliegue-flota.md`, que es un runbook: describe cómo se hace algo, no
  constituye una regla que un PR tenga que cumplir.
  El desbalance que corrige el Principio X es el más grande del repositorio:
  todo lo reversible (tipos, lint, build, tests) tiene máquina detrás en cada
  PR, en dos configuraciones de matriz; lo único irreversible —una migración
  aplicada sobre la base de un cliente— vivía como promesa, sin gate ni mención
  constitucional. Además, el runbook aconsejaba restaurar el respaldo de un
  cliente EN LanCo: con LanCo vacía funcionaba, con LanCo viva sería volcar
  datos de un cliente sobre una instancia que ya recibe los suyos, justo el
  cruce que el Principio I prohíbe.
  Propuesta por escrito y ratificación del responsable (2026-09-05):
  docs/enmienda-constitucional-1.5.0.md. Tres decisiones que la propuesta dejaba
  abiertas quedaron resueltas por el responsable: (1) bump MINOR; (2) encabezado
  con la redacción propuesta, incluida la palabra "flota"; (3) se conserva la
  condición 2 de la puerta de promoción ("ya ejerció uso real"), a sabiendas de
  que es la única no verificable por máquina.

Plantillas dependientes:
  - .specify/templates/plan-template.md — ✅ compatible (sin cambios). Su
    Constitution Check no enumera principios: dice "[Gates determined based on
    constitution file]", así que el Principio X entra solo.
  - .specify/templates/spec-template.md — ✅ compatible (sin cambios).
  - .specify/templates/tasks-template.md — ✅ compatible (sin cambios). Su
    única mención de migraciones es un ejemplo de tarea de andamiaje.
  - .specify/templates/constitution-template.md — ✅ compatible (sin cambios).
    Es un andamio genérico con marcadores (`[PRINCIPLE_N_NAME]`) y ya ejemplifica
    el sufijo "(NON-NEGOTIABLE)"; un décimo principio no le exige nada.
  - CLAUDE.md — ✅ actualizado en este mismo cambio (Principio X y puerta de
    promoción en el bloque de reglas no negociables).
  - docs/despliegue-flota.md — ✅ actualizado en este mismo cambio: el ensayo de
    migraciones pasa a PostgreSQL desechable (ya no "en LanCo") y "Cómo se
    suelta un cambio" enlaza la puerta de promoción.
  - .github/workflows/ci.yml — ✅ actualizado en este mismo cambio: el comentario
    de cabecera justificaba la CI "sobre todo por los PRs de fuera", supuesto
    heredado de la premisa que corrige el Cambio 2.

TODOs diferidos:
  - Deuda documental heredada de la 1.3.0 (features entre `003` y la app 1.2.0
    sin spec): sigue igual; esta enmienda no la toca.
  - Premisa "agencias" residual: el Rationale del Principio II ("El producto se
    regala para que agencias lo desplieguen en VPS de clientes… la promesa
    'gratis y tuyo'") y el párrafo de apertura del Principio VIII ("que las
    agencias despliegan para negocios") siguen apoyándose en el modelo que el
    Cambio 2 corrige. La propuesta ratificada acota el Cambio 2 al encabezado y
    al tercer bullet del VIII, y dice explícitamente que "el resto del Principio
    VIII queda íntegro"; se respeta al pie de la letra y estos dos restos quedan
    para una enmienda de redacción posterior (PATCH). No alteran ninguna regla:
    son texto de justificación, no criterio de aceptación.
-->

# Uniko CRM Constitution

Uniko CRM es un CRM de WhatsApp con agente de IA, self-hosted, operado como
flota: una instancia = un negocio, un despliegue y una base de datos por
cliente. Deriva de Vocero CRM (licencia MIT, atribución conservada) y hoy se
desarrolla como repositorio privado. Esta constitución define las reglas no
negociables del producto. Aplica a todas las fases del flujo de trabajo
(specify, plan, tasks, implement). Cualquier conflicto entre una decisión de
implementación y esta constitución SE RESUELVE A FAVOR de esta constitución.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Si el producto es multi-tenant, todo dato de un tenant está aislado de los demás:
  ninguna consulta, endpoint o tarea en segundo plano debe devolver o modificar datos
  de un tenant distinto al del solicitante. El aislamiento se aplica por defecto.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.

### II. Soberanía / Self-Hosted (ENDURECIDO)

Uniko CRM opera completo sobre la infraestructura del operador. La lista de
dependencias externas en runtime es CERRADA:

- Dependencias externas permitidas en runtime, ÚNICAMENTE:
  1. **WhatsApp Cloud API** (Meta Graph API) — el canal es la razón de ser del
     producto.
  2. **El proveedor LLM**, opcional, accedido EXCLUSIVAMENTE a través del adaptador
     OpenRouter-compatible (`OPENROUTER_BASE_URL` / `OPENROUTER_MODEL`). Sin token
     configurado, el producto funciona como CRM sin agente de IA.
  3. **Conectores opcionales**, únicamente bajo TODAS estas condiciones:
     1. **Apagados por defecto**: se encienden con una bandera de despliegue
        explícita (patrón ADR-001); una instancia default no los carga, no los
        menciona y no pide sus credenciales.
     2. **Aislados tras un adaptador dedicado** con contrato público estable,
        como el cliente Graph API y el adaptador LLM; el dominio no conoce al
        proveedor.
     3. **La instancia funciona completa sin ellos**: existe un camino sin
        dependencia externa para la misma capacidad (p. ej. el conector
        `enlace-fijo` de la agenda), y el fallo del proveedor degrada de forma
        definida — NUNCA bloquea ni pierde la operación core (la cita se crea
        con link pendiente; el mensaje se responde; el dato se guarda).
     4. **Credenciales del propio negocio, cifradas en reposo** (Principio I):
        cada instancia habla con SU cuenta del proveedor; jamás credenciales de
        una plataforma central.
     5. **Verificables apagados y encendidos**: la CI ejercita ambas
        configuraciones y cada conector externo tiene mock con camino infeliz.
- **PROHIBIDO como dependencia del núcleo** (todo lo que el producto necesite
  para operar sin banderas): almacenamiento de objetos externo (S3/R2),
  servicios de email, billing (Stripe u otro) y cualquier servicio de terceros.
  Un servicio de terceros solo puede entrar como conector opcional bajo las
  cinco condiciones anteriores.
- El instalador solo necesita: un VPS con Coolify o Docker, un dominio, credenciales
  de Meta y (opcional) un token de OpenRouter. Nada más.
- Las funciones core —autenticación y base de datos— corren self-hosted (Better
  Auth + PostgreSQL propios de la instancia).
- Las integraciones externas permitidas se aíslan tras adaptadores dedicados
  (cliente Graph API propio; adaptador LLM) para no acoplar el dominio a ellas.

**Rationale**: El producto se regala para que agencias lo desplieguen en VPS de
clientes; cada dependencia externa adicional es un costo, un punto de fallo y una
fuga de soberanía que rompe la promesa "gratis y tuyo".

### III. Multi-Tenancy Real

El sistema sirve a organizaciones independientes desde una sola instancia lógica.
En Uniko cada instancia sirve a UN negocio, pero el modelo de datos es
multi-tenant real (organización del plugin de auth) para mantener el aislamiento
exigible y no cerrar la puerta a evoluciones.

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant (`organization_id`) es un parámetro de primer nivel en
  el modelo de datos y en la capa de acceso a datos, no un campo opcional añadido a
  posteriori. Toda tabla de dominio lo lleva NOT NULL e indexado org-first.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks, notificaciones de
terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, registros duplicados, acciones del agente repetidas).
- Cada evento entrante se identifica de forma única (p. ej. `wa_message_id` UNIQUE)
  y su procesamiento se registra para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código

Ninguna feature se implementa sin una especificación previa. La especificación
describe el comportamiento observable por el usuario, no la implementación.

El **carril** se elige y se declara ANTES de escribir código, y en los tres casos
la decisión queda por escrito:

- **Ciclo completo** (`specify → plan → tasks → implement`) — obligatorio cuando la
  feature toca el **modelo de datos** (cualquier migración) o un **contrato
  publicado** (`/api/bot/*`, el webhook, SSE, o un DTO que consuma algo fuera de
  este repo). Ahí el coste de equivocarse no lo paga quien programa: lo paga quien
  ya tiene datos guardados o un cliente conectado.

- **Carril ligero** (`spec.md` únicamente) — para features con comportamiento
  observable nuevo que NO tocan el modelo de datos ni un contrato. El `spec.md`
  MUST contener, y le basta con: qué problema resuelve, el comportamiento
  observable con criterios de aceptación verificables, y qué se decidió NO hacer y
  por qué.

- **Exento** — correcciones triviales y cambios sin comportamiento observable nuevo
  (typos, formato, refactors internos sin cambio de contrato, dependencias,
  herramientas de desarrollo).

Reglas que sostienen lo anterior:

- Si una feature del carril ligero descubre a mitad de camino que necesita una
  migración o cambiar un contrato, **sube de carril**: se escribe el plan antes de
  continuar, no después de terminar.
- Un spec escrito DESPUÉS de la implementación se marca visiblemente como tal en su
  encabezado. Es documentación, no diseño, y confundirlos hace creer a quien lo lea
  dentro de un año que esas decisiones se tomaron antes de programar.

**Rationale**: Especificar el comportamiento observable antes de codificar previene
retrabajo y mantiene alineadas todas las fases del flujo. Los tres carriles existen
porque un único ciclo, calibrado para una feature que define el producto entero, es
más ceremonia que trabajo en un cambio de doscientas líneas — y una regla que cuesta
más de lo que rinde no se discute: se erosiona en silencio, hasta que "specs antes de
código" significa "sin specs". Nombrar el escalón intermedio es lo que evita que el
siguiente paso hacia abajo sea ninguno.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical — CRM de Conversaciones y Leads de WhatsApp

Es un CRM de conversaciones y leads de WhatsApp que las agencias despliegan para
negocios. No es plataforma de marketing masivo, ni constructor visual de flujos, ni
herramienta de scraping. Lo que no ayude a *atender, organizar y convertir
conversaciones de WhatsApp de UN negocio* se rechaza.

- El modelo de datos y los flujos MUST reflejar ese dominio: contactos que escriben
  por WhatsApp, conversaciones con ventana de 24h, leads en un pipeline, un agente
  de IA que atiende con el conocimiento del negocio y escala a humanos.
- WhatsApp Cloud API es el canal; el producto es el CRM. Features de canal que no
  sirvan a atender/organizar/convertir (broadcast masivo, scraping de números,
  flujos visuales genéricos) quedan FUERA del alcance de v1.
- Toda feature MUST servir al negocio que opera UNA instancia, o al operador
  de la flota en su trabajo de sostener las instancias. Lo que solo sirva a una
  plataforma centralizada (billing, planes, multi-instancia) queda FUERA.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado con el
negocio real y da un criterio claro para aceptar o rechazar alcance.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo.
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

### X. Irreversibilidad ante Datos de Clientes (NO NEGOCIABLE)

Las migraciones de esquema son lo único que este proyecto hace sin marcha
atrás. Corren al arrancar el contenedor, en todas las instancias de la flota,
y se generan solo hacia adelante: no existe `down`. Redesplegar el commit
anterior devuelve el código, nunca el esquema.

- **Ensayo obligatorio contra datos reales.** Todo cambio que toque
  `drizzle/` se ensaya, ANTES de llegar a `main`, contra un PostgreSQL
  desechable con un respaldo real restaurado. Nunca contra base vacía: contra
  una base vacía toda migración pasa; lo que rompe es la forma de los datos
  que ya existen. `pnpm seed:demo` no satisface este requisito.
- **Nunca sobre una instancia viva ajena.** El respaldo de un cliente se
  restaura en un PostgreSQL aislado y desechable, jamás sobre otra instancia
  de la flota. Restaurar datos de un cliente en la instancia de otro es una
  violación del Principio I aunque la intención sea probar.
- **Los cambios destructivos van en dos entregas.** Primero agregar (columna
  nueva, nullable) y backfill; borrar lo viejo en una entrega posterior,
  cuando ya se sabe que nadie lo usa. Una sola entrega que borra no se puede
  deshacer con un redeploy.
- **Un PR que toca `drizzle/` declara su plan de reversión.** Si la respuesta
  honesta es que no se puede revertir, es que le falta partirse en dos
  entregas.

**Rationale**: El resto del proyecto está cubierto por gates que corren solos;
esto no, y es lo único cuyo fallo no se arregla volviendo atrás. Una regla que
solo vive en un runbook se cumple mientras alguien la recuerde — y el día que
no, el costo lo pagan bases de datos de clientes que no participaron en la
decisión.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I y II y son verificables en revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant**: la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados (cliente Graph API propio, adaptador LLM
  OpenRouter-compatible), no dispersas por el dominio.
- **Instancia pública endurecida**: las rutas de mock/desarrollo devuelven 404
  incondicional en producción; el registro se cierra tras la primera organización
  (salvo habilitación explícita); los entornos de prueba internos JAMÁS alcanzan la
  API real de WhatsApp.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo**: depende del carril declarado (Principio VI). En el ciclo
  completo, `specify → plan → tasks → implement`, y cada fase consume el artefacto
  de la anterior. En el carril ligero, `specify → implement`.
- **Puerta constitucional (Constitution Check)**: se evalúa SIEMPRE, en los dos
  carriles — cambia dónde vive, no si ocurre. En el ciclo completo, en el plan:
  antes de la Fase 0 y de nuevo tras el diseño de la Fase 1. En el carril ligero,
  en el propio `spec.md`, antes de escribir código. Las violaciones se registran y
  justifican (Complexity Tracking en el ciclo completo, o una nota explícita en el
  spec) o se eliminan.

  El carril ligero ahorra ceremonia de planificación, NUNCA la revisión
  constitucional: los principios que más caro cuesta romper —aislamiento entre
  inquilinos, soberanía, idempotencia— se violan igual de fácil en doscientas
  líneas que en dos mil.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX).
- **Puerta de promoción a producción**: un cambio pasa de `main` a
  `production` —y con ello a las instancias de clientes— únicamente por señal
  explícita del responsable, nunca por plazo transcurrido ni de forma
  automática. La señal es el disparador; estas condiciones son la puerta, y
  todas deben cumplirse antes:
  1. CI en verde para ESE commit, en todas las configuraciones de la matriz.
  2. El cambio ya corre en la instancia de pruebas (`main` desplegado, no
     `main` recién mergeado) y ahí ejerció uso real.
  3. El self-test de comportamiento del Principio IX ejecutado contra la
     instancia de pruebas desplegada, no solo contra `localhost`.
  4. Si algún commit toca `drizzle/`: el ensayo del Principio X está hecho.
  5. `git log production..main` revisado: quien da la señal reconoce todo lo
     que va a viajar.
  6. Plan de reversión declarado, o el cambio partido en dos entregas.

  La promoción es `git merge --ff-only`: si falla, alguien tocó `production` a
  mano y se corrige antes de seguir, nunca se fuerza. Cierra verificando
  `/api/health` en todas las instancias y comparando el commit reportado
  contra el promovido — las bases de clientes migran al arrancar y a la vez.
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 1.5.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-09-05
