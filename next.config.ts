import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// La versión sale de package.json y no de una constante aparte: duplicarla es
// tenerla desactualizada en uno de los dos lados, y justo esta no puede mentir.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres"],
  // Se congelan al construir: el binario lleva dentro de qué código salió, así
  // que no puede mentir en tiempo de ejecución. `SOURCE_COMMIT` lo inyecta
  // Coolify solo; con docker compose se pasa por `--build-arg` y si falta, la
  // app enseña solo la versión.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT ?? "",
  },
  // El service worker DEBE servirse desde la raíz: su ámbito es la carpeta de
  // la que sale, y necesita controlar toda la app. El handler no puede vivir en
  // `src/app/sw.js/` — un segmento del App Router terminado en `.js` hace que
  // Next crea que la petición es del Pages Router y devuelve 500 en TODA la
  // aplicación. Así que el handler vive en `/api/sw` y la URL pública es esta.
  async rewrites() {
    return [{ source: "/sw.js", destination: "/api/sw" }];
  },
};

export default nextConfig;
