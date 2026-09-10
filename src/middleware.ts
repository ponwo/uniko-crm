import { NextResponse, type NextRequest } from "next/server";
import { isMockEnabled } from "@/lib/mock-flag";

/**
 * 024 — El perímetro de `/api/dev/*`: 404 ANTES de que Next mire el método.
 *
 * `mockGuard()` corre dentro de cada handler, pero el App Router resuelve el
 * método antes de invocarlo: si un `route.ts` no exporta `PUT`, Next responde
 * 405 por su cuenta y la guardia nunca corre. Medido en producción: la
 * diferencia entre 404 y 405 confirma qué rutas de mock existen. Es el mismo
 * fallo que la 023 cerró para el seed demo con la autenticación —un 401 ya
 * delata la ruta—, aplicado al método en vez de a la sesión.
 *
 * Este es el único sitio que corre antes del enrutado, así que es el único
 * que puede responder 404 sin condiciones. Cubre por prefijo lo que exista
 * hoy bajo `/api/dev/` y lo que alguien añada mañana: la próxima ruta de mock
 * no tiene que acordarse de exportar siete métodos. La guardia de cada
 * handler se queda como segunda capa (FR-903).
 *
 * El `matcher` es la garantía de que no interfiere con el resto de `/api/*`:
 * webhook, bot, SSE, auth y health ni siquiera pasan por aquí. No hay una
 * condición que decida "esto no es dev, sigue"; hay rutas a las que no aplica
 * por construcción.
 *
 * Corre en el runtime Edge, por eso lee la bandera desde `mock-flag.ts` y no
 * desde `env.ts` (que usa `Buffer` al cargar).
 */
export function middleware(_req: NextRequest): NextResponse {
  if (!isMockEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/dev/:path*"],
};
