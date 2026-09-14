---
name: tallas-026-pr29
description: "Extensión de la 026 para MS-Stock 005 (tallas en check_stock: variants/label/parent_sku, size en la acción, línea por modelo) — PR #29 abierta el 2026-09-14 con gate y arnés verdes; merge y deploy = señal del dueño"
metadata:
  type: project
---

Estado 2026-09-14: la respuesta con tallas está en la rama `026-tallas` →
[PR #29](https://github.com/ponwo/uniko-crm/pull/29). Gate verde (686 tests),
`e2e-selftest.mjs` 153/153 con `INVENTARIO=on` y 112/112 apagada. Sin variables ni
migración. MS-Stock ya está desplegado con la 005 en `stock.lanco.cloud`
(contrato `uniko-integration.md` §4 actualizado allá).

Decisiones de diseño (no reabrir):
- El modelo sigue sin ver cifras: `check_stock` gana `size` (talla pedida) y el
  motor redacta la línea del modelo (`Nombre (SKU) — $precio. Tallas: CH 4, M
  agotada, …`), la de una talla pedida, la agotada (con las que sí hay), la
  inexistente ("no viene en talla X") y la de una talla por SKU exacto.
- Equivalencias chica/mediana/grande/extra → CH/M/G/XCH/XG solo como respaldo
  cuando ninguna etiqueta coincide literalmente; las etiquetas son del negocio.
- El stock-mock lleva el modelo `PLY-ROJ` **al final** del catálogo para no mover
  el orden de las búsquedas que los checks previos afirman.

Gotcha de la máquina (Windows): `pkill -f "next dev"` NO mata el servidor; un
segundo `pnpm dev` arranca en 3001 y el arnés le pega al viejo en 3000 → 40 falsos
rojos. Matar con `taskkill //F //PID <pid> //T` (o `//IM node.exe`) antes de relanzar.

Pendiente (T057): merge a `main` (señal del dueño) → deploy automático de
`uniko-lanco` → `/api/health` 10/10 → en el Laboratorio o por WhatsApp una pregunta
por un modelo con tallas de `stock.lanco.cloud` (hoy no hay ninguno activo: los de
prueba `PLY-QS*` quedaron desactivados; crear uno desde el portal de MS-Stock) →
registrar en `quickstart.md` y marcar T057.

**Why:** el trabajo quedó a una señal del dueño; la verificación en vivo necesita un
modelo real con tallas en la instancia de pruebas.
**How to apply:** empezar por la PR #29 (rebase si `main` avanzó), no por el código.
Ver [[conector-inventario-consume-el-contrato-de-ms-stock]].
