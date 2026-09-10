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
