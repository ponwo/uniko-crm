# Data Model — 026 Conector INVENTARIO

**Fecha**: 2026-09-12. **Sin tablas ni migraciones**: el conector no guarda nada en
la base de Uniko. Lo que sigue son las formas en runtime (configuración, adaptador,
acción del agente, pase SSO, estado del mock) y sus invariantes.

## Configuración (variables de despliegue)

| Variable | Con `INVENTARIO` apagada | Con `INVENTARIO` encendida |
|---|---|---|
| `INVENTARIO` | ausente/otro ⇒ apagada | `on` \| `1` \| `true` \| `si` \| `sí` \| `yes` |
| `STOCK_BASE_URL` | ignorada | obligatoria; URL; se normaliza sin `/` final; en producción es el origen público de MS-Stock (`https://stock.lanco.cloud`), en el self-test `http://localhost:3000/api/dev/stock-mock` |
| `STOCK_API_KEY` | ignorada | obligatoria; ≥ 32 caracteres; solo servidor |
| `STOCK_SSO_SECRET` | ignorada | obligatoria; ≥ 32 caracteres; solo servidor |

Invariante: con la bandera encendida y alguna ausente/inválida, `getEnv()` lanza con
el nombre de la variable ⇒ `/api/health` responde `503` ⇒ el despliegue no se da por
sano (FR-1102).

## Adaptador (`src/server/inventario/client.ts`)

```ts
type StockProduct = {
  sku: string; name: string; description: string | null;
  stock: number; unit: string; price: number | null; currency: string; available: boolean;
};
type SearchResult = { results: StockProduct[]; truncated: boolean };
type StockError = "not_found" | "unauthorized" | "unavailable" | "timeout" | "invalid" | "network";
type StockResult<T> = { ok: true; data: T } | { ok: false; error: StockError };
```

| Función | Llamada a MS-Stock | Mapeo |
|---|---|---|
| `getProduct(sku)` | `GET /v1/agent/products/{sku}` | `200` ⇒ producto · `404` ⇒ `not_found` · `401` ⇒ `unauthorized` · `503`/`5xx` ⇒ `unavailable` · abort ⇒ `timeout` · JSON/forma inválida ⇒ `invalid` · red ⇒ `network` |
| `searchProducts(query, limit=5)` | `GET /v1/agent/search?q=&limit=` | `200` ⇒ `SearchResult` · `422` ⇒ `invalid` · resto igual |
| `lookup(query)` | exacto si `looksLikeSku(query)` y, si `not_found`, búsqueda | `{ products, truncated }` o error |
| `health()` | `GET /health` (sin llave) | `200` ⇒ ok · resto ⇒ `unavailable` |

Invariantes: tiempo máximo por llamada 3 000 ms; sin reintentos; nunca lanza; la
llave solo viaja en el header `X-API-Key`; ningún log incluye la llave.

## Acción del agente

```ts
{ action: "check_stock"; query: string /* 2–100 */; reply?: string }
```

- Presente en el esquema y en el prompt **solo** con la bandera encendida.
- Ejecución: `checkStockTurn({ query, intro: reply })` → `{ text, ok }`.
- Degradación (`degradeAction`): `reply` ⇒ `{ action: "reply", text: reply }`; sin
  `reply` ⇒ `{ action: "none" }`.

### Texto pegado por el sistema (FR-1111)

```
<intro si la hubo>
Playera negra (PLY-NEG): 7 pieza — $199 MXN
Playera blanca (PLY-BLA): agotado — $199 MXN
Gorra (GOR-01): 3 pieza — sin precio
Hay más coincidencias, ¿me dices cuál te interesa?      ← solo si truncated
```

Sin coincidencias: `No encontré productos para «<query>».` — máximo 5 líneas de
producto; existencia con hasta 2 decimales; moneda la que devuelve MS-Stock.

## Pase SSO (emitido, nunca almacenado)

| Claim | Valor |
|---|---|
| `iss` | `APP_BASE_URL` de Uniko |
| `aud` | `STOCK_BASE_URL` |
| `sub` | `session.user.id` |
| `name` | `session.user.name` (o `email` si está vacío), recortado a 80 |
| `iat` / `exp` | ahora / +120 s |
| `jti` | `randomUUID()` |
| `next` | opcional; solo si empieza por `/portal` |

Cabecera `{"alg":"HS256","typ":"JWT"}`; firma con `STOCK_SSO_SECRET`. Destino:
`${STOCK_BASE_URL}/portal/sso?token=<pase URL-encoded>`.

## Estado del conector (`GET /api/inventario/status`)

```ts
{ baseUrl: string; status: "connected" | "unauthorized" | "unavailable" }
```

Nunca incluye la llave ni el secreto. No se persiste.

## Estado del `stock-mock` (solo pruebas)

```ts
{ mode: "ok" | "unauthorized" | "down" | "slow" | "garbage";
  lastSso: { iss, aud, sub, name, next? , jti } | null;
  calls: { path: string; authorized: boolean }[] }
```

Catálogo fijo: `PLY-NEG` (7 pieza, $199 MXN), `PLY-BLA` (0, $199), `GOR-01` (3, sin
precio), `TAZ-01` (12, $89), `GOR-02` inactiva (no aparece). `_reset` vuelve a
`mode: "ok"` y vacía `lastSso`/`calls`.

## Invariantes de seguridad (verificados en tests)

1. Bandera apagada ⇒ `/api/inventario/*` y `/settings/inventario` responden `404`;
   el esquema del turno y el prompt no contienen `check_stock`; ninguna prueba
   existente cambia (SC-004).
2. `STOCK_API_KEY` y `STOCK_SSO_SECRET` nunca aparecen en HTML, JSON ni logs (SC-005).
3. `check_stock` solo hace `GET`; ninguna ruta de esta feature escribe en MS-Stock.
4. Un fallo del conector nunca produce un mensaje de error al cliente ni un handoff.
