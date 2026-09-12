# Quickstart — 026 Conector INVENTARIO

Guía de **verificación en vivo** (Principio IX) del conector: botón "Inventario",
`check_stock` del agente y Ajustes, con los mocks primero, contra MS-Stock local
después y contra la instancia de pruebas al final. Contratos:
[conector-inventario.md](contracts/conector-inventario.md) ·
[stock-mock.md](contracts/stock-mock.md) · MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md).

## 0. Prerrequisitos

- Lo de [docs/desarrollo-local.md](../../docs/desarrollo-local.md) (Node 22, Postgres
  16, `.env` con los mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
  `OPENROUTER_BASE_URL` → ai-mock, `OPENROUTER_API_TOKEN` de mentira, `BOT_API_KEY`).
- En `.env` (gitignored), el conector apuntando al mock:

```bash
INVENTARIO=on
STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock
STOCK_API_KEY=desarrollo-local-stock-key-0123456789abcdef
STOCK_SSO_SECRET=desarrollo-local-sso-secret-0123456789abcdef
```

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Los tests unitarios nuevos corren con la bandera en cualquier estado (la CI ejercita
`default` e `inventario=on`).

## 2. App viva y self-test automatizado

```bash
pnpm dev            # http://localhost:3000
pnpm test:e2e       # incluye inventarioChecks() de scripts/e2e-selftest.mjs
```

`inventarioChecks()` con la bandera **encendida**: `/api/inventario/sso` sin sesión →
`401`; con sesión → `302` a `…/stock-mock/portal/sso?token=` y el mock registra
`lastSso` con `sub` y `name` de la sesión; wa-mock inbound "¿tienen playera negra?"
→ la respuesta del agente contiene "Playera negra (PLY-NEG): 7 pieza — $199 MXN";
"¿tienen gorra?" → "Gorra (GOR-01): 3 pieza — sin precio"; "¿tienen playera blanca?"
→ "agotado"; "¿tienen zapatos?" → "No encontré productos"; `_mode=down`,
`unauthorized`, `slow`, `garbage` → el agente responde "Déjame revisar." (la frase
del modelo) en < 6 s, sin texto técnico, y el servidor registra `[agente]
inventario:`; `/api/inventario/status` → `connected` / `unauthorized` /
`unavailable` según el modo; ni la llave ni el secreto aparecen en la respuesta ni en
el HTML de `/settings/inventario`. Con la bandera **apagada** (reiniciar la app sin
`INVENTARIO`): las dos rutas → `404`, "¿tienen playera negra?" → respuesta de eco
normal (el ai-mock no propone `check_stock` porque el prompt no lo menciona).

## 3. Self-test manual en navegador (Playwright o a mano)

1. Iniciar sesión; en la barra lateral aparece **Inventario** tras Pipeline (y Citas
   si `AGENDA=on`); en móvil (375 px) dentro del cajón.
2. Pulsar → pestaña nueva con "Inventario de prueba — <tu nombre> desde Uniko" (el
   mock). Cerrar y pulsar de nuevo → otro pase (`_state.lastSso.jti` distinto).
3. Ajustes → Inventario: se ve `http://localhost:3000/api/dev/stock-mock` y "Probar
   conexión" → "Conectado". `POST _mode {"mode":"unauthorized"}` → "Llave
   rechazada"; `down` → "Servicio no disponible"; `_reset`.
4. Laboratorio: crear una conversación de prueba y escribir "¿cuánto cuesta la
   PLY-NEG?" → el agente responde con "$199 MXN"; en el transcript no hay texto de
   error.
5. Ver el código fuente de Ajustes y la respuesta de `status`: sin llave ni secreto.

## 4. Contra MS-Stock real en local (contrato de verdad)

Con el repo hermano corriendo (`uv run uvicorn app.main:create_app --factory --port
8000` en `../MS-Sotck`, con `UNIKO_SSO_SECRET` igual a `STOCK_SSO_SECRET` de aquí):

```bash
STOCK_BASE_URL=http://127.0.0.1:8000
STOCK_API_KEY=<STOCK_API_KEY del .env de MS-Stock>
```

Repetir 3.1–3.2 (aterriza en el portal real con "<nombre> desde Uniko" y "Volver a
Uniko" → `http://localhost:3000`) y 3.4 con un producto real (`PLY-NEG`).

## 5. Despliegue e instancia de pruebas

1. Merge a `main` → deploy automático de `uniko-lanco` (las variables `STOCK_*` ya
   están cargadas desde 2026-09-12). Poner **`INVENTARIO=on`** en Coolify por MCP y
   redesplegar; `GET /api/health` → `ok` (si faltara una variable, `503` y el
   contenedor anterior sigue: FR-1102).
2. En `https://uniko.lanco.cloud`: botón → `https://stock.lanco.cloud/portal` con
   "<nombre> desde Uniko"; Ajustes → Inventario → "Conectado"; en el Laboratorio,
   "¿tienen PLY-NEG?" responde con los datos reales (SC-007). Registrar resultados
   al final de este archivo.
3. **No** promover a `production` en esta feature (puerta de promoción: señal
   explícita del dueño).

## Criterio de "Hecho"

Gate verde (matriz apagada/encendida), `pnpm test:e2e` verde con
`inventarioChecks()`, self-test manual §3, contrato real §4 y verificación en la
instancia de pruebas §5.2 registrados aquí.
