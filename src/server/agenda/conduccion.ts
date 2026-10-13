import { addDaysISO, dayLabelInTz, todayInTz, weekdayKeyOf, zonedWallClockToUtc } from "@/lib/time/slots";
import type { AvailableSlot } from "@/server/agenda/availability";
import type { CalendarSettings } from "@/server/agenda/settings";
import { horaTexto, minutosDe, type DiaPedido } from "@/server/agenda/pedido";
import {
  catalogByDay,
  cercanosA,
  enFranja,
  etiquetar,
  repartir,
  type Franja,
  type SpreadSlot,
} from "@/server/agenda/spread";

/**
 * 035 — Cómo se agenda una cita por chat: primero el DÍA, después la FRANJA
 * (mañana o tarde), y entonces cuatro horarios de ese día en esa franja.
 *
 * Pedido del dueño (2026-10-12): «si pides una cita solo muestra los horarios
 * … eso no es muy natural; podríamos primero preguntar para qué día está
 * buscando, y después si prefiere por la mañana o por la tarde, y entonces sí
 * ofrecer los 4 horarios». Antes, «quiero una cita» recibía de golpe cuatro
 * horarios de los primeros días libres, que casi nunca eran el día del cliente.
 *
 * Quien conduce es el MOTOR, no el modelo. El modelo solo extrae lo que el
 * cliente ya dijo (día, franja, hora) y el motor decide el siguiente paso con
 * la agenda real delante: no pregunta «¿mañana o tarde?» por un día que solo
 * tiene tarde, ni deja al cliente elegir franja en un día lleno. El modelo no
 * puede saberlo —su lista es parcial— y un menú que promete lo que no hay es
 * justo la clase de mentira que la 015 lleva tres ajustes quitando.
 *
 * Y el motor es SIN ESTADO: no recuerda qué preguntó. El modelo repite en cada
 * turno todo lo que sabe («jueves» + «tarde»), así que retomar la conversación
 * días después, o cambiar de día a medio camino, no deja nada a medias.
 *
 * PURO: recibe los huecos libres y el reloj; no toca la base. Se prueba sola
 * (tests/unit/agenda-conduccion.test.ts).
 */

/**
 * Cuántos horarios se enseñan en un menú. Cuatro desde el 2026-09-26 (decisión
 * del dueño): con tres, pedir una franja dejaba un menú demasiado pobre para
 * elegir dentro de ella.
 */
export const MENU = 4;

export type Pedido = {
  dia?: DiaPedido;
  franja?: Franja;
  /** Minutos desde la medianoche. */
  hora?: number;
};

export type PasoAgenda =
  /** No queda nada libre en toda la ventana. */
  | "agenda_llena"
  /** No dijo el día: se le pregunta. */
  | "pide_dia"
  /** Dijo un día con mañana Y tarde libres: se le pregunta cuál. */
  | "pide_franja"
  /** Se enseñan horarios de lo que pidió. */
  | "menu"
  /** Pidió una franja que ese día ya no tiene: la otra, y el día más cercano con la suya. */
  | "otra_franja"
  /** El día que pidió no tiene nada: se le proponen los días más cercanos. */
  | "dia_sin_espacio";

export type Conduccion = {
  paso: PasoAgenda;
  text: string;
  /**
   * La oferta que queda vigente: lo ÚNICO que `book_slot`/`move_slot` aceptan
   * en el turno siguiente. Con un día sobre la mesa es ese día COMPLETO —si el
   * cliente contesta «mejor a las 4» se le agenda sin otra vuelta— y nada más:
   * con otros días en la lista, «a las 4» sería ambiguo.
   */
  registrar: SpreadSlot[];
};

type Contexto = {
  settings: Pick<CalendarSettings, "timezone" | "weeklyHours" | "maxDaysAhead">;
  now: Date;
  /** El catálogo de cuando aún no hay día (el de la 015, denso y luego ralo). */
  catalogo: { denseDays: number; perDayAfter: number; limit: number };
};

const NOMBRE_FRANJA: Record<Franja, string> = { am: "mañana", pm: "tarde" };

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «hoy jueves 15 de octubre», «mañana viernes 16 de octubre», «el lunes 19 de octubre». */
function elDia(dayIso: string, tz: string, now: Date): string {
  const mediodia = zonedWallClockToUtc(dayIso, "12:00", tz);
  // Intl escribe «jueves, 15 de octubre»; dentro de una frase la coma sobra.
  const label = (mediodia ? dayLabelInTz(mediodia.toISOString(), tz, now) : dayIso).replace(/,/g, "");
  return /^(hoy|mañana) /.test(label) ? label : `el ${label}`;
}

/** Para listas de días: «hoy», «mañana», «el viernes 16». */
function diaCorto(dayIso: string, tz: string, now: Date): string {
  const hoy = todayInTz(now, tz);
  if (dayIso === hoy) return "hoy";
  if (dayIso === addDaysISO(hoy, 1)) return "mañana";
  const mediodia = zonedWallClockToUtc(dayIso, "12:00", tz);
  if (!mediodia) return dayIso;
  const semana = new Intl.DateTimeFormat("es-MX", { timeZone: tz, weekday: "long" }).format(mediodia);
  return `el ${semana} ${Number(dayIso.slice(8, 10))}`;
}

/** «hoy, el viernes 16 o el lunes 19». */
function listaDeDias(dias: string[], tz: string, now: Date): string {
  const partes = dias.map((d) => diaCorto(d, tz, now));
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} o ${partes[partes.length - 1]}`;
}

function vinetas(slots: SpreadSlot[]): string {
  return slots.map((s) => `• ${s.time}`).join("\n");
}

const CIERRE = "¿Cuál te queda mejor?";
const OTRA_HORA = " Si prefieres otra hora, dímela y la reviso.";

/** Los días con lugar más cercanos a `dayIso` (sin contarlo), en orden de calendario. */
function diasCercanos(
  porDia: Map<string, SpreadSlot[]>,
  dayIso: string,
  franja: Franja | undefined,
  n: number
): string[] {
  const distancia = (d: string) =>
    Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${dayIso}T00:00:00Z`));
  return [...porDia.entries()]
    .filter(([d, slots]) => d !== dayIso && (!franja || slots.some((s) => enFranja(s, franja))))
    .map(([d]) => d)
    .sort((a, b) => distancia(a) - distancia(b) || a.localeCompare(b))
    .slice(0, n)
    .sort();
}

/** El día completo como oferta vigente, con tope y sin perder lo enseñado. */
function delDiaConTope(delDia: SpreadSlot[], mostrados: SpreadSlot[], limite: number): SpreadSlot[] {
  if (delDia.length <= limite) return delDia;
  const ids = new Set<string>();
  return [...mostrados, ...repartir(delDia, limite)]
    .filter((s) => (ids.has(s.startUtc) ? false : (ids.add(s.startUtc), true)))
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}

export function conducirOferta(
  libres: AvailableSlot[],
  pedido: Pedido,
  ctx: Contexto
): Conduccion {
  const tz = ctx.settings.timezone;
  const now = ctx.now;
  const hoy = todayInTz(now, tz);

  if (libres.length === 0) {
    // Agenda llena no es un error: es una respuesta que el cliente entiende.
    return {
      paso: "agenda_llena",
      text: "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.",
      registrar: [],
    };
  }

  const slots = etiquetar(libres, { timezone: tz, now });
  const porDia = new Map<string, SpreadSlot[]>();
  for (const s of slots) {
    const b = porDia.get(s.dayIso);
    if (b) b.push(s);
    else porDia.set(s.dayIso, [s]);
  }
  const general = () =>
    catalogByDay(libres, { timezone: tz, now, ...ctx.catalogo });

  const { franja, hora } = pedido;
  const franjaDeHora: Franja | undefined =
    hora === undefined ? undefined : hora < 12 * 60 ? "am" : "pm";

  /* ---------- 1. ¿De qué día hablamos? ---------- */
  let dayIso: string | undefined;
  const pronto = pedido.dia?.tipo === "pronto";
  if (pedido.dia?.tipo === "fecha") {
    dayIso = pedido.dia.dayIso;
  } else if (pronto) {
    const f = franja ?? franjaDeHora;
    dayIso =
      [...porDia.keys()].find((d) => !f || porDia.get(d)?.some((s) => enFranja(s, f))) ??
      [...porDia.keys()][0];
  } else if (hora !== undefined) {
    // Dijo la hora pero no el día («¿tienes a las 4?»): el primer día que la
    // tenga libre; si ninguno, el primero con algo en esa franja.
    const dias = [...porDia.keys()];
    dayIso =
      dias.find((d) => porDia.get(d)?.some((s) => minutosDe(s.time) === hora)) ??
      dias.find((d) => franjaDeHora && porDia.get(d)?.some((s) => enFranja(s, franjaDeHora)));
  }

  if (!dayIso) {
    // Lo que dijo de la franja no se pierde: la pregunta lo repite, y el
    // modelo lo volverá a mandar junto con el día.
    return {
      paso: "pide_dia",
      text: `¿Para qué día te gustaría la cita${franja ? ` por la ${NOMBRE_FRANJA[franja]}` : ""}?`,
      // Sin día no hay menú, pero «mañana a las 11» tiene que poder agendarse
      // a la primera: queda el catálogo de la 015 (ajuste 2026-09-23).
      registrar: general(),
    };
  }

  const delDia = porDia.get(dayIso) ?? [];
  const dia = elDia(dayIso, tz, now);

  /* ---------- 2. Ese día no tiene nada ---------- */
  if (delDia.length === 0) {
    const ultimoDia = addDaysISO(hoy, ctx.settings.maxDaysAhead);
    const semana = weekdayKeyOf(dayIso, tz);
    const cerrado = semana ? (ctx.settings.weeklyHours[semana] ?? []).length === 0 : false;
    const motivo =
      dayIso < hoy
        ? `${capital(dia)} ya pasó.`
        : dayIso > ultimoDia
          ? `Todavía no tengo abierta la agenda para ${dia}.`
          : cerrado
            ? `${capital(dia)} no damos citas.`
            : `${capital(dia)} ya no me queda espacio.`;
    const f = franja ?? franjaDeHora;
    const conFranja = f ? diasCercanos(porDia, dayIso, f, 3) : [];
    const alternativas = conFranja.length > 0 ? conFranja : diasCercanos(porDia, dayIso, undefined, 3);
    const propuesta =
      f && conFranja.length > 0
        ? `Por la ${NOMBRE_FRANJA[f]} tengo lugar ${listaDeDias(alternativas, tz, now)}.`
        : f
          ? `Por la ${NOMBRE_FRANJA[f]} no me queda nada en los próximos días; tengo lugar ${listaDeDias(alternativas, tz, now)}.`
          : `Tengo lugar ${listaDeDias(alternativas, tz, now)}.`;
    return {
      paso: "dia_sin_espacio",
      text: `${motivo} ${propuesta} ¿Cuál te acomoda?`,
      registrar: general(),
    };
  }

  const manana = delDia.filter((s) => enFranja(s, "am"));
  const tarde = delDia.filter((s) => enFranja(s, "pm"));
  const deFranja = (f: Franja) => (f === "am" ? manana : tarde);
  const conOferta = (paso: PasoAgenda, text: string, mostrados: SpreadSlot[]): Conduccion => ({
    paso,
    text,
    registrar: delDiaConTope(delDia, mostrados, ctx.catalogo.limit),
  });

  /* ---------- 3. Pidió una hora concreta ---------- */
  if (hora !== undefined && !pronto) {
    const mostrados = cercanosA(delDia, hora, MENU);
    const libre = delDia.some((s) => minutosDe(s.time) === hora);
    const entrada = libre
      ? `Para ${dia}, cerca de las ${horaTexto(hora)} tengo:`
      : `Para ${dia} a las ${horaTexto(hora)} ya no tengo; lo más cercano es:`;
    return conOferta("menu", `${entrada}\n${vinetas(mostrados)}\n${CIERRE}`, mostrados);
  }

  /* ---------- 4. Lo antes posible ---------- */
  if (pronto) {
    // Aquí sí van los primeros, seguidos: quien tiene prisa quiere lo más pronto.
    const pool = franja && deFranja(franja).length > 0 ? deFranja(franja) : delDia;
    const mostrados = pool.slice(0, MENU);
    const cola = pool.length > mostrados.length ? OTRA_HORA : "";
    return conOferta(
      "menu",
      `Lo más pronto que tengo es ${dia}:\n${vinetas(mostrados)}\n${CIERRE}${cola}`,
      mostrados
    );
  }

  /* ---------- 5. Día y franja ---------- */
  if (franja) {
    const pool = deFranja(franja);
    if (pool.length > 0) {
      const mostrados = repartir(pool, MENU);
      const cola = pool.length > mostrados.length ? OTRA_HORA : "";
      return conOferta(
        "menu",
        `Para ${dia} por la ${NOMBRE_FRANJA[franja]} tengo:\n${vinetas(mostrados)}\n${CIERRE}${cola}`,
        mostrados
      );
    }
    // Decisión del dueño (2026-10-12): lo que sí hay ese día, y en una línea
    // el día más cercano que tiene la franja que pidió.
    const otra: Franja = franja === "am" ? "pm" : "am";
    const mostrados = repartir(deFranja(otra), MENU);
    // Se busca primero hacia adelante: «el viernes sí tengo» se entiende mejor
    // que proponer un día anterior al que pidió.
    const [alterno] = [
      ...diasCercanos(new Map([...porDia].filter(([d]) => d > dayIso)), dayIso, franja, 1),
      ...diasCercanos(porDia, dayIso, franja, 1),
    ];
    const pista = alterno
      ? `\nSi necesitas que sea por la ${NOMBRE_FRANJA[franja]}, ${diaCorto(alterno, tz, now)} sí tengo.`
      : "";
    return conOferta(
      "otra_franja",
      `${capital(dia)} por la ${NOMBRE_FRANJA[franja]} ya no me queda espacio. Ese día por la ${NOMBRE_FRANJA[otra]} tengo:\n${vinetas(mostrados)}${pista}`,
      mostrados
    );
  }

  /* ---------- 6. Solo el día ---------- */
  if (delDia.length <= MENU) {
    // Preguntar la franja para enseñar lo mismo sería una vuelta de más.
    return conOferta("menu", `Para ${dia} tengo:\n${vinetas(delDia)}\n${CIERRE}`, delDia);
  }
  if (manana.length === 0 || tarde.length === 0) {
    const unica: Franja = manana.length > 0 ? "am" : "pm";
    const pool = deFranja(unica);
    const mostrados = repartir(pool, MENU);
    const cola = pool.length > mostrados.length ? OTRA_HORA : "";
    return conOferta(
      "menu",
      `Para ${dia} solo me queda espacio por la ${NOMBRE_FRANJA[unica]}:\n${vinetas(mostrados)}\n${CIERRE}${cola}`,
      mostrados
    );
  }
  return conOferta("pide_franja", `Para ${dia}, ¿prefieres por la mañana o por la tarde?`, []);
}

/**
 * La frase de entrada que manda el modelo, SOLO si no promete nada de la
 * agenda (035).
 *
 * Antes el motor siempre pegaba horarios debajo, así que una entrada como
 * «Claro, estos son mis horarios:» tenía sentido. Ahora el motor puede
 * contestar con una pregunta («¿Para qué día…?»), y esa misma entrada quedaría
 * como mentira encima de ella. Se queda lo que no habla de la agenda —«¡Claro!»
 * o «La cita dura 30 minutos.»— y se tira lo que la describe, pregunta o abre
 * una lista: eso lo escribe el motor, que es quien sabe qué hay.
 */
export function entradaDelModelo(intro: string | undefined): string | undefined {
  const v = intro?.trim();
  if (!v) return undefined;
  if (/[?¿]/.test(v) || /:\s*$/.test(v)) return undefined;
  if (/\b(horarios?|disponib\w*|espacios?|huecos?|lugar(es)?|llen[oa]s?|ocupad\w*)\b/i.test(v)) {
    return undefined;
  }
  return v;
}
