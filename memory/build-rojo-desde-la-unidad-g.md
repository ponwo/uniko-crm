---
name: build-rojo-desde-la-unidad-g
description: En la máquina de desarrollo, `pnpm build` falla si arrancas desde G:\, que es un subst de C:\G; desde C:\G\gApps\LanCo\Uniko-CRM compila verde. No es Windows ni el código.
metadata:
  type: project
---

**Entorno de la máquina de desarrollo, no hecho del producto.** Esto no aplica
al código, ni al Dockerfile, ni a la CI, ni a las instancias de la flota: solo a
cómo se entra al repositorio en la máquina donde se desarrolla. En Linux y en la
CI nada de esto ocurre.

`G:\` NO es un disco: es una unidad virtual creada con `subst G: C:\G`, que
remonta en cada login desde `MontarG.bat` en la carpeta de Inicio. El repo vive
realmente en `C:\G\gApps\LanCo\Uniko-CRM`.

Webpack resuelve `node_modules` a la ruta real que hay debajo del subst
(`C:/G/...`) y después la interpreta como relativa al directorio desde el que
arrancó (`G:\gApps\LanCo\Uniko-CRM`). De ahí sale la ruta imposible
`./C:/G/gApps/.../next/dist/client/next.js` y mueren dos entradas cliente de
Next antes de compilar nada del proyecto.

**Workaround: entrar por el nombre real.** Desde `C:\G\gApps\LanCo\Uniko-CRM`,
`pnpm build` sale 0 y compila la app entera. No hay que mover el repo —ya está
en `C:`— ni tocar el código. Terminal, editor y sesiones nuevas deberían
arrancar desde la ruta real, no desde el alias.

**Lo que NO es, y hay que descartar expresamente:** no es un problema de
Windows, ni de tener el repo fuera del disco del sistema, ni de rutas largas, ni
del código. Es específicamente la unidad virtual. Esto importa más que el resto:
la explicación anterior —"rutas de Windows, es del entorno"— sonaba razonable,
nadie la comprobó, y por eso tres PRs seguidos informaron el build como "fallo
de entorno conocido" cuando bastaba con un `cd`. Si llegas a esa conclusión otra
vez, no cierres la investigación: comprueba `subst` y `fs.realpathSync.native()`
sobre el cwd, que resuelve el alias y delata la diferencia.

**Consecuencia operativa:** el gate técnico completo —typecheck, lint, test y
build— corre en local desde la ruta real. "Fallo de entorno conocido" dejó de
ser una salida válida: un build rojo vuelve a ser señal que hay que atender.

Desde este hallazgo hay puerta: `scripts/check-real-path.mjs`, enganchado en
`predev` y `prebuild`, corta con exit 1 si detecta el alias. Solo opina en
win32; en cualquier otra plataforma pasa sin decir nada, para no poder tumbar
jamás el build de un contenedor. Ver [[puerta-de-la-ruta-real]].

Estado verde verificado 2026-09-05 desde `C:\G\...`: typecheck, lint, test
(48 archivos / 402 tests) y build.
