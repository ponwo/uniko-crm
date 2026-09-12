# Contrato — `stock-mock` (solo self-test)

Vive en `src/app/api/dev/stock-mock/[...path]/route.ts`, tras el middleware de la 024
y `mockGuard()`: `404` incondicional en producción. Imita lo que el conector usa de
MS-Stock (contrato de la feature 003) y expone estado para que el arnés afirme.

`STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock` en el self-test.

## Rutas imitadas

| Ruta | Comportamiento (modo `ok`) |
|---|---|
| `GET /health` | `200 {"status":"ok","db":"ok"}` (sin llave) |
| `GET /v1/agent/search?q=&limit=` | exige `X-API-Key === STOCK_API_KEY` (`401` si no); `q` < 2 ⇒ `422`; busca sin acentos ni mayúsculas en nombre y SKU; `limit` máx. 25 (default 10); `{"results":[…],"truncated":bool}` |
| `GET /v1/agent/products/{sku}` | exige llave; SKU en mayúsculas; inactivo o inexistente ⇒ `404 {"error":{"code":"NOT_FOUND","message":"Producto no encontrado."}}` |
| `GET /portal/sso?token=` | verifica HS256 con `STOCK_SSO_SECRET`, `aud === STOCK_BASE_URL`, `exp`; guarda `lastSso`; `200` HTML `<h1>Inventario de prueba</h1><p>{name} desde Uniko</p>` o `400` con el motivo (`bad_signature`, `expired`, `wrong_audience`, `malformed`) |

Catálogo: `PLY-NEG` Playera negra 7 pieza $199 MXN · `PLY-BLA` Playera blanca 0 $199 ·
`GOR-01` Gorra 3 pieza sin precio · `TAZ-01` Taza 12 pieza $89 · `GOR-02` Gorra vieja
(inactiva: nunca se devuelve).

## Modos (camino infeliz)

| `mode` | Efecto en `/v1/*` y `/health` |
|---|---|
| `unauthorized` | `401 {"error":{"code":"UNAUTHORIZED",…}}` aunque la llave sea correcta |
| `down` | `503 {"error":{"code":"SERVICE_UNAVAILABLE",…}}`; `/health` ⇒ `503` |
| `slow` | espera 4 s antes de responder `200` (dispara el timeout de 3 s) |
| `garbage` | `200` con cuerpo `not json` |

## Control

- `GET /api/dev/stock-mock/_state` → `{ mode, lastSso, calls }`
- `POST /api/dev/stock-mock/_mode` `{ "mode": "down" }`
- `POST /api/dev/stock-mock/_reset` → `mode: "ok"`, `lastSso: null`, `calls: []`
