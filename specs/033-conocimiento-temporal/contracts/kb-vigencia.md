# Contrato: vigencia del conocimiento (033)

Rutas que cambian. Ninguna es nueva; todas siguen tras `withAuth` (o `requireBotKey`) y
`scoped()`.

---

## `GET /api/kb`

Sigue devolviendo **todas** las entradas de la organización (D-07), en orden de
creación. Cada una gana dos campos:

```jsonc
{
  "entries": [
    {
      "id": "kb_...",
      "kind": "qa",
      "question": "¿Hasta cuándo es la promoción?",
      "answer": "El 2x1 es hasta el 15 de octubre.",
      "content": null,
      "validUntil": "2026-10-15",   // nuevo · null = permanente · AAAA-MM-DD
      "estado": "por_vencer",        // nuevo · vigente | por_vencer | vencida
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "hoy": "2026-10-07"                // nuevo · el «hoy» del servidor en la zona del negocio
}
```

- `estado` y `hoy` los calcula el **servidor** (FR-1834).

## `POST /api/kb`

Acepta `validUntil` opcional en los dos tipos:

```jsonc
{ "kind": "qa", "question": "…", "answer": "…", "validUntil": "2026-10-15" }
{ "kind": "block", "content": "…", "validUntil": null }
```

- Ausente o `null` → permanente.
- Una fecha **pasada** se acepta: la entrada nace vencida (archivar a propósito).
- Formato inválido o fecha inexistente → `422 invalid_body` con el mensaje de qué se
  esperaba (`validUntil: La vigencia debe ser una fecha AAAA-MM-DD…` /
  `…Esa fecha no existe en el calendario…`). Nunca `500`.
- La respuesta `201` trae la entrada con `validUntil` y `estado`.

## `PATCH /api/kb/[id]`

Acepta `validUntil` y distingue tres casos:

| Cuerpo | Significado |
|---|---|
| campo ausente | no tocar la fecha (se está editando el texto) |
| `"validUntil": "2026-11-15"` | poner o mover la fecha |
| `"validUntil": null` | **quitar** la fecha → permanente |

- Editar `question`/`answer`/`content` no toca la fecha, y viceversa (FR-1831/FR-1832).
- La respuesta trae la entrada con `validUntil` y `estado`.
- Mismo `422` que el alta para una fecha inválida.

## `DELETE /api/kb/[id]`

Sin cambios: borrar es borrar, también lo vencido.

## `GET /api/kb/size`

Mismo cuerpo (`chars`, `warnAt`, `warning`). Cambia **qué** cuenta: solo lo vigente
(FR-1835). Una entrada vencida deja de consumir presupuesto en cuanto vence.

## `GET /api/bot/profile` (cerebro externo)

Mismo formato (`{ profile, kb, resources }`). `kb` pasa a contener **solo lo vigente**
(FR-1811). `validUntil` no se incluye. Es el cambio observable desde fuera del CRM: un
microservicio que ya funcionaba empezará a recibir menos texto cuando algo venza. Va en
las notas del PR.

## `POST /api/lab/scenarios/generate`

Mismo contrato. Nuevo motivo de `409`:

| `error.code` | Cuándo |
|---|---|
| `kb_vencida` | Hay conocimiento, pero todo está vencido: «Todo tu conocimiento tiene la vigencia vencida… renueva las fechas…» |

`kb_vacia` sigue siendo «no hay ninguna entrada».

## El turno del agente (in-process)

- El system prompt lleva siempre `AHORA ES: <día, fecha con año, hora> (hora del
  negocio)` y la regla del historial (FR-1820, FR-1822), con o sin agenda.
- El historial lleva siempre los separadores de día (FR-1821).
- `runAgentTurn(conversationId, opts?: { ahora?: Date })`: sin `opts`, el reloj real;
  el Laboratorio pasa el `started_at` de la corrida (FR-1840).

## El simulador del modelo (ai-mock)

| Mensaje del cliente | Conocimiento en el prompt | Respuesta |
|---|---|---|
| contiene `KBTOK-X` | contiene `KBTOK-X` | `{"action":"reply","text":"SI_CONOZCO KBTOK-X"}` |
| contiene `KBTOK-X` | no lo contiene | `{"action":"reply","text":"NO_CONOZCO KBTOK-X: no cuento con esa información, la confirmo con el equipo."}` |
| sin `KBTOK-` | — | lo de siempre (sin cambios) |

El token se busca solo en la sección del conocimiento del prompt (entre `CONOCIMIENTO
DEL NEGOCIO` y `Etapas del pipeline`), no en el historial ni en el resto del prompt.
