# Quickstart — desarrollo local y self-test (001-uniko-core)

## Requisitos

Node 22 + pnpm · Docker (para Postgres local y la Ruta B) · `.env` a partir de
`.env.example`.

## Levantar en desarrollo

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d postgres   # Postgres local
pnpm db:migrate                                            # aplicar migraciones
pnpm dev                                                   # http://localhost:3000
```

Primer uso: registrarse (crea la organización) → `pnpm seed:demo`.

> ~~botón "Cargar datos de demostración"~~ — **DEROGADO** por [023](../023-seed-demo-fuera-de-produccion/spec.md).
> El botón salió del estado vacío: sembrar la demo borra el conocimiento y el
> historial del Laboratorio de la organización, y su guardia no protegía al
> negocio que tenía algo que perder. Queda el CLI y, en desarrollo,
> `POST /api/dev/seed-demo`. Rationale completo junto a FR-075 en el spec.

## Modo de pruebas interno (self-test)

En `.env` de desarrollo:

```
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
OPENROUTER_API_TOKEN=test-token
```

Conectar el número en Settings → WhatsApp con IDs de prueba (cualquier token SIN el
sufijo `-invalid`). Simular un entrante:

```bash
curl -X POST localhost:3000/api/dev/wa-mock/inbound \
  -H 'content-type: application/json' \
  -d '{"phoneNumberId":"<el del wizard>","from":"5215511111111","name":"Cliente Demo","text":"hola"}'
```

## Gate técnico y tests

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test   # Vitest unit
```

Self-test E2E: se conduce con Playwright (MCP) siguiendo los guiones de
`tests/e2e/` contra `pnpm dev` y contra la Ruta B (`docker compose up`).

## Ruta B local (verificación compose)

```bash
DOMAIN=localhost docker compose up -d --build
# Caddy sirve https://localhost (cert interno); healthchecks en app/db/caddy
```
