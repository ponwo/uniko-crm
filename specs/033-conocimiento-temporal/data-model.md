# Data Model: 033 — Conocimiento temporal

## Cambio de esquema

### `kb_entry` — una columna

| Columna | Tipo | Nulo | Default | Significado |
|---|---|---|---|---|
| `valid_until` | `date` | **sí** | `NULL` | Último día en que la entrada es verdad, inclusivo. `NULL` = permanente |

- **Nullable a propósito** (D-09): `NULL` es «permanente», el comportamiento de hoy.
  Todas las filas existentes lo heredan; ninguna cambia de estado con la migración.
- **`date`, no `timestamp`** (D-02). En Drizzle: `date("valid_until", { mode: "string" })`,
  así viaja como `"AAAA-MM-DD"` sin pasar por `Date` (que reintroduciría la zona horaria).
- **Sin índice nuevo** (D-09). La lectura va por `organization_id` (`kb_org_idx`).
- Migración: `drizzle/0018_*.sql` = `ALTER TABLE "kb_entry" ADD COLUMN "valid_until" date;`.

`agent_test_run` **no cambia**: el instante de evaluación de una corrida es su
`started_at` (D-10).

## Estados derivados (no almacenados)

Dado `hoy` (`AAAA-MM-DD` en la zona del negocio) y el umbral de 14 días (D-08):

| Estado | Condición | Llega a los modelos |
|---|---|---|
| **vigente** | `valid_until` es `NULL`, o `valid_until > hoy + 14 días` | Sí |
| **por vencer** | `hoy ≤ valid_until ≤ hoy + 14 días` | Sí (es una marca para el dueño; el agente no nota la diferencia) |
| **vencida** | `valid_until < hoy` | **No** |

- El corte es **inclusivo**: con `valid_until = hoy`, la entrada vale todo hoy.
- `hoy` es hoy **en la zona del negocio** (D-05), nunca en UTC: a las 18:30 del 7 en
  México, `hoy` es el 7 aunque en UTC ya sea el 8.
- Las fechas `AAAA-MM-DD` se comparan como cadenas (orden lexicográfico = cronológico).

## Transiciones

No hay máquina de estados: el tiempo avanza y la comparación cambia de resultado. Lo que
un humano provoca es sobre el dato:

```
  (sin fecha) ──pone una fecha futura──▶ vigente / por vencer
  (sin fecha) ──pone una fecha pasada──▶ vencida          (archivar a propósito)
  vigente ─────────pasa el tiempo──────▶ por vencer ──▶ vencida
  vencida ──mueve la fecha o la quita──▶ vigente          (renovar, FR-1831)
  cualquiera ─────edita el texto───────▶ (mismo estado)   (FR-1832)
  cualquiera ─────────la borra─────────▶ (no existe)
```

## Lo que viaja

| Superficie | Qué recibe |
|---|---|
| Agente in-process (`runAgentTurn`) | Solo lo vigente, renderizado como hoy (`renderKb`) |
| `GET /api/bot/profile` | Solo lo vigente, renderizado; **sin** `validUntil` (un cerebro externo no necesita saber cuándo vence lo que ya no recibe, y mandarlo invitaría a reimplementar el filtro) |
| `GET /api/kb` (pantalla) | **Todo**, cada entrada con `validUntil` y `estado` |
| `GET /api/kb/size` | Caracteres de lo vigente |
| Juez del Laboratorio | Lo vigente al `started_at` de la corrida |
| Generador de escenarios | Lo vigente ahora |

## Entidades lógicas (en código)

- `EstadoVigencia = "vigente" | "por_vencer" | "vencida"`.
- `KbEntryConEstado = KbEntry & { estado: EstadoVigencia }`.
- `estadoDeVigencia(validUntil, hoy)` y `soloVigentes(entradas, hoy)`: funciones puras.
- `conocimientoVigente(orgId, ahora?)` y `conocimientoCompleto(orgId, ahora?)`: la
  puerta; ambas calculan `hoy` con `zonaDelNegocio(orgId)`.

## Frontera de organización

Sin tabla nueva. La columna cuelga de `kb_entry`, que ya tiene `organization_id NOT NULL`
y se lee con `scoped()`. Se borra con su organización (`onDelete: cascade`).
