---
name: cola-de-ci-en-main
description: En `main` las corridas de CI se encolan (cancel-in-progress solo aplica a PRs). Un runner colgado bloquea a los commits siguientes, y el que espera se cancela al ser desplazado — dejando commits de `main` SIN registro verde, que es justo lo que exige la puerta de promoción.
metadata:
  type: project
---

Visto el 2026-09-10 al preparar la promoción de la 021, y costó ~45 minutos.

**Qué pasó.** Tres PRs se mergearon seguidos. La CI de `main` usa
`concurrency: CI-refs/heads/main` con `cancel-in-progress` solo para
`pull_request`, así que en `main` las corridas **se encolan** en vez de
cancelarse. El job `completo` del primer commit se quedó colgado en
`typecheck` y arrastró a todo lo demás:

| Commit | Estado final |
|---|---|
| `e64a164` | `completo` atascado 47 min en `typecheck`; lo maté a mano |
| `1898d00` | **cancelado** sin correr — desplazado de la cola por el siguiente |
| `f1d3640` | `pending` hasta que se liberó la cola; después, verde en 2 min |

**Que era el runner y no el código, medido**: mismo commit `e64a164`, mismo
paso `tsc --noEmit`. El job `default` tardó **92 segundos** y salió verde; el
`completo` se colgó **47 minutos** en ese mismo paso. Un `typecheck` de este
proyecto tarda segundos en cualquier sitio.

**Why:** la puerta de promoción a producción exige *"CI en verde para ESE
commit, en todas las configuraciones de la matriz"*. Dos commits de `main`
quedaron ese día sin registro verde —uno cancelado por desplazamiento, otro
por mí—. Si algún día hay que promover parándose en uno de ellos, no existe la
evidencia que la constitución pide, y el hueco no se ve: `gh run list` muestra
`cancelled`, que a simple vista parece que alguien lo decidió.

**How to apply:**

1. Antes de promover, comprobar el estado de la corrida **de ese commit
   exacto**, no la última de `main`:
   `gh run list --branch main --json headSha,status,conclusion`.
   `conclusion` vacío significa `pending` o `in_progress`, **no** verde.
2. Si una corrida lleva mucho más de ~2 minutos, mirar en qué paso está:
   `gh run view <id> --json jobs -q '.jobs[].steps[]'`. Comparar la duración
   del job hermano de la matriz es lo que distingue un runner colgado de un
   problema real del código.
3. `gh run cancel <id>` sobre un runner colgado **tarda en surtir efecto**
   (minutos, y el primer intento parece no hacer nada). Es normal; no
   reintentar en bucle.
4. Un commit intermedio ya superado se puede cancelar sin drama para liberar
   la cola: lo que importa para promover es la cabeza.

Ver también [[relevo-de-contenedor-en-coolify]], el otro falso rojo que se
diagnostica mirando dos veces en vez de una.
