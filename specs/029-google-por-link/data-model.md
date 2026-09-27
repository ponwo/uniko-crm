# Data Model — 029 Conexión de Google Calendar por link

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md) (D3)

Un cambio de esquema, **solo aditivo**: la tabla `google_link`. La conexión de Google
de la 015 (`google_credentials`) **no cambia**: esta feature solo cambia cómo llega el
permiso, no qué se guarda.

## Tabla `google_link` — el registro de links de conexión

| Columna | Tipo | Nulo | Qué guarda |
|---|---|---|---|
| `id` | `text` PK | no | `glink_<nanoid>` |
| `organization_id` | `text` FK → `organization.id` (`cascade`) | no | Principio III |
| `token_hash` | `text` UNIQUE | no | SHA-256 hex de la llave del link. La llave no se guarda (FR-1408). |
| `created_by` | `text` FK → `user.id` (`set null`) | sí | Quién lo generó. Nulo si ese usuario se borró: el registro se conserva. |
| `expires_at` | `timestamp` | no | Emisión + 72 h (FR-1406). |
| `used_at` | `timestamp` | sí | Cuándo terminó en una conexión. |
| `revoked_at` | `timestamp` | sí | Cuándo se revocó (a mano o al generar otro). |
| `created_at` | `timestamp` default `now()` | no | |

Índices: `google_link_token_uq` (UNIQUE `token_hash`) y `google_link_org_idx`
(`organization_id`).

### Estados

```text
            generar                 recorrido exitoso
  (nada) ───────────▶ PENDIENTE ─────────────────────▶ USADO
                          │  │
            revocar /     │  │  pasan 72 h
        generar otro      │  └──────────────────────▶ VENCIDO
                          ▼
                       REVOCADO
```

- **Pendiente**: `used_at IS NULL AND revoked_at IS NULL AND expires_at > ahora`.
- USADO, REVOCADO y VENCIDO son **terminales**: ninguna operación vuelve a poner
  `used_at` o `revoked_at` a nulo (FR-1409). Desconectar Google no toca esta tabla.
- **El corte temporal se decide en código, no en SQL** (memoria
  `fallos-que-solo-aparecen-con-el-tiempo`): las consultas traen la fila y la
  comparación con "ahora" usa un reloj inyectable. Así una prueba puede leer un link
  "de hace tres días" y el mock de base de los unitarios —que ignora el `where`— no
  esconde el corte.

### Operaciones

| Operación | Qué hace | Atomicidad |
|---|---|---|
| **Generar** | `UPDATE … SET revoked_at = ahora WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL` y `INSERT` del nuevo | Una transacción: nunca dos pendientes (FR-1407). Revocar uno ya vencido es inocuo, por eso el `UPDATE` no mira el tiempo. |
| **Revocar** | El mismo `UPDATE` sin el `INSERT` | — |
| **Pendiente** (pantalla) | El más reciente de la organización con `used_at` y `revoked_at` nulos; vigente si `expires_at > ahora` (en código) | — |
| **Validar** (al abrir el link) | Buscar por `token_hash`; comprobar organización, usado, revocado y vencimiento (en código) | — |
| **Consumir** (al conectar) | `UPDATE … SET used_at = ahora WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL RETURNING id` + guardar credenciales | **Una transacción**: sin fila devuelta ⇒ link ya usado o revocado ⇒ no se guarda nada (FR-1416, FR-1419). |

## Migración `0016_google_link`

```sql
CREATE TABLE IF NOT EXISTS "google_link" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" text,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
-- FK a organization (cascade) y a user (set null), índices UNIQUE(token_hash) e
-- (organization_id): los genera drizzle-kit con guardas de re-ejecución.
```

La genera `pnpm db:generate` desde `src/lib/db/schema.ts`; el texto definitivo es el
del archivo en `drizzle/`.

- **Aditiva** (Principio X): no toca ninguna tabla existente. Se aplica en toda la
  flota al arrancar, también en las instancias sin agenda: una tabla vacía es inerte
  (mismo criterio que la 015).
- **Plan de reversión**: redesplegar el commit anterior funciona sin tocar el
  esquema — ningún código previo conoce la tabla. Si hubiera que quitarla, sería una
  entrega posterior (`DROP TABLE`), nunca esta.
- **Ensayo del Principio X**: restaurar el respaldo diario más reciente de una
  instancia real en un Postgres desechable local, aplicar `0000..0016` con
  `scripts/migrate.mjs` (el mismo runner del contenedor), comprobar que la tabla
  existe vacía con sus índices y que la app arranca contra esa base
  (`/api/health`). Registro en [quickstart.md](quickstart.md) §4.

## Lo que NO se guarda

- La llave del link (solo su huella).
- El `code` de Google, el `state`, el nonce del navegador: viven los 15 minutos de la
  ida y vuelta en la dirección y en una cookie, y no tocan la base.
- El correo o nombre del calendario: se lee de Google al probar la conexión y se
  muestra; no se persiste (la 015 tampoco lo hacía).
- Nada en `lanco.cloud`.
