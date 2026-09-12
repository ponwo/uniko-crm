---
name: conector-inventario-consume-el-contrato-de-ms-stock
description: 026 — el conector INVENTARIO implementa el contrato que fija MS-Stock (repo hermano, feature 003); INVENTARIO=on solo en uniko-lanco; gotchas del arnés (base vieja, 521→52)
metadata:
  type: project
---

El conector de inventario (026) **consume** un contrato que vive en el repo hermano
`../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md`: si algo no cuadra
se corrige ALLÁ y se cita aquí; nunca se adivina en Uniko. `src/server/inventario/client.ts`
es el único módulo que conoce HTTP de MS-Stock.

Estado 2026-09-12: en `main` (`e143555`) y desplegado en `uniko-lanco` con
`INVENTARIO=on` + `STOCK_BASE_URL`/`STOCK_API_KEY`/`STOCK_SSO_SECRET` (runtime, en
Coolify; copiadas de la app `ms-stock`). Ninguna otra instancia lo tiene encendido.
No promovido a `production`.

**Why:** dos repos, un contrato: quien lo cambie sin avisar rompe el otro lado en
silencio. Y la bandera viva solo en pruebas evita que una instancia de cliente
arranque exigiendo variables que nadie cargó.

**How to apply:** al tocar `check_stock`, el pase SSO o el stock-mock, abrir primero el
contrato de MS-Stock; al encender `INVENTARIO` en otra instancia, cargar antes las
tres `STOCK_*` (si falta una, `/api/health` da 503 y el deploy no se da por sano).
Gotchas del arnés E2E: (1) re-correr `pnpm test:e2e` sobre una base con corridas
viejas falla por ids de mensaje ya ingeridos (ventana de 24 h cerrada) — recrear
`uniko_dev`; (2) el outbox lleva el teléfono normalizado (`521…` → `52…`); (3) el
ai-mock solo propone `check_stock` si el prompt lo menciona (si no, la corrida
`default` escalaría a humano). Ver [[worktree-y-arneses-en-la-maquina-de-desarrollo]].
