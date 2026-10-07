import { JUDGE_MARKER, SCENARIO_MARKER } from "@/server/ai/prompts";

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

  /**
   * 021 Entrega 3 — el GENERADOR de escenarios, determinista.
   *
   * Devuelve siempre los mismos tres, y uno de ellos **malformado a
   * propósito**: sirve para comprobar que la validación es por elemento y que
   * un escenario roto no tira los buenos. Sin esto, el camino "el proveedor
   * devolvió basura mezclada con cosas útiles" no se ejercita nunca.
   *
   * Los guiones son genéricos porque el mock no sabe de qué negocio se trata —
   * y no hace falta: lo que el self-test comprueba es la mecánica de generar,
   * revisar y confirmar, no la calidad del texto, que depende del modelo real.
   */
  if (system.includes(SCENARIO_MARKER)) {
    return JSON.stringify({
      escenarios: [
        {
          label: "Pregunta por garantía",
          description: "Pregunta algo que el conocimiento probablemente no cubre.",
          script: [
            "Hola, ¿manejan algún tipo de garantía?",
            "¿Y si algo sale mal después, qué pasa?",
          ],
        },
        {
          label: "Insiste tras un no",
          description: "No acepta la primera negativa.",
          script: [
            "¿Me pueden hacer un descuento?",
            "Ándale, es que lo necesito hoy",
            "¿Ni aunque pague por adelantado?",
          ],
        },
        // Malformado a propósito: sin `script`. Se descarta, los otros no.
        { label: "Roto", description: "sin guion" },
      ],
    });
  }

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
  // del prompt. El generador de la Entrega 3, aquí arriba, ya despacha así.
  if (system.includes(JUDGE_MARKER)) {
    /**
     * 021, Entrega 2 — el mock MODELA la rúbrica nueva (FR-610..FR-613).
     *
     * `pide_humano` sale verde SOLO si el prompt dice que hubo escalado. Si el
     * hecho no viaja —que es el defecto que esta entrega arregla—, el mock
     * devuelve `debio_escalar` y el score cae de 83 a 67, así que el arnés se
     * pone rojo.
     *
     * Es deliberado que no baste con leer el transcript: ahí el escalado es
     * invisible, y un mock que lo adivinara del texto no probaría nada.
     */
    const huboEscalado = /¿HUBO ESCALADO\?: SÍ/.test(lastUser);
    if (lastUser.includes("pide_humano") && !huboEscalado) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "debio_escalar",
            evidencia:
              "El cliente pidió hablar con una persona y no consta que se escalara.",
          },
        ],
      });
    }

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

  /**
   * 033 — El agente responde SEGÚN EL CONOCIMIENTO QUE SE LE ENTREGÓ.
   *
   * Sin esto, el mock hace eco del mensaje y contesta igual sepa o no sepa: una
   * prueba de «el dato vencido deja de afirmarse» pasaría siempre, midiendo
   * nada. Kosmo cayó exactamente en esto con la misma feature y lo encontró su
   * arnés.
   *
   * Se modela lo que hace un modelo real, no un atajo: se busca el tema
   * preguntado SOLO en la sección del conocimiento del system prompt (no en el
   * historial: lo dicho antes no es conocimiento) y se responde en consecuencia.
   * El mock tiene que saber decir que NO sabe, que es lo que la 033 comprueba.
   * El gancho es un token (`KBTOK-…`) para no cambiar ninguna respuesta que los
   * demás arneses esperan: nadie más lo manda.
   */
  const tema = lastUser.match(/KBTOK-[A-Z0-9]+/i)?.[0];
  if (tema) {
    const conocimiento =
      system.split("CONOCIMIENTO DEL NEGOCIO")[1]?.split("Etapas del pipeline")[0] ?? "";
    return JSON.stringify(
      conocimiento.toUpperCase().includes(tema.toUpperCase())
        ? { action: "reply", text: `SI_CONOZCO ${tema}` }
        : {
            action: "reply",
            text: `NO_CONOZCO ${tema}: no cuento con esa información, la confirmo con el equipo.`,
          }
    );
  }

  const text = lastUser.toLowerCase();

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  /**
   * 032 — Catálogo PDF (FR-1714), SOLO si el system prompt nombra la acción (misma
   * razón que check_stock, abajo) y ANTES de check_stock: «¿tienes catálogo?» trae
   * un «tienes» que check_stock leería como si «catálogo» fuera un producto.
   *
   * Las frases van ancladas a propósito: «¿Qué es lo más popular que tienen?» (una
   * persona del Laboratorio) no pide el catálogo, y «En el catálogo dice $150,
   * ¿cuánto cuesta…?» es una consulta de precio, no un pedido del PDF. «catálogo
   * completo» devuelve una frase larguísima para que el arnés ejercite el recorte
   * del pie (FR-1704).
   *
   * Y la aceptación (US2): si el ÚLTIMO mensaje del asistente ofreció el catálogo
   * («¿te lo mando?», el cierre de check_stock con más de 10) y el cliente dice que
   * sí, se manda. Un «sí» a otra cosa no lo dispara.
   */
  if (system.includes("send_catalog")) {
    const general =
      /^¿?\s*qu[eé]\s+(?:venden|tienen|manejan)\b/i.test(lastUser.trim()) ||
      /\b(?:tienes|tienen|hay)\s+(?:un\s+|el\s+)?cat[aá]logo/i.test(lastUser) ||
      /\b(?:m[aá]nd|env[ií]|p[aá]s)\w*\s+(?:\w+\s+){0,2}(?:el\s+)?cat[aá]logo/i.test(lastUser);
    const ultimoAsistente =
      [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const acepta =
      ultimoAsistente.includes("¿te lo mando?") &&
      /^\s*(?:s[ií]|dale|m[aá]ndamelo|claro|va)(?![a-záéíóúñ])/i.test(lastUser);
    if (general || acepta) {
      const reply = /cat[aá]logo\s+completo/i.test(lastUser)
        ? `¡Claro! ${"Te cuento todo lo que manejamos, modelo por modelo y talla por talla. ".repeat(16).trim()}`
        : "¡Claro!";
      return JSON.stringify({ action: "send_catalog", reply });
    }
  }

  /**
   * 026 — Consulta de inventario, SOLO si el system prompt menciona la acción.
   *
   * Con la bandera apagada el esquema del turno no conoce `check_stock`: si el
   * mock la devolviera igual, el parseo fallaría y el turno escalaría a humano
   * por "fallo del proveedor" — la corrida `default` de la matriz se pondría
   * roja por una regla del mock, no por el producto. Condicionar por el prompt
   * es además lo que haría un modelo real: no puede nombrar lo que no le
   * enseñaron.
   */
  if (system.includes("check_stock")) {
    const m = lastUser.match(
      /(?:tienen|tienes|hay|cu[aá]nto cuesta|precio de)\s+(.+?)\s*\??\s*$/i
    );
    if (m?.[1]) {
      let query = m[1].replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, "").trim();
      // Tallas (005): "… en G", "… talla G", "… en talla G" ⇒ query = nombre base, size = G.
      // 028: la talla puede ser de varias palabras ("extra chica"); el nombre base es lo de antes del primer "en"/"talla".
      const talla = query.match(/^(.+?)\s+(?:en\s+talla|talla|en)\s+(.{1,20})$/i);
      let size: string | undefined;
      if (talla?.[1] && talla[2]) {
        query = talla[1].trim();
        size = talla[2];
      }
      return JSON.stringify({
        action: "check_stock",
        query,
        ...(size ? { size } : {}),
        reply: "Déjame revisar.",
      });
    }
  }

  /**
   * 015 (FR-025) — Agenda, SOLO si el system prompt nombra la acción (misma
   * razón que check_stock: con la bandera apagada el esquema no la conoce).
   *
   * El mock reserva ÚNICAMENTE copiando el startUtc del bloque HORARIOS
   * OFRECIDOS del prompt. Es lo que haría un modelo real —no puede copiar un
   * ISO que no le enseñaron— y es lo que vuelve honesto al arnés: si ese
   * contexto deja de viajar, el mock re-ofrece en bucle igual que hizo el LLM
   * real en LanCo, y el check de la cita se pone rojo.
   */
  if (system.includes("offer_slots")) {
    /*
     * Una hora CONCRETA ("a las 11", "a las 11am"): se busca en el bloque de
     * ofrecidos y se reserva esa. Modela lo que pasó en vivo en LanCo el
     * 2026-09-23 — el cliente no elige del menú, pide su hora— y por eso este
     * mock se pone rojo si el catálogo vuelve a registrar solo tres por día:
     * la hora pedida no estaría en el prompt y no habría ISO que copiar.
     */
    /*
     * Mover vs reservar (ajuste 2026-09-25): si el cliente pide CAMBIAR la
     * cita, la acción es `move_slot`. Se distingue por el verbo, como haría un
     * modelo real; el mock no adivina si ya hay cita — de eso se encarga el
     * motor, que responde «no hay cita que mover» si no la hay.
     */
    const yaTieneCita = system.includes("CITA ACTUAL DE ESTE CLIENTE");
    const quiereMover =
      system.includes("move_slot") &&
      // Si YA tiene cita, pedir otra hora es moverla: reservar otra le dejaría
      // dos. El verbo sirve cuando el prompt no trae ese hecho.
      (yaTieneCita ||
        // Conjugaciones enteras (`camb\w*`): con `\bcambia\b` no entraba
        // «¿me la cambias?», que es como se dice de verdad.
        /\b(camb\w*|mov\w*|muev\w*|reprogram\w*|recorr\w*)\b/i.test(lastUser));

    const hora = lastUser.match(/\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|hrs?)?/i);
    if (hora?.[1]) {
      let h = Number(hora[1]);
      if (/pm/i.test(hora[3] ?? "") && h < 12) h += 12;
      const hhmm = `${String(h).padStart(2, "0")}:${hora[2] ?? "00"}`;
      /*
       * La hora se busca SOLO en la etiqueta, nunca en la línea entera: el ISO
       * lleva la hora en UTC, así que «sáb 26 sep, 10:00 → …T16:00:00.000Z»
       * contiene "16:00" y se llevaba por delante la petición de las 16:00
       * (México es UTC-6). Salió en el arnés: pidió las 16:00 y movió las
       * 10:00.
       */
      const iso = system
        .split("\n")
        .map((l) => l.match(/^\s*\d+\.\s*(.+?)\s*→ startUtc "([^"]+)"/))
        .find((m) => m?.[1]?.includes(hhmm))?.[2];
      if (iso) {
        return JSON.stringify(
          quiereMover
            ? { action: "move_slot", startUtc: iso, reply: "¡Listo, la moví!" }
            : { action: "book_slot", startUtc: iso, reply: "¡Perfecto, queda agendado!" }
        );
      }
      // No está en el catálogo: se re-ofrece SIN afirmar que no hay hueco.
      return JSON.stringify({
        action: "offer_slots",
        reply: "Déjame confirmarte los horarios que tengo:",
      });
    }

    const eligio = /\b(el primero|primer horario|primera opci[oó]n|ese horario|ag[eé]nda(me|lo))\b/i.test(
      lastUser
    );
    const ofrecido = system.match(/^1\. .+ → startUtc "([^"]+)"/m)?.[1];
    if (eligio && ofrecido) {
      return JSON.stringify({
        action: "book_slot",
        startUtc: ofrecido,
        reply: "¡Perfecto, queda agendado!",
      });
    }
    if (/\b(agendar|cita|horarios?)\b/i.test(lastUser) || /\b(tarde|temprano)\b/i.test(lastUser)) {
      /*
       * La franja solo viaja si el cliente habló de la PARTE del día. «mañana»
       * a secas se deja fuera a propósito: en español es también el día
       * siguiente, y mandarla como franja filtraría el menú por error.
       */
      const franja = /\bpor la tarde|de la tarde|\btarde\b/i.test(lastUser)
        ? "tarde"
        : /\bpor la ma[ñn]ana|de la ma[ñn]ana|\btemprano\b/i.test(lastUser)
          ? "mañana"
          : undefined;
      return JSON.stringify({
        action: "offer_slots",
        reply: "Claro, tengo estos horarios:",
        ...(franja ? { franja } : {}),
      });
    }
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
