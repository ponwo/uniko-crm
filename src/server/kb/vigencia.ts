import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { addDaysISO, dayIsoInTz } from "@/lib/time/slots";
import { zonaDelNegocio } from "@/server/negocio/zona";

/**
 * 033 — LA ÚNICA PUERTA de lectura al conocimiento del negocio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué existe este módulo — léelo antes de «simplificarlo»:
 *
 * `kb_entry` se leía desde SEIS sitios, cada uno con su propio `select`: el
 * turno del agente, la API del cerebro externo, la pantalla, el contador de
 * tamaño, el juez del Laboratorio y el generador de escenarios.
 *
 * Con conocimiento que vence, filtrar en cinco y olvidar uno **no rompe nada
 * visible**: el agente sigue contestando, la pantalla sigue pintando. Lo único
 * que pasa es que el producto miente —afirma una promoción vencida en nombre del
 * negocio— o que el juez castiga al agente por callar algo que el sistema le
 * ocultó a propósito.
 *
 * Un filtro repetido seis veces protege el código de hoy. Lo que hay que
 * proteger es el séptimo lector, el que alguien añada sin saber que existe una
 * regla. Por eso hay una puerta, y por eso `tests/unit/kb-vigencia-guard.test.ts`
 * escanea la RAÍZ `src/` y falla si alguien lee `kb_entry` fuera de este archivo.
 *
 * El corte se decide en CÓDIGO (`soloVigentes`), no en el `where`: el doble de
 * base de las pruebas unitarias ignora el `where`, así que un filtro en SQL
 * sería invisible para ellas. Así llegaron a producción los dos fallos de la
 * agenda que dependían del paso del tiempo. Traer todo no cuesta: el
 * conocimiento entero ya viaja en cada turno, es del tamaño de un prompt.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Estado de una entrada frente al calendario. Se DERIVA, nunca se guarda. */
export type EstadoVigencia = "vigente" | "por_vencer" | "vencida";

export type KbEntryConEstado = KbEntry & { estado: EstadoVigencia };

/**
 * Con cuánta antelación se avisa al dueño de que algo va a vencer.
 *
 * Valor del producto, no ajuste del negocio: dos semanas dan tiempo a
 * reaccionar sin que la marca esté encendida siempre. Si 14 resulta mal número,
 * cambiar una constante es más barato que retirar un ajuste ya configurado.
 */
export const DIAS_AVISO_VENCIMIENTO = 14;

/**
 * Qué cuenta como fecha de vigencia válida. Definición ÚNICA: la usan el alta y
 * la edición, para que «válida» signifique lo mismo en las dos.
 *
 * El mensaje dice QUÉ SE ESPERABA y da un ejemplo: un «datos inválidos» mudo
 * deja al dueño adivinando si falló el formato o la fecha.
 *
 * La ida y vuelta por `Date` es la que atrapa un «2026-02-31»: la expresión
 * regular lo daría por bueno y PostgreSQL lo rechazaría después con un error de
 * driver, ilegible y con pinta de fallo del servidor. Ojo: `toISOString()`
 * LANZA con una fecha inválida, y un throw dentro de un `refine` sale como 500
 * en vez del 422 explicativo; por eso se mira `getTime()` antes.
 */
export const fechaDeVigencia = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "La vigencia debe ser una fecha AAAA-MM-DD (por ejemplo, 2026-10-31)."
  )
  .refine((v) => {
    const d = new Date(`${v}T12:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Esa fecha no existe en el calendario: revisa el mes y el día.");

/**
 * Estado de una entrada. Función PURA: aquí no hay base de datos ni reloj.
 *
 * El corte es INCLUSIVO por el último día: con `validUntil` = hoy, la entrada
 * vale todo hoy y deja de valer mañana. Es como se lee en español («hasta el
 * 15» incluye el 15); la alternativa la mataría la noche del 14, que es justo
 * la sorpresa que hace desconfiar de una fecha.
 *
 * `por_vencer` NO es un estado degradado: la entrada sigue llegando al agente.
 * Es una marca para el dueño, y el agente no debe notar la diferencia.
 *
 * Las fechas `AAAA-MM-DD` se comparan como cadenas: su orden es el del
 * calendario.
 */
export function estadoDeVigencia(
  validUntil: string | null,
  hoy: string
): EstadoVigencia {
  if (!validUntil) return "vigente";
  if (validUntil < hoy) return "vencida";
  if (validUntil <= addDaysISO(hoy, DIAS_AVISO_VENCIMIENTO)) return "por_vencer";
  return "vigente";
}

/** El corte, en código. Lo vencido no pasa; lo demás, en el mismo orden. */
export function soloVigentes<T extends { validUntil: string | null }>(
  entradas: T[],
  hoy: string
): T[] {
  return entradas.filter((e) => estadoDeVigencia(e.validUntil, hoy) !== "vencida");
}

/** La entrada con su estado, para las respuestas de la pantalla. */
export function conEstado(entrada: KbEntry, hoy: string): KbEntryConEstado {
  return { ...entrada, estado: estadoDeVigencia(entrada.validUntil, hoy) };
}

/**
 * Contra qué reloj se resuelve el conocimiento.
 *
 * `ahora` se recibe en vez de leerse dentro para dos cosas: probar los bordes
 * de día sin relojes falsos, y que el Laboratorio pueda fijar UN instante para
 * toda la corrida (el agente y el juez tienen que ver el mismo conocimiento).
 * `zona` la pasa quien ya la resolvió —el turno del agente usa la misma para su
 * fecha—; si no viene, se resuelve aquí con `zonaDelNegocio()`.
 */
export type Reloj = { ahora?: Date; zona?: string };

/** Hoy (`AAAA-MM-DD`) en la zona del negocio. Nunca en UTC. */
export async function hoyDelNegocio(
  organizationId: string,
  reloj: Reloj = {}
): Promise<string> {
  const zona = reloj.zona ?? (await zonaDelNegocio(organizationId));
  return dayIsoInTz(reloj.ahora ?? new Date(), zona);
}

/** La ÚNICA lectura de la tabla. Todo lo demás pasa por aquí. */
async function entradasDe(organizationId: string): Promise<KbEntry[]> {
  return getDb()
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
}

/**
 * El conocimiento que el negocio SABE hoy.
 *
 * Es lo único que puede llegar a un modelo: al agente, al cerebro externo, al
 * juez y al generador de escenarios. Y lo que mide el contador de tamaño,
 * porque es lo que se envía.
 */
export async function conocimientoVigente(
  organizationId: string,
  reloj: Reloj = {}
): Promise<KbEntry[]> {
  const [entradas, hoy] = await Promise.all([
    entradasDe(organizationId),
    hoyDelNegocio(organizationId, reloj),
  ]);
  return soloVigentes(entradas, hoy);
}

/**
 * TODO el conocimiento del negocio, vigente y vencido, con su estado.
 *
 * La única excepción a «solo lo vigente», y deliberada: el dueño tiene que ver
 * lo suyo entero. Si lo vencido desapareciera de su pantalla, la vigencia se
 * viviría como pérdida de datos. Tiene nombre propio para que pedir «todo» sea
 * un acto CONSCIENTE y no el camino fácil: esta función no alimenta a ningún
 * modelo.
 *
 * El estado lo calcula el servidor, no el navegador: si lo calculara el
 * cliente, dependería del reloj y la zona del dispositivo del dueño, y vería
 * estados distintos de los que aplica el agente.
 */
export async function conocimientoCompleto(
  organizationId: string,
  reloj: Reloj = {}
): Promise<{ hoy: string; entradas: KbEntryConEstado[] }> {
  const [entradas, hoy] = await Promise.all([
    entradasDe(organizationId),
    hoyDelNegocio(organizationId, reloj),
  ]);
  return { hoy, entradas: entradas.map((e) => conEstado(e, hoy)) };
}
