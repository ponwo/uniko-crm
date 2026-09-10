import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { mockGuard } from "@/lib/dev-guard";
import { isDomainEmpty, seedDemo } from "@/server/seed/demo";

export const dynamic = "force-dynamic";

/**
 * 023 — Carga el negocio demo. **Fuera de producción**, tras el gate de mocks.
 *
 * Vivía en `POST /api/seed/demo`, alcanzable en toda instancia de la flota, y
 * era la única operación destructiva del producto: borra todo el `kb_entry` de
 * la organización, todo el historial del Laboratorio (`agent_test_run` y
 * `agent_test_case`) y sobrescribe el perfil del agente. Su guardia miraba si
 * había contactos — la tabla garantizadamente vacía justo en el negocio al que
 * debía proteger.
 *
 * En vez de blindarla se retira del sitio donde están los datos de clientes:
 * `mockGuard()` devuelve **404 incondicional en producción**, así que la ruta
 * no existe donde podría hacer daño. Se elimina el peligro en lugar de
 * vallarlo, y con él la guardia entera que la 022 iba a construir.
 *
 * Sigue existiendo porque `scripts/screenshots.mjs` la llama para poblar una
 * instancia local antes de regenerar las capturas del README. La versión por
 * CLI (`pnpm seed:demo`) permite recargar con `--force` y tampoco toca
 * producción: corre contra la base local.
 *
 * `isDomainEmpty()` se conserva: aquí ya no protege datos de clientes —no los
 * hay— pero evita que una recarga distraída pise el escenario que alguien
 * estaba montando para unas capturas.
 */
const handler = withAuth(async (session) => {
  const db = getDb();
  const empty = await isDomainEmpty(db, session.organizationId);
  if (!empty) {
    return apiError(
      409,
      "not_empty",
      "Ya hay datos en la organización; la demo solo se carga con la base vacía"
    );
  }
  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
});

/**
 * El gate va ANTES que la autenticación, y no dentro del handler.
 *
 * Al revés, en producción una petición sin sesión recibiría 401 en vez de 404,
 * y eso ya delata que la ruta existe. La promesa de `mockGuard()` es que sea
 * **indistinguible de una ruta inexistente**; un 401 la rompe.
 */
export async function POST(): Promise<Response> {
  const guard = mockGuard();
  if (guard) return guard;
  return handler();
}
