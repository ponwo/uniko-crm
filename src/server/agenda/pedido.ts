/**
 * 035 — Lo que el cliente pidió de la cita, en sus palabras, traducido a algo
 * que el motor pueda buscar: el DÍA y la HORA.
 *
 * Lo traduce el código y no el modelo, a propósito. Pasar de «el jueves» a una
 * fecha es aritmética de calendario, y un modelo barato la falla de vez en
 * cuando —un día de más y el cliente queda citado en otra fecha—. Aquí es
 * determinista y se prueba sola (tests/unit/agenda-pedido.test.ts).
 *
 * Se tolera la forma en que venga («jueves», «el próximo jueves», «15 de
 * octubre», «2026-10-15»): la salida del modelo es impredecible y un acento de
 * más no puede costar el turno. Lo que no se entiende devuelve `undefined` y el
 * motor vuelve a preguntar el día; nunca adivina.
 *
 * PURO: sin reloj y sin zona. Recibe «hoy» ya resuelto en la zona del negocio
 * (`todayInTz`), así que todo lo de aquí es aritmética de fechas ISO.
 */

export type DiaPedido =
  /** Un día concreto del calendario (YYYY-MM-DD, en la zona del negocio). */
  | { tipo: "fecha"; dayIso: string }
  /** «Lo antes posible»: el primer día que tenga lugar. */
  | { tipo: "pronto" };

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

const MESES: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

/** Minúsculas, sin acentos ni signos, espacios simples. */
function normalizar(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/:\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fecha ISO válida o `undefined` (el 31 de noviembre no existe). */
function fechaValida(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

function sumarDias(dayIso: string, dias: number): string {
  const t = Date.parse(`${dayIso}T00:00:00Z`);
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, como `getUTCDay`. */
function diaDeLaSemana(dayIso: string): number {
  return new Date(`${dayIso}T12:00:00Z`).getUTCDay();
}

/** «El 15»: este mes si todavía no pasa; si ya pasó, el mes siguiente. */
function diaDelMes(dia: number, todayIso: string): string | undefined {
  const [y, m, d] = todayIso.split("-").map(Number) as [number, number, number];
  if (dia >= d) {
    const este = fechaValida(y, m, dia);
    if (este) return este;
  }
  return m === 12 ? fechaValida(y + 1, 1, dia) : fechaValida(y, m + 1, dia);
}

/** «15 de octubre» sin año: este año si no ha pasado; si ya pasó, el siguiente. */
function fechaSinAnio(dia: number, mes: number, todayIso: string): string | undefined {
  const y = Number(todayIso.slice(0, 4));
  const este = fechaValida(y, mes, dia);
  if (este && este >= todayIso) return este;
  return fechaValida(y + 1, mes, dia);
}

export function parseDia(
  raw: string | null | undefined,
  todayIso: string
): DiaPedido | undefined {
  // La franja no es un día: «por la mañana» trae «mañana» y no es el día
  // siguiente. Se quita antes de leer, por si el modelo la mandó aquí.
  const v = normalizar(raw)
    .replace(/\b(?:por|en|de|a)\s+la\s+(?:manana|tarde|noche)\b/g, " ")
    .replace(/\btemprano\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return undefined;

  // 1. Fechas explícitas, de la más a la menos precisa.
  const iso = v.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const f = fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return f ? { tipo: "fecha", dayIso: f } : undefined;
  }
  // Se recorren TODAS las coincidencias: en «4 del 15 de octubre» la primera
  // («4 del») no es una fecha y la buena viene después.
  for (const conMes of v.matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\b(?:\s+(?:de\s+|del\s+)?(\d{4}))?/g)) {
    const mes = MESES[conMes[2] ?? ""];
    if (!mes) continue;
    const dia = Number(conMes[1]);
    const f = conMes[3]
      ? fechaValida(Number(conMes[3]), mes, dia)
      : fechaSinAnio(dia, mes, todayIso);
    return f ? { tipo: "fecha", dayIso: f } : undefined;
  }
  const barra = v.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (barra) {
    // En México la barra es día/mes.
    const dia = Number(barra[1]);
    const mes = Number(barra[2]);
    const anio = barra[3] ? Number(barra[3].length === 2 ? `20${barra[3]}` : barra[3]) : undefined;
    const f = anio ? fechaValida(anio, mes, dia) : fechaSinAnio(dia, mes, todayIso);
    return f ? { tipo: "fecha", dayIso: f } : undefined;
  }

  // 2. Relativos.
  if (/\bpasado\s+manana\b/.test(v)) return { tipo: "fecha", dayIso: sumarDias(todayIso, 2) };
  if (/\bhoy\b/.test(v)) return { tipo: "fecha", dayIso: todayIso };
  if (/\bmanana\b/.test(v)) return { tipo: "fecha", dayIso: sumarDias(todayIso, 1) };

  // 3. Día de la semana, con o sin número («el jueves», «jueves 15»).
  const semana = v.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b(?:\s+(\d{1,2})\b)?/);
  if (semana) {
    if (semana[2]) {
      const f = diaDelMes(Number(semana[2]), todayIso);
      return f ? { tipo: "fecha", dayIso: f } : undefined;
    }
    const objetivo = DIAS_SEMANA.indexOf(semana[1] ?? "");
    const hoy = diaDeLaSemana(todayIso);
    let delta = (objetivo - hoy + 7) % 7;
    // «El jueves» dicho un jueves es el de la semana que entra; «este jueves», hoy.
    if (delta === 0 && !/\best[ea]\s+(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.test(v)) {
      delta = 7;
    }
    // «El lunes de la próxima semana»: si el próximo lunes cae en ESTA semana, el otro.
    if (/\b(?:proxima|siguiente|otra)\s+semana\b|\bsemana\s+que\s+(?:entra|viene)\b|\bque\s+entra\b/.test(v)) {
      const lunesDeHoy = (hoy + 6) % 7; // 0 = lunes
      if (delta < 7 - lunesDeHoy) delta += 7;
    }
    return { tipo: "fecha", dayIso: sumarDias(todayIso, delta) };
  }

  // 4. Solo el número: «el 15», «día 15».
  const numero = v.match(/^(?:el\s+)?(?:dia\s+)?(\d{1,2})$/);
  if (numero) {
    const f = diaDelMes(Number(numero[1]), todayIso);
    return f ? { tipo: "fecha", dayIso: f } : undefined;
  }

  // 5. Sin día concreto, pero con prisa.
  if (
    /\b(?:pronto|antes\s+posible|cuanto\s+antes|lo\s+mas\s+proximo|mas\s+cercano|primer\s+(?:dia|hueco|horario|espacio|lugar)|cuando\s+sea|cualquier\s+dia|el\s+que\s+sea|lo\s+que\s+tengas)\b/.test(
      v
    )
  ) {
    return { tipo: "pronto" };
  }
  return undefined;
}

/**
 * La HORA que pidió el cliente, en minutos desde la medianoche: «16:00», «4 de
 * la tarde», «11am», «a las 4 y media», «mediodía».
 *
 * Sin am/pm, de la 1 a las 7 se lee como tarde: nadie pide una cita «a las 4»
 * pensando en las 4 de la madrugada.
 */
export function parseHora(raw: string | null | undefined): number | undefined {
  // «11am» → «11 am»: pegado al número, el am/pm no tiene límite de palabra.
  const v = normalizar(raw).replace(/(\d)([a-z])/g, "$1 $2");
  if (!v) return undefined;
  if (/\bmedio\s?dia\b/.test(v)) return 12 * 60;

  const m =
    v.match(/\ba\s+las?\s+(\d{1,2})(?:\s*:\s*(\d{2}))?(\s+y\s+(?:media|cuarto))?/) ??
    v.match(/\b(\d{1,2})(?:\s*:\s*(\d{2}))?(\s+y\s+(?:media|cuarto))?/);
  if (!m) return undefined;

  let h = Number(m[1]);
  let min = m[2] ? Number(m[2]) : 0;
  if (m[3]) min = /media/.test(m[3]) ? 30 : 15;

  const pm = /\b(?:p\s?m|de\s+la\s+(?:tarde|noche)|en\s+la\s+tarde|por\s+la\s+(?:tarde|noche))\b/.test(v);
  const am = /\b(?:a\s?m|de\s+la\s+manana|en\s+la\s+manana|por\s+la\s+manana|temprano)\b/.test(v);
  if (pm && h < 12) h += 12;
  else if (am && h === 12) h = 0;
  else if (!pm && !am && h >= 1 && h <= 7) h += 12;

  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return h * 60 + min;
}

/** «16:00» a partir de minutos desde la medianoche. */
export function horaTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** «16:30» → 990. */
export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
