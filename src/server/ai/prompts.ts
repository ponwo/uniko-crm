import type { schema } from "@/lib/db";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

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
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  const agendaLines = input.agenda
    ? [
        '- {"action":"offer_slots","reply":"..."} — ofrecer horarios para agendar (reply es solo la frase de entrada; los horarios los pone el sistema).',
        '- {"action":"book_slot","startUtc":"<uno de los horarios que el sistema ofreció, en ISO UTC>","reply":"..."} — agendar el horario que el cliente eligió.',
      ]
    : [];
  const agendaRules = input.agenda
    ? [
        "- NUNCA escribas tú los horarios ni los inventes: usa offer_slots y el sistema pega los reales.",
        "- book_slot solo acepta un horario que el sistema ofreció antes en ESTA conversación. Si el cliente pide otro, vuelve a ofrecer con offer_slots.",
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
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
      '- {"action":"none"} — no responder nada.',
      '- {"action":"reply","text":"..."} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota del lead (reply opcional).',
      '- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).',
      '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano (farewell opcional para despedirte).',
      ...agendaLines,
      "Reglas duras:",
      "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde que lo confirmarás o escala.",
      "- Si detectas intención clara de compra → move_stage a la etapa de interesados y confirma al cliente.",
      ...agendaRules,
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
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const escalado = input.handoff.ocurrio
    ? `SÍ — la conversación se escaló a una persona (motivo: ${input.handoff.motivo ?? "sin registrar"}). Por eso termina donde termina.`
    : "NO — no hubo escalado en esta conversación.";

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `RESULTADO ESPERADO DE ESTE ESCENARIO:\n${input.expected}`,
    `¿HUBO ESCALADO?: ${escalado}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
