<!--
Índice de memoria del proyecto (memoria de la sesión principal, versionada).
Una línea por memoria: - [Título](archivo.md) — gancho de una línea.

El archivo se carga por sesión; las memorias en sí viven en archivos hermanos
de este directorio, uno por hecho. Aquí NUNCA va el contenido de una memoria,
solo su línea de índice: este archivo entra completo en cada sesión y crece
para siempre.

Qué merece una memoria: decisiones y sus porqués, gotchas verificados,
correcciones del dueño. Qué no: lo que el repo ya registra por sí mismo
(estructura del código, historial de git, lo que ya dice CLAUDE.md).

Vacío al inicio; se irá poblando.
-->

- [Build rojo desde la unidad G:](build-rojo-desde-la-unidad-g.md) — entorno de la máquina de desarrollo: G: es un subst de C:\G; entra por la ruta real. No es Windows ni el código.
- [Android sin vista móvil: era el navegador](android-sin-vista-movil.md) — RESUELTO: Chrome tenía "Versión para ordenador" activada. Descarta eso antes de diagnosticar cualquier problema de renderizado móvil.
- [Probar la PWA en móvil necesita HTTPS](pwa-en-movil-necesita-https.md) — localhost desbloquea desarrollar el service worker de la 019, no probarlo instalado. Anotado antes de empezar.
- [Worktree y arneses en la máquina de desarrollo](worktree-y-arneses-en-la-maquina-de-desarrollo.md) — Node 22 vía fnm, `pnpm install --offline`, base `uniko_dev_<NNN>` desechable para los arneses, `sse-mudo` no termina.
- [Relevo de contenedor en Coolify](relevo-de-contenedor-en-coolify.md) — tras un deploy, ~1 min alternando viejo/502; exigir /api/health 10/10 antes de medir contra la instancia.
- [Cola de CI en `main`](cola-de-ci-en-main.md) — las corridas se encolan; un runner colgado bloquea a los siguientes y el que espera se cancela, dejando commits sin el verde que exige la puerta de promoción.
- [El conector de inventario consume el contrato de MS-Stock](conector-inventario-consume-el-contrato-de-ms-stock.md) — 026: contrato en el repo hermano; INVENTARIO=on solo en uniko-lanco; gotchas del arnés (base vieja, 521→52, ai-mock condicionado).
- [Foto del producto (026) — PR #28](foto-producto-026-pr28-pendiente.md) — verificada por el dueño y promovida a production en 8d91b78 el 2026-09-14 (flota 3/3; INVENTARIO apagada en clientes); decisiones de diseño fuera del contrato; el camino feliz no escribe en el log
- [Tallas (026) — PR #29](tallas-026-pr29.md) — tallas en check_stock (MS-Stock 005): PR abierta el 2026-09-14 con gate y arnés verdes; merge/deploy = señal del dueño; gotcha `pkill` no mata `next dev` en Windows
- [Plantillas 027: espejo de Meta y errores con causa](plantillas-027-espejo-de-meta.md) — promovida a production en 0a5c0bd el 2026-09-15 (flota 3/3); el error del dueño era el fallback no-JSON; Meta tarda >8 s en crear; uniko.lanco.cloud va por Cloudflare; `production` local vive en otro worktree → promover con `git push origin main:production` (ff)
- [Respuesta por talla (028) — PR #31](respuesta-por-talla-028-pr31.md) — con varios modelos solo los con existencia en la talla, una foto por modelo (tope 5); PR abierta el 2026-09-16 con gate, arnés (163/163 y 112/112) y MS-Stock local verdes; merge = dueño; luego SC-007 con los 4 modelos reales y cierre de la T057; gotchas: base nueva por corrida, calentar rutas, no resetear el outbox
