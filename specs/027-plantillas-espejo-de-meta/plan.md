# Plan — 027 Plantillas: espejo de Meta y errores con causa

**Spec**: [spec.md](spec.md) · **Tareas**: [tasks.md](tasks.md) ·
**Verificación**: [quickstart.md](quickstart.md)

Feature de código existente: no hay decisiones de stack que tomar, así que no
hay `research.md`. El modelo de datos cabe aquí.

## Modelo de datos

Tabla `template`, tres columnas nuevas, todas **nullable** (Principio X: solo
agregar):

| Columna | Tipo | Qué guarda |
|---|---|---|
| `meta_status` | `text` | Estado LITERAL de Meta (`APPROVED`, `PAUSED`, `IN_REVIEW`…), sin traducir. NULL = sin noticias de Meta todavía, que también bloquea el envío. |
| `missing_since` | `timestamp` | Cuándo Meta dejó de listarla. NULL = sigue en Meta. |
| `components` | `jsonb` | Los `components` tal como los devuelve Graph (header, body, footer, buttons). NULL en las creadas por el CRM antes de esta feature hasta el siguiente sync. |

`status` (enum `draft|pending|approved|rejected`) **no cambia**: sigue siendo
el ciclo de aprobación que la insignia pinta. Separar las dos preguntas es lo
que evita mentir: forzar PAUSED dentro del enum obligaba a elegir entre
"Pendiente" (falso) y "Rechazada" (falso).

### Migración `0015_plantillas_espejo_de_meta`

```sql
ALTER TABLE "template" ADD COLUMN "meta_status" text;
ALTER TABLE "template" ADD COLUMN "missing_since" timestamp;
ALTER TABLE "template" ADD COLUMN "components" jsonb;
UPDATE "template" SET "meta_status" = 'APPROVED'
  WHERE "status" = 'approved' AND "meta_status" IS NULL;
```

**Por qué el backfill**: `meta_status` pasa a MANDAR sobre el envío. Sin el
`UPDATE`, toda plantilla ya aprobada quedaría sin enviar al desplegar, hasta
que alguien pulsara Sincronizar — una caída silenciosa introducida por la
migración, peor que el fallo que arregla. No inventa nada: a `approved` solo se
llega porque Meta respondió APPROVED (sync o webhook). Re-ejecutable: el
`WHERE` queda vacío en la segunda pasada.

**Plan de reversión**: las columnas son nullable y ningún código anterior las
lee, así que redesplegar el commit previo funciona sin tocar el esquema. Si
hubiera que quitarlas, sería una entrega posterior (`DROP COLUMN`), nunca
esta.

**Ensayo del Principio X**: restaurar el respaldo más reciente de una
instancia real en un Postgres desechable local (`uniko_ensayo_027`), aplicar
`0000..0015` con `scripts/migrate.mjs`, comprobar que las filas `approved`
quedan con `meta_status = 'APPROVED'` y que la app arranca contra esa base. El
resultado se registra en [quickstart.md](quickstart.md).

## Diseño

### `src/lib/meta/client.ts` — el error completo

`MetaApiError` gana `subcode`, `userTitle`, `userMsg` y `detail`
(`error_data.details`), leídos en `graphRequest`, y un getter `explanation`
que devuelve el texto más específico disponible. Nada de esto cambia el
contrato de los demás llamadores (campos opcionales con default `null`).

### `src/lib/meta/template-errors.ts` — la traducción

Mismo patrón que `send-errors.ts`: tabla `subcódigo → frase accionable` para
los documentados por Meta al crear/gestionar plantillas, más los códigos de
permiso (10, 200, 3) y el 33 del objeto inexistente (WABA ID mal copiado). El
resto cae en `explanation` con el código entre paréntesis. Detecta además el
"already exists" por texto (Meta no documenta subcódigo).

### `src/lib/templates.ts` — reglas compartidas

- `normalizeBody`: trim + `{{ n }}` → `{{n}}`.
- `validateBodyVariables`: además de saltos y máximo, variable al inicio, al
  final y variables pegadas (solo espacios entre ellas).
- `esEnviable(t)` y `bloqueoDeMeta(t)` (portadas de kosmo, issue #7).
- `analizarComponentes(components, body)`: qué tiene la plantilla (encabezado
  y formato, pie, botones) y qué le impide al CRM enviarla (`requisito`):
  encabezado no textual o con variable, botones con variable/código, o
  variables con nombre en el cuerpo.

### `src/server/whatsapp/templates.ts`

- `createTemplate`: normaliza, valida, manda `allow_category_change`, guarda
  categoría/estado/`meta_status` de la respuesta; traduce el error de Meta y lo
  registra; ante "ya existe" sincroniza e informa 409.
- `syncTemplates`: `traerTodasLasPlantillas` (cursor, `fields` explícitos,
  tope de páginas), emparejamiento en dos pasadas, import/update/missing,
  `ResumenDeSync`.
- `applyTemplateStatusEvent`: escribe `meta_status` siempre; el enum solo
  cuando es traducible.
- `sendTemplate`: bloquea por ausencia, por `bloqueoDeMeta` y por
  `analizarComponentes(...).requisito`, cada uno con su explicación.

### UI

- `templates-client.tsx`: resumen del sync (importadas/actualizadas/ausentes),
  error del sync visible (también el automático), insignias y explicaciones,
  componentes de las importadas, validación en vivo con las reglas nuevas.
- `template-sender.tsx`, `start-conversation.tsx`, `composer.tsx`: filtran
  con `esEnviable`.

### wa-mock

- Estado de plantillas **por WABA** (`templatesOf`), ids con sello de arranque
  (Meta no recicla ids), estados libres.
- `GET {waba}/message_templates`: valida `fields` contra la lista documentada,
  pagina 25 por cursor opaco.
- `POST {waba}/message_templates`: replica los rechazos síncronos —ejemplos que
  no cuadran (ya existía), variable al inicio/final/pegadas (2388299), nombre
  duplicado (already exists) y, para probar la traducción, un cuerpo que
  contenga `[meta-rechaza]` ⇒ 2388293 con `error_user_msg`.
- `POST /api/dev/wa-mock/seed-templates`: siembra directa por WABA.
- `template-status`: `event` libre (PAUSED…), `wabaId` acotado.

### Arnés

`scripts/e2e-templates-sync.mjs` crece con los escenarios de la spec y entra
en `pnpm test:e2e`; `e2e-templates-multivar.mjs` sigue verde.

## Constitution Check

Ver la sección homónima de la spec; ninguna decisión del plan la altera.
