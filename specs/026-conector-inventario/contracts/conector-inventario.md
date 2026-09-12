# Contrato — Conector INVENTARIO (superficies de Uniko)

**Feature**: 026 · **Fecha**: 2026-09-12. Todo lo que hay abajo existe **solo** con
`INVENTARIO` encendida; apagada, cada ruta responde `404` sin cuerpo y ninguna
pantalla lo menciona (FR-1101).

## Rutas HTTP

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `GET /api/inventario/sso[?next=/portal/...]` | sesión de Uniko (`401` sin ella) | `302` → `${STOCK_BASE_URL}/portal/sso?token=<pase>`; un pase nuevo por solicitud (contrato `sso-token.md` de MS-Stock); `next` solo si empieza por `/portal` |
| `GET /api/inventario/status` | sesión de Uniko | `200 { "baseUrl": "https://stock.lanco.cloud", "status": "connected" \| "unauthorized" \| "unavailable" }` en < 5 s; nunca la llave ni el secreto |
| `GET /settings/inventario` | sesión | página de Ajustes → Inventario (`notFound()` sin bandera) |

## Navegación

- Renglón **Inventario** (icono paquete) tras "Pipeline" y "Citas" (si hay agenda),
  para todo miembro, en escritorio y cajón móvil; `href="/api/inventario/sso"`,
  `target="_blank"`, `rel="noopener"`.
- Pestaña **Inventario** en Ajustes tras "Agenda" (o donde corresponda si la agenda
  está apagada).

## Acción del agente

```ts
z.object({
  action: z.literal("check_stock"),
  query: z.string().min(2).max(100),
  reply: z.string().optional(),
})
```

Registrada en `agentActionSchema({ inventario: true })` y descrita en el prompt solo
con la bandera. Ejecución: `checkStockTurn({ query, intro: reply })`; el texto lo pega
el sistema (ver `data-model.md`). Fallo ⇒ `degradeAction` (reply → `reply`, si no →
`none`) + `console.error("[agente] inventario: …")`.

## Adaptador (`@/server/inventario/client`)

```ts
getProduct(sku: string): Promise<StockResult<StockProduct>>
searchProducts(query: string, limit?: number): Promise<StockResult<SearchResult>>
lookup(query: string): Promise<StockResult<{ products: StockProduct[]; truncated: boolean }>>
health(): Promise<StockResult<true>>
looksLikeSku(query: string): boolean
```

Único módulo que conoce las rutas de MS-Stock. 3 000 ms por llamada, sin reintentos,
nunca lanza, `X-API-Key` desde `getEnv().STOCK_API_KEY`.

## Emisión del pase (`@/server/inventario/sso`)

```ts
issueSsoUrl(input: { userId: string; name: string; next?: string }): Promise<string>
```

HS256 con `STOCK_SSO_SECRET`; `iss = APP_BASE_URL`, `aud = STOCK_BASE_URL`,
`sub = userId`, `name` (≤ 80), `jti = randomUUID()`, `exp = iat + 120`.

## Variables (`.env.example`)

```bash
# 026 — Conector de inventario (MS-Stock). Apagado por defecto.
# INVENTARIO=on
# STOCK_BASE_URL=https://stock.lanco.cloud        # origen público de MS-Stock, sin / final
# STOCK_API_KEY=REEMPLAZA_llave_de_la_instancia   # = STOCK_API_KEY de esa instancia (≥ 32)
# STOCK_SSO_SECRET=REEMPLAZA_openssl_rand_hex_32  # = UNIKO_SSO_SECRET de esa instancia (≥ 32)
```
