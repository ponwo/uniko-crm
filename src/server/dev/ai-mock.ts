import { JUDGE_MARKER } from "@/server/ai/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre cancelaciones/reembolsos (sugerencia aplicada).
  //
  // 021 — El gancho era "garantías y devoluciones" porque el KB del negocio de
  // demostración (una ferretería) omitía justo eso, a propósito, para que el
  // Laboratorio encontrara algo en la primera corrida. Retirada la ferretería
  // de los seis guiones, el tema pasa a cancelaciones y reembolsos: lo tiene
  // cualquier giro y ninguno lo monopoliza.
  //
  // La MECÁNICA no cambia, y es lo que hace determinista el loop del
  // self-test: corres → sale rojo con sugerencia → la aplicas al KB → vuelves
  // a correr y sube. La aritmética tampoco: 5 verdes + 1 rojo sobre 6 = 83,
  // y 6/6 = 100 tras aplicarla, delta +17.
  //
  // Sigue siendo un gancho por TEMA, que es una atadura al guion de
  // `fuera_de_kb`. Quitarla del todo pide que el mock despache por la FORMA
  // del prompt, y eso llega con la generación de escenarios (Entrega 3).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCubreCancelaciones = /cancelac|reembols/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCubreCancelaciones) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por cancelaciones y reembolsos y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de cancelaciones y reembolsos?",
              respuesta:
                "Puedes cancelar hasta 24 horas antes sin costo; los reembolsos se procesan en un plazo de 5 a 10 días hábiles.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  //
  // 021 — "quiero contratar" se AÑADE, no sustituye: es como cierra ahora el
  // guion neutro de `comprador_decidido` ("lo compro" ataba la frase a un
  // negocio de productos). Los términos viejos se quedan porque otros arneses
  // los usan en sus propios mensajes.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("quiero contratar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}
