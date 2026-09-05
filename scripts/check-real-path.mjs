// Corta `pnpm dev` y `pnpm build` cuando se entra al repo por una unidad
// virtual (`subst`) en vez de por su ruta real.
//
// El síntoma sin esto: webpack resuelve `node_modules` a la ruta real que hay
// debajo del subst y luego la interpreta como relativa al directorio del alias,
// arma `./C:/G/gApps/.../next/dist/client/next.js` y el build muere antes de
// compilar nada. El error no menciona un solo archivo del proyecto, así que es
// facil leerlo como "problema de entorno" y dejarlo pasar — ya nos costo tres
// PRs. Mejor cortar en el segundo cero, con el motivo escrito.
//
// SOLO OPINA EN WINDOWS. Esto es lo mas importante del archivo: el guion corre
// en `predev`/`prebuild`, y `prebuild` corre TAMBIEN dentro del contenedor que
// se despliega a las instancias de la flota. Un exit 1 aqui tumbaria el build
// de produccion de tres clientes por un problema que solo existe en una maquina
// de desarrollo Windows. En Linux —contenedor y CI— hay symlinks, `/app`
// montado y rutas que legitimamente difieren de su realpath; nada de eso es un
// subst y nada de eso debe fallar. Fuera de win32 el guion sale 0 sin mirar.

import { realpathSync } from "node:fs";

if (process.platform !== "win32") {
  process.exit(0);
}

const cwd = process.cwd();

// `.native` es lo que resuelve el subst; el realpath de JS no lo hace.
let real;
try {
  real = realpathSync.native(cwd);
} catch {
  // Si no se puede resolver, no es asunto nuestro: dejar seguir.
  process.exit(0);
}

// Comparacion tolerante a mayusculas: en Windows las rutas no distinguen caja,
// y una diferencia de caja no es un alias.
if (cwd.toLowerCase() === real.toLowerCase()) {
  process.exit(0);
}

process.exitCode = 1;
console.error(`
  Estas entrando al repo por un alias, no por su ruta real.

    ahora:    ${cwd}
    real:     ${real}

  '${cwd.slice(0, 2)}' es una unidad virtual (subst). Webpack resuelve
  node_modules a la ruta real y luego la trata como relativa a esta, arma una
  ruta imposible y el build muere sin nombrar un solo archivo del proyecto.

  Entra por la ruta real y vuelve a correrlo:

    cd ${real}

  No hay que mover el repo ni tocar el codigo: ya esta ahi, es la misma carpeta
  por su nombre verdadero. Detalle completo en memory/build-rojo-desde-la-unidad-g.md
`);
