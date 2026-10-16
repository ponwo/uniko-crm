/**
 * LLM de DEMOSTRACIÓN para grabar capturas y videos (scripts/demo-media.mjs).
 *
 * El ai-mock de la app es determinista pero contesta «Respuesta de prueba sobre
 * …», que se ve falso en un video. Este servidor se pone DELANTE: responde con
 * frases creíbles de la Ferretería El Martillo cuando reconoce el tema y, para
 * todo lo demás (el juez y los escenarios del Laboratorio, el handoff, mover
 * etapa…), reenvía tal cual al ai-mock de la app, que es lo que hace
 * reproducible el 83 → 100 del Laboratorio.
 *
 * No toca el código de la app: se activa solo apuntando OPENROUTER_BASE_URL a
 * este puerto. Jamás va en una instancia real.
 *
 *   node scripts/demo-llm.mjs            # escucha en :3101, reenvía a :3100
 */
import http from "node:http";

const PORT = Number(process.env.DEMO_LLM_PORT ?? 3101);
const APP = process.env.DEMO_APP_BASE ?? "http://localhost:3100";

/** Respuestas por tema, en el orden en que se prueban. */
const RESPUESTAS = [
  {
    re: /taladro/i,
    text: "¡Hola! Sí, tenemos dos opciones inalámbricas: el Truper 20V en $1,899 MXN y el DeWalt 20V MAX en $3,450 MXN, ambos con batería y cargador incluidos. ¿Para qué trabajo lo vas a usar? Así te recomiendo el mejor.",
  },
  {
    re: /cemento|mortero|varilla|bulto/i,
    text: "El bulto de cemento gris de 50 kg está en $245 MXN, y a partir de 10 bultos te queda en $232 MXN cada uno. Entregamos el mismo día si confirmas antes de la 1 pm. ¿Cuántos ocupas?",
  },
  {
    re: /horario|abren|cierran|a qu[eé] hora/i,
    text: "Atendemos de lunes a sábado de 8:00 a 19:00 y los domingos de 9:00 a 14:00. Estamos en Av. Hidalgo 245, colonia Centro, con estacionamiento gratis en la calle lateral.",
  },
  {
    re: /env[ií]o|entrega|domicilio|flete/i,
    text: "Sí, hacemos entrega a domicilio el mismo día si confirmas antes de la 1 pm. El flete local cuesta $150 MXN y es gratis en compras mayores a $3,000 MXN.",
  },
  {
    re: /factura/i,
    text: "Claro, facturamos el mismo día. Solo mándame tu constancia de situación fiscal y el ticket de compra, y te la enviamos por este mismo chat.",
  },
  {
    re: /pintura|vin[ií]lica|impermeab/i,
    text: "Tenemos la cubeta de vinílica blanca de 19 L en $1,150 MXN (rinde unos 90 m²) y el impermeabilizante acrílico de 5 años en $1,680 MXN. ¿Cuántos metros vas a cubrir? Te digo cuántas cubetas necesitas.",
  },
  {
    re: /pago|tarjeta|efectivo|transferencia/i,
    text: "Aceptamos efectivo, tarjeta de crédito y débito, transferencia SPEI y pago contra entrega en pedidos locales.",
  },
];

/** Las frases con las que el ai-mock pide a gritos que lo sustituyan. */
function esEcoDelMock(content) {
  try {
    const j = JSON.parse(content);
    return j.action === "reply" && /^Respuesta de prueba sobre/.test(j.text ?? "");
  } catch {
    return false;
  }
}

async function leer(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  const body = await leer(req);
  let messages = [];
  try {
    messages = JSON.parse(body).messages ?? [];
  } catch {
    /* sin cuerpo válido: se reenvía y que responda el mock */
  }
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // 1) Reenvío al ai-mock de la app: es la fuente de verdad del juez, los
  //    escenarios, el handoff y mover de etapa.
  const upstream = await fetch(`${APP}/api/dev/ai-mock${req.url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const json = await upstream.json();
  const content = json?.choices?.[0]?.message?.content ?? "";

  // 2) Solo se sustituye el eco genérico del mock, y solo en turnos del agente
  //    (no en el juez ni en el generador de escenarios).
  const esTurnoDelAgente = !/\[JUEZ\]|\[GENERADOR\]/.test(system.slice(0, 400));
  if (esTurnoDelAgente && esEcoDelMock(content)) {
    const hit = RESPUESTAS.find((r) => r.re.test(lastUser));
    const text =
      hit?.text ??
      "Con gusto te ayudo con eso. ¿Me das un poco más de detalle para darte el dato exacto? Si prefieres, te paso con alguien del equipo.";
    json.choices[0].message.content = JSON.stringify({ action: "reply", text });
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
});

server.listen(PORT, () => console.log(`[demo-llm] :${PORT} → ${APP}/api/dev/ai-mock`));
