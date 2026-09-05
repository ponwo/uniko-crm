---
description: "Ejecuta la puerta de promoción a producción de la constitución; verifica, resume y se detiene sin promover"
---

# Puerta de promoción a producción

Ejecuta la **puerta de promoción a producción** tal como está normada en
`.specify/memory/constitution.md`, sección "Flujo de Desarrollo y Puertas de
Calidad", con el Principio X para lo que toca migraciones.

Este comando **no inventa criterios**. Las seis condiciones son las de la
constitución; si algún día divergen, gana la constitución y este archivo se
corrige.

## Lo que este comando NO hace, y por qué

**No promueve.** No hace `git merge`, no hace `git push` y no escribe en
`production`. Termina con un resumen y se detiene. El `git merge --ff-only` y el
push los dispara el responsable, aparte, con una confirmación explícita.

Es deliberado. Dos bases de clientes migran al arrancar el contenedor, a la vez
y sin `down`. Si el comando promoviera al final de su propia checklist, el
momento irreversible llegaría como consecuencia de haber contestado bien seis
preguntas — y para la sexta uno ya está en modo trámite. Separar la verificación
del disparo devuelve un instante de decisión justo antes de lo único que no se
deshace.

Encaja con la constitución, que lo dice en esos términos: *la señal es el
disparador; estas condiciones son la puerta*. La puerta se comprueba sola; la
señal la da una persona.

## Reglas duras

- **Sin escape.** Si una condición falla, el comando se detiene y dice qué
  falta. No hay `--force`, ni "saltar con justificación", ni un modo interactivo
  que permita seguir de todos modos. Si alguna vez estorba, se relaja a
  propósito y sabiendo por qué; al revés no funciona.
- **Solo lectura sobre `production`.** No se hace checkout de esa rama, no se
  escribe en ella. El `git fetch` del guion es la única escritura, y es local.
- **El merge, cuando llegue, es `--ff-only` siempre.** Si falla, significa que
  alguien tocó `production` a mano: se detiene y se reporta, nunca se fuerza.

## Ejecución

### Paso 1 — Condiciones mecanizables

Corre el guion, que es solo lectura:

```bash
bash .specify/extensions/uniko/scripts/bash/promote-gate.sh
```

Comprueba, en este orden:

1. **`main` local al día con `origin/main`** (cordura: lo que se promueve es lo
   que está en el remoto).
2. **¿Hay algo que promover?** Si `production` ya está en el mismo commit,
   imprime `::ESTADO:: NADA_QUE_PROMOVER` y sale con 3. Dilo y termina ahí: no
   hay puerta que evaluar.
3. **Condición 2 — LanCo desplegado es lo que se va a promover.** `curl` a
   `/api/health` de LanCo y comparación del commit reportado contra el HEAD de
   `main`. Se comprueba primero porque es la que más veces va a cortar: `main`
   recién mergeado no es `main` desplegado.
4. **Condición 1 — CI en verde para ESE commit**, consultada por SHA
   (`check-runs` del commit), no por el último run de la rama. Todas las
   configuraciones de la matriz deben estar en `success`.
5. **Condición 5 — qué viaja**: `git log production..main --oneline`.
6. **Condición 4 — ¿toca `drizzle/`?** Imprime `::DRIZZLE:: SI` o
   `::DRIZZLE:: NO`.

Si el guion sale distinto de cero, **para ahí**. Muestra el motivo tal cual y no
sigas preguntando: la puerta está cerrada y las preguntas siguientes no la
abren.

### Paso 2 — Condición 4, solo si toca `drizzle/`

Si el guion imprimió `::DRIZZLE:: NO`, **salta este paso entero**. No preguntes
por migraciones cuando no hay migraciones: una pregunta que siempre se contesta
igual deja de leerse.

Si imprimió `::DRIZZLE:: SI`, pide el **registro del ensayo del Principio X**.
Esta es la única condición que exige evidencia, porque es la única irreversible.
Pregunta:

> Este cambio toca `drizzle/`. ¿Dónde quedó registrado el ensayo del Principio
> X, y contra qué respaldo se corrió?

**No aceptes un "sí", ni un "ya lo hice", ni un "confía".** La respuesta útil
nombra dos cosas: dónde está el registro (un enlace, un archivo, la salida
pegada) y de qué instancia y fecha era el respaldo que se restauró. Si la
respuesta no trae las dos, dilo y detente.

Recuerda al responder, si hace falta, lo que el Principio X exige: PostgreSQL
desechable con un respaldo real restaurado, nunca base vacía, nunca sobre una
instancia viva ajena, y `pnpm seed:demo` no cuenta.

### Paso 3 — Condiciones 2 y 3, declaradas

Pregunta **una por una, esperando respuesta antes de la siguiente**. No las
juntes en un bloque: un bloque de preguntas se contesta de una vez y con un
solo "sí".

Estas dos se declaran en vez de exigir evidencia porque su peor caso se arregla
con otro deploy — a diferencia de una migración.

1. > ¿El cambio ejerció **uso real** en LanCo? No "está desplegado" (eso ya lo
   > comprobó el guion): que alguien lo haya usado de verdad.

2. > ¿El **self-test de comportamiento** del Principio IX se corrió contra LanCo
   > desplegado, no solo contra `localhost`?

Si alguna se responde que no, **detente**. Di cuál falta y qué haría falta para
cerrarla.

### Paso 4 — Condición 6, plan de reversión

> ¿Cuál es el plan de reversión? Si el cambio ya viene partido en dos entregas,
> dilo y sirve como respuesta.

Si la respuesta honesta es que no se puede revertir y no está partido en dos
entregas, **detente**: según el Principio X, eso significa que al cambio le
falta partirse.

### Paso 5 — Resumen y alto

Muestra un resumen y **para**:

- Los commits que viajan (los del paso 1).
- El estado de las seis condiciones, una por línea, diciendo cuál se verificó
  por máquina y cuál quedó declarada.
- El plan de reversión declarado, tal cual lo dio el responsable.
- Si tocaba `drizzle/`: dónde quedó el registro del ensayo.

Y cierra recordando, sin ejecutarlo, lo que falta:

> La puerta está abierta. La promoción **no** se ha hecho: la disparas tú.
>
>     git checkout production && git merge --ff-only main && git push
>
> Si `--ff-only` falla, alguien tocó `production` a mano: corrígelo antes de
> seguir, nunca lo fuerces.
>
> Después, cierra verificando la flota:
>
>     bash .specify/extensions/uniko/scripts/bash/verify-fleet.sh

## Cierre: verificar la flota

El paso posterior tiene su propio guion, `verify-fleet.sh`, para que se pueda
correr por separado y las veces que haga falta mientras los redespliegues
terminan.

Hace `curl` a `/api/health` de las tres instancias
(`docs/despliegue-flota.md`) y compara el commit reportado contra el promovido.
No basta con un `ok:true`: **un contenedor que no levanta porque la migración
reventó no avisa** — su health sigue contestando desde el contenedor viejo y
reportando el commit anterior. El commit es lo único que distingue "ya migró" de
"nunca arrancó".

## Referencias

- Puerta de promoción y sus seis condiciones:
  [`.specify/memory/constitution.md`](../../../memory/constitution.md),
  sección "Flujo de Desarrollo y Puertas de Calidad".
- Principio X (irreversibilidad, ensayo de migraciones): misma constitución.
- Mecánica de ramas, dominios de la flota y healthchecks:
  [`docs/despliegue-flota.md`](../../../../docs/despliegue-flota.md).
