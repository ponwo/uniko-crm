---
name: plantillas-027-espejo-de-meta
description: "027 (plantillas): en main (8df60b5, PR #30) y verificada en uniko-lanco el 2026-09-15 — el sync importó hello_world y crear respondió 201 tras >8 s de Meta; el error del dueño era el fallback no-JSON; uniko.lanco.cloud SÍ va por Cloudflare; pendiente promover a production"
metadata:
  type: project
---

Estado 2026-09-15: rama `027-plantillas-espejo-de-meta`, gate verde (721
tests, build), arnés `e2e-templates-sync.mjs` 80/80 y `multivar` 21/21.
Pendientes: ensayo del Principio X (migración `0015`: 3 columnas nullable +
backfill de `meta_status`) con el volcado de LanCo del panel de Coolify, y la
verificación en vivo en uniko-lanco.

Hallazgos que NO están en el código:

- **El error que vio el dueño** («No se pudo crear la plantilla», captura del
  2026-09-14) es el *fallback* del cliente: la respuesta no fue el JSON de error
  de la API (fetch rechazado o cuerpo no-JSON: 502 durante un relevo, 524 de
  Cloudflare…). No es un mensaje de Meta. Sonda sin efectos (POST con salto de
  numeración desde su sesión) → 422 JSON correcto: la ruta funciona de punta a
  punta; el fallo está en el tramo que llama a Meta o en el transporte. Por eso
  la 027 puso tope de 30 s a las llamadas de plantillas (503 con causa en vez
  de HTML del proxy) y la pantalla ahora muestra el código HTTP.
- **`uniko.lanco.cloud` está proxied por Cloudflare** (`server: cloudflare`,
  IPs 104.21/172.67), aunque `docs/despliegue-flota.md` diga que resuelve
  directo a `212.28.185.186`. Un origen lento (>100 s) da 524 HTML.
- El WABA de LanCo tenía 0 plantillas locales y "Todo al día": el sync viejo
  solo actualizaba filas existentes; el nuevo importa lo que haya en Meta.
- Meta devuelve `rejected_reason: "NONE"` en las no rechazadas: se guarda
  `null`, no "NONE".
- Postgres reordena las llaves de un `jsonb`: comparar `components` con
  `JSON.stringify` tal cual rompía la idempotencia del sync (`updated: 1`
  eterno); se compara con llaves ordenadas (`canon`).

**Why:** el diagnóstico costó una hora y el dueño pidió no crear plantillas
reales sin su permiso; la próxima sesión debe partir de aquí.
**How to apply:** antes de tocar plantillas, leer
`specs/027-plantillas-espejo-de-meta/quickstart.md` (registro de verificación)
y revisar el runbook de Cloudflare. Ver [[worktree-y-arneses-en-la-maquina-de-desarrollo]].
