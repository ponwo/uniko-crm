# 027 — Plantillas: Meta es la autoridad (espejo en tres direcciones y errores con causa)

**Feature Branch**: `027-plantillas-espejo-de-meta`

**Created**: 2026-09-14

**Status**: Draft

**Carril**: **ciclo completo** (`specify → plan → tasks → implement`). Toca el
modelo de datos: tres columnas nuevas en `template` (`meta_status`,
`missing_since`, `components`) y un backfill. El plan de reversión y el ensayo
del Principio X viven en [plan.md](plan.md).

**Banda de requisitos**: FR-12xx, derivada del número de feature —`(27−15)×100`—
según la constitución.

---

## El problema, en dos frases

**Crear una plantilla desde el CRM falla con un error que no dice nada
("(#100) Invalid parameter"), y las plantillas que el negocio ya creó
directamente en el Administrador de WhatsApp nunca aparecen en el CRM.**

---

## Problema

Reportado por el dueño el 2026-09-14 sobre las tres instancias de la flota; el
mismo comportamiento existe en kosmo-crm (el hermano open source), que ya
corrigió la mitad del sync (`6bae070`, `1dc4e16`) pero no la creación.

### 1. La creación "marca error"

`createTemplate` manda a Meta `POST {waba}/message_templates` y, si Meta
responde 4xx, devuelve `err.message` tal cual. El cliente Graph
(`src/lib/meta/client.ts`) solo conserva `error.message`, que para toda
validación de plantilla es el genérico **"(#100) Invalid parameter"**; la
explicación real viaja en `error_user_title`, `error_user_msg` y
`error_data.details`, y se tira.

Meta valida **de forma síncrona** al crear, y ninguna de esas reglas se
comprueba antes en el CRM:

| Subcódigo | Meta dice | Ejemplo que lo dispara |
|---|---|---|
| 2388299 | Variables cannot be at the start or end of the template | `Hola {{1}}` · `{{1}}, tu cita es mañana` · `{{1}} {{2}}` (pegadas) |
| 2388293 | This template has too many variables for its length | `Hola {{1}}, {{2}} el {{3}}` |
| 2388072 | Your message body contains invalid formatting | saltos de línea de más, caracteres raros |
| 2388040 | A field exceeded the maximum character limit | cuerpo > 1024 |
| 2388019 | Maximum number of message templates (250) exceeded | cuenta llena |
| 10 / 200 / 3 | Permission denied | token sin `whatsapp_business_management` |
| 100 (subcódigo 33) | Unsupported post request / object does not exist | WABA ID mal copiado (ID del negocio o del número) |
| — | Message template name already exists | el nombre ya existe en Meta (creada allá, o por un intento anterior) |

Además, `{{ 1 }}` con espacios cuenta como variable para el CRM pero no para
Meta, así que el número de ejemplos deja de cuadrar; y una UTILITY que Meta
clasifica como MARKETING se **rechaza** días después por
`TAG_CONTENT_MISMATCH` cuando bastaba con pedir `allow_category_change`.

### 2. Lo que ya existe en Meta no aparece

`syncTemplates` recorre lo que Meta lista y **descarta en silencio** toda
plantilla sin pareja local (`if (!match) continue`). Es un actualizador de
estados que se cree un espejo: el caso normal de cualquier negocio que usaba el
Administrador de WhatsApp antes de conectar Uniko —o que creó la plantilla allá
porque aquí "marcaba error"— queda invisible y, por tanto, imposible de enviar
(`sendTemplate` parte de la fila local). También lee solo la primera página de
Graph (25) y pide los campos por defecto, que no incluyen `rejected_reason`.

### 3. Y lo que Meta dice después de aprobar, tampoco

`mapMetaStatus` traduce cinco estados. Meta responde además PAUSED, DISABLED,
LIMIT_EXCEEDED, DELETED, ARCHIVED e IN_REVIEW; todos caen en `null` y el sync
los salta, así que una plantilla pausada por calidad sigue "Aprobada" y se
ofrece en el selector hasta que el envío falla con un error de Meta sin
explicación. Una borrada en el Administrador sigue "Aprobada" para siempre.

---

## Lo que se decide

1. **Meta es la autoridad.** El sync es un espejo en tres direcciones: importa
   lo que está en Meta y no aquí, actualiza lo que cambió y marca —nunca
   borra— lo que Meta dejó de listar. Pagina hasta agotar el cursor; una lista
   parcial es un fallo, no un "Todo al día".
2. **El estado crudo de Meta manda sobre el envío.** Columna `meta_status`
   con el estado literal; `status` sigue siendo el ciclo de aprobación que la
   insignia pinta. Enviable = `approved` + sigue en Meta + `meta_status =
   APPROVED` **en positivo**: lo desconocido bloquea por defecto.
3. **Los errores de Meta llegan con su causa y su salida.** El cliente Graph
   conserva subcódigo, título, mensaje de usuario y `error_data.details`; el
   servicio de plantillas traduce los subcódigos conocidos a una frase que dice
   qué pasó y qué hacer, conservando el código para rastrearlo.
4. **Lo que Meta valida al crear se valida antes, en la pantalla y en el
   servidor**, con el mismo código (`lib/templates`): variables al inicio o al
   final, variables pegadas, numeración con saltos, más de diez; y `{{ n }}`
   se normaliza a `{{n}}` antes de mandarlo.
5. **`allow_category_change: true`** al crear: Meta asigna la categoría que
   sus reglas dictan en vez de rechazar por mala clasificación; la que
   responde se guarda y se muestra (ya se decía en pantalla que Meta
   reclasifica).
6. **Nombre duplicado en Meta ⇒ importar, no fallar a secas.** Si Meta
   responde que ya existe, el CRM la importa tal como está allá y lo explica.
7. **Las importadas conservan sus componentes** (`components`, JSON crudo de
   Meta). El CRM solo sabe rellenar el cuerpo con variables posicionales; una
   plantilla con encabezado multimedia, variables con nombre o botones con
   variable se importa, se muestra con la explicación y **no se ofrece para
   enviar** hasta que el CRM sepa rellenarla.

### Lo que se decide NO hacer, y por qué

- **No se editan ni se borran plantillas desde el CRM.** El Administrador de
  WhatsApp ya lo hace bien; el espejo lo refleja al siguiente sync.
- **No se envían plantillas con encabezado multimedia, botones dinámicos ni
  variables con nombre.** Rellenarlas exige UI y contrato nuevos; se bloquean
  con explicación en vez de fallar en Meta. Queda como feature posterior.
- **No se reintenta la creación automáticamente** ante `meta_unavailable`:
  crear no es idempotente en Meta (el nombre queda tomado).

---

## Requisitos funcionales

- **FR-1201** El sync recorre TODAS las páginas de `GET {waba}/message_templates`
  siguiendo `paging.cursors.after`; si el cursor no avanza o se agota el tope,
  responde error (503 `meta_unavailable`), nunca un éxito parcial.
- **FR-1202** El sync **importa** toda plantilla remota sin pareja local, con
  nombre, idioma, categoría, cuerpo (componente BODY), componentes crudos,
  estado traducido (desconocido ⇒ `pending`), `meta_status` literal y
  `wa_template_id`. Re-sincronizar no duplica (misma llave única que la
  creación).
- **FR-1203** El sync **actualiza** estado, `meta_status`, categoría, motivo de
  rechazo, `wa_template_id` y componentes de las emparejadas; empareja primero
  por `wa_template_id` y después por nombre+idioma sobre lo que quedó libre.
- **FR-1204** El sync **marca** con `missing_since` toda fila que Meta dejó de
  listar (excepto borradores) y limpia la marca si reaparece. Nunca borra.
- **FR-1205** `POST /api/templates/sync` responde `{ ok, updated, imported,
  missing }`; la pantalla muestra el resumen, y el fallo del sync automático
  se ve (no se calla).
- **FR-1206** `meta_status` guarda el estado literal de Meta (sync y webhook);
  `status` solo cambia cuando el estado es traducible (APPROVED, REJECTED,
  PENDING/IN_REVIEW/IN_APPEAL/PENDING_DELETION).
- **FR-1207** Enviable ⇔ `status = approved` ∧ `missing_since IS NULL` ∧
  `meta_status = 'APPROVED'` ∧ el CRM sabe rellenar sus componentes. Lo
  aplican la UI (selectores) y `sendTemplate` (última barrera, también para
  `/api/bot/*`), con un mensaje que dice por qué y qué hacer.
- **FR-1208** La creación normaliza `{{ n }}` → `{{n}}` y rechaza en pantalla
  y en el servidor (422): variable al inicio o al final, variables pegadas,
  saltos en la numeración, más de 10.
- **FR-1209** La creación manda `allow_category_change: true` y guarda la
  categoría y el estado que Meta responde.
- **FR-1210** Un error de Meta al crear se devuelve con su causa: subcódigos
  documentados traducidos (2388299, 2388293, 2388072, 2388040, 2388019, 10,
  200, 3, 33) y, para el resto, el texto más específico que Meta mandó
  (`error_user_msg` › `error_data.details` › `error_user_title` › `message`),
  siempre con el código entre paréntesis. El servidor registra el error (sin
  token) para diagnosticarlo desde los logs.
- **FR-1211** Si Meta responde que el nombre ya existe, el CRM sincroniza,
  importa la plantilla y responde 409 explicando que ya existía y que ahora
  está en la lista.
- **FR-1212** La pantalla de plantillas muestra: insignia del ciclo, ausencia
  ("Ya no está en Meta" con fecha), bloqueo de Meta con explicación (pausada,
  deshabilitada, límite, borrada, desconocido), motivo de rechazo, y —en las
  importadas— qué componentes tienen y si el CRM puede enviarlas.
- **FR-1213** El wa-mock reproduce lo anterior: plantillas por WABA, paginación
  por cursor (25 por página), validación de `fields`, estados libres,
  siembra directa (`POST /api/dev/wa-mock/seed-templates`), y los rechazos
  síncronos de Meta (variables al inicio/final, nombre duplicado, y un
  rechazo forzado con subcódigo para probar la traducción).

---

## Escenarios de aceptación

1. **Ya tenía plantillas.** Se siembran en el mock tres plantillas (una
   APPROVED con cuerpo, una PAUSED, una con encabezado IMAGE) sin pasar por el
   CRM. Tras `POST /api/templates/sync`: las tres aparecen (`imported: 3`); la
   aprobada es enviable; la pausada muestra "Pausada por Meta" y no se ofrece;
   la de encabezado muestra "Encabezado: imagen — el CRM todavía no la envía".
2. **Paginación.** 30 plantillas en Meta ⇒ las 30 sincronizadas, no 25.
3. **Desaparece de Meta.** Se vacía el panel simulado; el sync reporta
   `missing`, la fila sigue, con fecha; si reaparece, la marca se limpia.
4. **Crear con la variable al final** (`Hola {{1}}`): la pantalla lo avisa y el
   botón se deshabilita; por API, 422 con la regla. Lo mismo con `{{1}} {{2}}`.
5. **Crear algo que Meta rechaza síncronamente** (el mock lo fuerza con
   subcódigo 2388293): 422 con la frase traducida y `(Meta 100/2388293)`.
6. **Nombre que ya existe en Meta**: 409, la plantilla queda importada tal
   como está allá y el mensaje lo dice.
7. **Crear en el camino feliz**: 201, `pending`, `meta_status = PENDING`,
   categoría la que Meta responde.
8. **Webhook PAUSED**: `meta_status = PAUSED`, `status` intacto, deja de ser
   enviable en segundos; el envío por API responde 422 diciendo "pausada".
9. **Camino infeliz**: Meta caído ⇒ el sync responde 503, la pantalla pinta la
   lista local y DICE que es local; la creación responde 503 sin tocar la base.

---

## Constitution Check

- **I (seguridad)**: el token nunca se registra; los logs llevan código,
  subcódigo y textos de Meta, nada más.
- **II (soberanía)**: sigue siendo solo WhatsApp Cloud API por `graphRequest`;
  no se navega a la URL absoluta de `paging.next`, se sigue el cursor.
- **III (multi-tenancy)**: toda lectura/escritura de `template` pasa por
  `scoped()` o por el id de una fila ya acotada.
- **IV (idempotencia)**: import con `onConflictDoUpdate` sobre la llave única
  existente; el backfill es re-ejecutable.
- **Sandbox**: `sendTemplate` conserva la aserción dura de `is_test`.
- **X (irreversibilidad)**: solo columnas nuevas nullable + backfill; ensayo
  contra respaldo real antes de `main` (ver plan).
