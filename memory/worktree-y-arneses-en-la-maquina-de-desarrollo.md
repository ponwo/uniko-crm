---
name: worktree-y-arneses-en-la-maquina-de-desarrollo
description: Cómo correr el gate completo y los arneses E2E desde un worktree en la máquina de desarrollo (Node 22 vía fnm, node_modules propio, base desechable para "base limpia").
metadata:
  type: project
---

Verificado 2026-09-10 en la 024, desde un worktree bajo `.claude/worktrees/`.

- **Node**: la máquina tiene Node 24 por defecto y `engine-strict` lo rechaza.
  fnm tiene la 22 instalada: en bash, `eval "$(fnm env --shell bash)" && fnm
  use 22` antes de cualquier `pnpm`. No aflojar `engine-strict` (`.npmrc`
  explica por qué).
- **node_modules del worktree**: el worktree nace sin él. `pnpm install
  --frozen-lockfile --offline` lo resuelve desde el store en ~15 s; no hace
  falta apuntar al del checkout principal.
- **`.env`**: gitignored, no viaja al worktree; copiar el del checkout
  principal.
- **"Base limpia" para `e2e-selftest.mjs` y `e2e-lab.mjs`**: los dos exigen
  una base sin corridas previas — con la `uniko_dev` compartida, el ingest
  idempotente salta los mensajes ya vistos y todo falla con `window_closed`
  (15 fallos de 103). Solución que no toca la base de nadie: cambiar
  `DATABASE_URL` del worktree a `uniko_dev_<NNN>` y `pnpm db:dev` la crea y
  migra. Reiniciar `pnpm dev` después (lee `.env` al arrancar).
- **Modo producción local**: `pnpm build && pnpm start -p 3100` (`next start`
  fija `NODE_ENV=production` solo; el middleware lleva ese valor inlineado en
  el bundle). Convive con `pnpm dev` en 3000.
- **`GET /api/dev/sse-mudo` no termina nunca**: cualquier guion que haga
  `fetch` de todas las rutas dev debe leer el estado y cancelar el cuerpo.

**Why:** cada punto costó una vuelta; juntos son media hora de arranque.
**How to apply:** al abrir sesión en un worktree, hacer estos pasos antes de
declarar nada rojo "de entorno". Ver también [[build-rojo-desde-la-unidad-g]].

**Añadido 2026-09-17 (falsos rojos de inventario en el arnés)**: `next dev`
compila cada ruta y página al primer uso, y una página pesada (`/inbox`,
11 s) en medio de los checks de `check_stock` deja la búsqueda al stock-mock
detrás de la compilación → «timeout al consultar MS-Stock» → el agente degrada
(«Déjame revisar.») o no llega a tiempo. Dos corridas seguidas fallaron en un
caso distinto cada una por esto. Antes de correr el arnés: NO dejar abierta la
pestaña del panel de vista previa sobre `localhost:3000` (carga `/inbox`,
`/login`, `/api/sw`), y calentar con `curl` las rutas de mocks e inventario y
las páginas `/login`, `/inbox`, `/bookings`, `/settings/calendar`. El log
`[agente] inventario: timeout al consultar MS-Stock` junto a un `Compiled /…`
largo es la firma. Alternativa robusta: `pnpm build && pnpm start -p 3100`.
