---
name: relevo-de-contenedor-en-coolify
description: Tras un deploy en Coolify hay ~1 min en que el proxy alterna entre el contenedor viejo y el nuevo (una petición 200 con el commit nuevo, la siguiente 502 o comportamiento viejo). No medir nada contra la instancia hasta ver /api/health estable 10/10.
metadata:
  type: project
---

Visto el 2026-09-10 en LanCo al verificar la 024. `/api/health` devolvió el
commit nuevo (`e64a164`) y se lanzó el self-test de inmediato: 18 fallos que
mezclaban 405 (comportamiento del contenedor viejo) y 502 Bad Gateway (el
nuevo aún no aceptaba). Muestreando health en bucle: 200 / Bad Gateway /
200 / Bad Gateway, alternando exactamente. Un minuto después, 10/10 en 200 y
el self-test 20/20.

**Why:** un solo `/api/health` en 200 con el commit correcto NO prueba que el
relevo terminó; prueba que UNO de los dos backends es el nuevo. Un resultado
rojo en ese minuto parece un fallo del código y no lo es.

**How to apply:** antes de cualquier self-test contra una instancia recién
desplegada (LanCo o la flota en la promoción), muestrear `/api/health` unas
10 veces seguidas y exigir 10/10 en 200 con el commit esperado. Si sale rojo
a medio relevo, esperar y repetir antes de diagnosticar. Ver también
[[worktree-y-arneses-en-la-maquina-de-desarrollo]].
