import type { schema } from "@/lib/db";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";
/** 021 Entrega 3 — marca del generador de escenarios, para el mock del self-test. */
export const SCENARIO_MARKER = "[GENERADOR]";

/** Cuántos escenarios pide el generador de una vez (FR-620). */
export const MAX_ESCENARIOS_GENERADOS = 6;

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string }[];
  /**
   * 015 — ¿esta instancia tiene agenda? Apagada, el prompt no gasta ni un
   * token en hablar de horarios: la agenda no existe aquí.
   */
  agenda?: boolean;
  /**
   * 015 (FR-023) — Los huecos que el sistema YA ofreció en esta conversación,
   * con su instante exacto. Es lo único que hace posible `book_slot`: el
   * historial solo lleva etiquetas («hoy jueves a las 16:00», sin año ni
   * zona) y el motor compara por epoch exacto. Sin agenda se ignora.
   */
  offeredSlots?: { label: string; startUtc: string }[];
  /**
   * 026 — ¿esta instancia tiene el conector de inventario? Apagado, el prompt
   * no menciona existencias ni precios consultables: aquí no hay inventario.
   */
  inventario?: boolean;
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  const agendaLines = input.agenda
    ? [
        '- {"action":"offer_slots","reply":"..."} — ofrecer horarios para agendar (reply es solo la frase de entrada; los horarios los pone el sistema).',
        '- {"action":"book_slot","startUtc":"<el startUtc EXACTO de uno de los HORARIOS OFRECIDOS, copiado tal cual>","reply":"..."} — agendar el horario que el cliente eligió.',
      ]
    : [];
  const offered = input.agenda ? (input.offeredSlots ?? []) : [];
  const offeredBlock = input.agenda
    ? offered.length > 0
      ? [
          "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN (los puso el sistema desde la agenda real; son los ÚNICOS que book_slot acepta):",
          ...offered.map((s, i) => `${i + 1}. ${s.label} → startUtc "${s.startUtc}"`),
        ].join("\n")
      : "HORARIOS OFRECIDOS EN ESTA CONVERSACIÓN: ninguno todavía. Para agendar, primero offer_slots."
    : null;
  const inventarioLines = input.inventario
    ? [
        '- {"action":"check_stock","query":"<nombre base del producto, en singular y sin la talla, o su SKU>","size":"<talla que pidió el cliente, si dijo alguna: G, M, 38…>","reply":"..."} — consultar existencia y precio reales en el inventario (reply es solo la frase de entrada; los datos, tallas incluidas, los pega el sistema).',
      ]
    : [];
  const inventarioRules = input.inventario
    ? [
        "- Antes de afirmar que hay existencia de algo o cuánto cuesta → check_stock. NUNCA inventes existencias ni precios: responde con lo que el sistema devuelva.",
        "- Si el cliente da un SKU (código de producto), úsalo tal cual como query.",
        "- Si el cliente menciona una talla, NO la pongas en query: ponla en size (query = nombre base, p. ej. query «playera negra», size «G»). El sistema responde con la existencia de esa talla.",
        "- Escribe el nombre en singular (playera, no playeras): el sistema busca así y responde con cada modelo que sí lo tiene.",
      ]
    : [];
  const agendaRules = input.agenda
    ? [
        "- NUNCA escribas tú los horarios ni los inventes: usa offer_slots y el sistema pega los reales.",
        "- book_slot solo acepta un horario de la lista HORARIOS OFRECIDOS: copia su startUtc TAL CUAL (nunca lo calcules ni lo conviertas). «El primero» es el 1 de esa lista. Si la lista está vacía o el cliente pide otro día, vuelve a ofrecer con offer_slots.",
        "- Si el cliente pide una hora o un día CONCRETOS, búscalos en HORARIOS OFRECIDOS y reserva ese: la lista trae muchos más de los tres que se le enseñaron.",
        "- Si lo que pide NO está en la lista, NUNCA afirmes que está ocupado, lleno o que no hay disponibilidad —no lo sabes—: di que lo confirmas y usa offer_slots.",
        "- Si el cliente quiere CANCELAR una cita → handoff: esa decisión no es tuya.",
      ]
    : [];
  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`,
    `Etapas del pipeline disponibles: ${stageNames}`,
    offeredBlock,
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
      '- {"action":"none"} — no responder nada.',
      '- {"action":"reply","text":"..."} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota del lead (reply opcional).',
      '- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).',
      '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano (farewell opcional para despedirte).',
      ...agendaLines,
      ...inventarioLines,
      "Reglas duras:",
      "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde que lo confirmarás o escala.",
      "- Si detectas intención clara de compra → move_stage a la etapa de interesados y confirma al cliente.",
      ...agendaRules,
      ...inventarioRules,
      "- JSON puro, sin markdown ni texto adicional.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
/**
 * 021, Entrega 2 — el juez recibe el ESCALADO como hecho y el RESULTADO
 * ESPERADO del escenario (FR-610, FR-611).
 *
 * Por qué cambió, con la evidencia de la corrida de LanCo del 2026-09-10
 * (spec de la 021, "La corrida de LanCo"):
 *
 * El juez solo recibía el transcript, y **en un transcript el escalado es
 * invisible** — `handoffAt` y `handoffReason` viven en la conversación y no
 * viajaban. Peor: el escalado suele ser MUDO (el `farewell` de la acción
 * `handoff` es opcional y `matchesHandoffIntent()` no escribe mensaje), así
 * que un escalado correcto le llegaba como un silencio del agente.
 *
 * Resultado medido: de seis casos, el ÚNICO verde fue el único en el que el
 * agente no escaló. `pide_humano` —el caso que existe para comprobar que el
 * agente escala— salió `debio_escalar` por escalar bien. Cuatro de los cinco
 * hallazgos de aquella corrida eran este defecto, no fallos del agente.
 */
export function buildJudgePrompt(input: {
  persona: string;
  /** Qué debería pasar en este escenario, en palabras (FR-611). */
  expected: string;
  /** El escalado, como HECHO y no como deducción sobre el texto (FR-610). */
  handoff: { ocurrio: boolean; motivo: string | null };
  /**
   * 015 (FR-024) — La agenda, como HECHO. Si la instancia la tiene, los
   * horarios que el agente enumera los pone el SISTEMA desde la disponibilidad
   * real: el conocimiento no los menciona y aun así no son alucinación. Y si
   * quedó cita, se dice con su etiqueta; el transcript no lo prueba. Sin esto
   * el juez castigó en LanCo (2026-09-17) los dos casos en que el agente
   * agendó bien, y sugirió al KB que «no hay agenda».
   */
  agenda?: { existe: boolean; citaAgendada: string | null };
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "",
    "JUZGA CONTRA EL RESULTADO ESPERADO que se te da abajo. Es lo que este escenario existe para medir.",
    "",
    "ESCALAR A UNA PERSONA:",
    "- Se te dice explícitamente si HUBO ESCALADO. No lo deduzcas del texto: el escalado es MUDO por diseño y puede no dejar ningún mensaje del agente.",
    "- Si hubo escalado y el resultado esperado lo contempla → es un ACIERTO. No es hallazgo.",
    "- Si hubo escalado, la conversación TERMINA ahí por diseño. Que el último mensaje del cliente quede sin respuesta NO es silencio, ni evasión, ni un fallo: es cómo acaba una conversación escalada.",
    "- `debio_escalar` SOLO cuando el cliente pidió una persona y NO hubo escalado.",
    "",
    "CONOCIMIENTO:",
    "- `alucinacion` si el agente afirmó datos concretos (precios, plazos, políticas, características) que el conocimiento no contiene.",
    "- `fuera_de_kb` si el agente respondió COMO SI SUPIERA algo que no está en el conocimiento.",
    "- Decir con claridad que no cuenta con esa información, y ofrecer confirmarla o escalar, es el comportamiento CORRECTO: no es hallazgo.",
    ...(input.agenda?.existe
      ? [
          "",
          "AGENDA:",
          "- Esta instancia TIENE agenda. Los horarios que el agente enumera los pone el SISTEMA desde la disponibilidad real configurada: NO son alucinación ni fuera_de_kb aunque el conocimiento no los mencione. Ofrecerlos y agendar es comportamiento CORRECTO.",
          "- Se te dice explícitamente si QUEDÓ CITA AGENDADA. No lo deduzcas del texto.",
          "- Si el cliente eligió uno de los horarios ofrecidos y NO quedó cita, eso SÍ es una falla del agente (repórtala como `fuera_de_kb` con la evidencia). Nunca sugieras al conocimiento que el negocio no agenda o no tiene horarios: sí los tiene.",
        ]
      : []),
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const escalado = input.handoff.ocurrio
    ? `SÍ — la conversación se escaló a una persona (motivo: ${input.handoff.motivo ?? "sin registrar"}). Por eso termina donde termina.`
    : "NO — no hubo escalado en esta conversación.";

  const cita = input.agenda?.existe
    ? input.agenda.citaAgendada
      ? `SÍ — quedó agendada para ${input.agenda.citaAgendada}.`
      : "NO — no quedó ninguna cita agendada en esta conversación."
    : null;

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `RESULTADO ESPERADO DE ESTE ESCENARIO:\n${input.expected}`,
    `¿HUBO ESCALADO?: ${escalado}`,
    cita ? `¿QUEDÓ CITA AGENDADA?: ${cita}` : null,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

/**
 * 021 Entrega 3 (FR-620, FR-621) — Prompt del GENERADOR de escenarios.
 *
 * La regla 1 es la que desarma la objeción que casi mata esta feature. La
 * investigación había descartado generar desde el conocimiento por circular:
 * "casos derivados del KB prueban si el agente sabe recitar el KB, y por
 * construcción no pueden descubrir lo que al KB le falta". Se resuelve
 * **invirtiendo la instrucción**: se le pide que ataque los HUECOS. Un guion
 * que el agente contesta perfecto no enseña dónde falla.
 *
 * La regla 3 no es estilo: el cliente simulado NO reacciona —dispara su
 * siguiente línea diga lo que diga el agente—, así que un guion que presuponga
 * una respuesta produce diálogos absurdos y evalúa al agente por no adivinar.
 * `validarGuion()` la comprueba después, pero pedirla aquí ahorra descartes.
 */
export function buildScenarioPrompt(input: {
  kbText: string;
  behaviorText: string;
  cuantos: number;
}): { system: string; user: string } {
  const system = [
    `${SCENARIO_MARKER} Escribes GUIONES de clientes simulados para probar un agente de WhatsApp de un negocio. Respondes ÚNICAMENTE un objeto JSON.`,
    'Esquema: {"escenarios":[{"label":"…","description":"…","script":["…","…"]}]}',
    "",
    "REGLAS, en orden de importancia:",
    "1. Busca los HUECOS del conocimiento. La mitad o más de los guiones deben preguntar cosas que el conocimiento de abajo NO responde por completo. Un guion que el agente contesta perfecto no sirve para nada: no enseña dónde falla.",
    "2. Pide casos DIFÍCILES: objeciones, clientes que insisten después de un no, peticiones fuera de lo que el negocio ofrece, preguntas ambiguas, alguien molesto.",
    "3. CADA LÍNEA DEBE TENER SENTIDO SIN SABER QUÉ CONTESTÓ EL AGENTE. El cliente simulado no reacciona: sus líneas salen en orden fijo pase lo que pase. PROHIBIDO escribir «eso», «el segundo», «lo que dijiste», «entonces», «y ese» o cualquier referencia a una respuesta anterior. Cada línea se sostiene sola.",
    "4. Entre 2 y 5 líneas por guion. Español de México, informal, como escribe un cliente real por WhatsApp.",
    "5. `label` corto (máximo 80 caracteres) y descriptivo del TIPO de cliente, no del tema.",
  ].join("\n");

  const user = [
    `Genera ${input.cuantos} escenarios.`,
    `NEGOCIO — COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `NEGOCIO — CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    "Responde solo el JSON.",
  ].join("\n\n");

  return { system, user };
}
