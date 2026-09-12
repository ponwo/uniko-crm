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

## Resultados del self-test local — 2026-09-12 (T021, T027, T031, T034)

- **Gate**: `pnpm typecheck` ✓ · `eslint src tests` ✓ · `pnpm build` ✓ (rutas
  `/api/inventario/sso`, `/api/inventario/status`, `/settings/inventario`) ·
  `pnpm test` **657/657** con `INVENTARIO` vacía y con `on` (18 tests nuevos en 8
  archivos). Nota local: Node 24 en la máquina (el repo pide 22; `pnpm` solo avisa);
  `pnpm lint` a secas arrastra ruido de `.claude/worktrees/` (worktrees viejos,
  ignorados por git, no por ESLint) — la CI corre sobre un checkout limpio.
- **`pnpm test:e2e` con la bandera encendida**: **133/133**. Sección 026: los 5
  casos felices de `check_stock` (línea exacta por producto, agotado, sin precio,
  sin coincidencias, SKU exacto), la gorra inactiva nunca aparece, la frase del
  modelo precede a los datos; degradación en `down`/`unauthorized`/`slow`/`garbage`
  → solo "Déjame revisar." en 6.4 s / 6.5 s / 9.6 s / 6.4 s (6 s son la coalescencia
  del agente; el `slow` suma el timeout de 3 s); botón: 401 sin sesión, 302 con
  pase, el mock saluda por nombre, claims exactos (`sub`, `name`, `iss`, `aud`,
  vida 120), `jti` nuevo por clic, `next` interno sí / externo no; estado:
  `connected` / `unauthorized` / `unavailable`, sin llave ni secreto en `status` ni
  en el HTML de Ajustes.
- **Con la bandera apagada** (misma app, `INVENTARIO=`): **112/112**; las rutas y
  la página → 404 y "¿tienen playera negra?" recibe el eco normal (el ai-mock no
  propone `check_stock` porque el prompt no lo menciona).
- **Hallazgo del arnés**: 26 fallos de la primera corrida eran estado viejo de la
  base local (ids de mensaje ya ingeridos ⇒ ventana de 24 h cerrada), no producto:
  con la base recreada (`DROP/CREATE` + `pnpm db:dev`) todo verde. Y el CRM
  normaliza `521…` → `52…`: el outbox se filtra con el número "al cable".
- **Navegador (Chromium 1280×800 y 375×812 @2x)**: renglón "Inventario" tras
  Pipeline (`Bandeja · Pipeline · Inventario · Contactos · Agente · Laboratorio`),
  `target=_blank`; en móvil dentro del cajón; clic ⇒ pestaña nueva "Inventario de
  prueba — Operador E2E desde Uniko"; Ajustes → Inventario "Conectado"; sin
  desbordamiento horizontal.
- **§4 MS-Stock real en local** (`STOCK_BASE_URL=http://127.0.0.1:8000`, mismo
  secreto): botón ⇒ **portal real** en 0.72 s con "Operador E2E desde Uniko" y
  "Volver a Uniko" → `http://localhost:3000` (MS-Stock: `sso login ok`); Ajustes
  "Conectado"; "¿cuánto cuesta la PLY-NEG?" ⇒ "Déjame revisar.\nPlayera negra
  (PLY-NEG): 17 pieza — $199 MXN" (17 = existencia real de esa base, no la del
  mock). Un intento previo falló porque en el puerto 8000 seguía viva una instancia
  vieja de MS-Stock con otro secreto: el rechazo fue el esperado (`bad_signature`).
