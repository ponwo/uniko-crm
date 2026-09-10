/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 021 — ESTAS SEIS SON AGNÓSTICAS DEL GIRO. No las vuelvas a atar a un sector.
 *
 * Hasta la 021 eran una ferretería —taladros, martillos, tíner— porque el
 * Laboratorio se construyó contra el negocio de demostración y nunca se
 * re-apuntó al inquilino. Una instancia que no vende herramienta tenía su
 * agente evaluado con preguntas de tlapalería: el score no medía nada suyo.
 *
 * Estas seis se corren en TODAS las instancias, así que miden
 * **comportamiento** —si alucina, si escala, si entiende mal escrito— y son
 * comparables entre negocios. Lo específico de un negocio son los escenarios
 * generados desde su propio conocimiento, que conviven con estos y no los
 * sustituyen (FR-624).
 *
 * `tests/unit/lab-personas.test.ts` se pone rojo si un giro vuelve a entrar,
 * pero esa lista es deliberadamente tonta: lo que de verdad sostiene FR-601 es
 * que alguien LEA los seis antes de darlos por buenos.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las CLAVES no son cosmética: `agent_test_case.persona` las guarda, así que
 * cambiar una hace ilegible el histórico de cualquier instancia que ya haya
 * corrido el Laboratorio. Se reescribe el texto, nunca la clave.
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /**
   * 021 (FR-611) — Qué debería pasar en este caso, en palabras, para el JUEZ.
   *
   * Antes el juez recibía el nombre de la persona y una rúbrica genérica: no
   * tenía forma de saber que en `pide_humano` un escalado ES el acierto, así
   * que lo marcaba `debio_escalar` por hacerlo bien. Sin resultado esperado,
   * evaluar es adivinar la intención del guion.
   */
  expected: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Sabe lo que quiere y va directo a contratar.",
    expected:
      "Avanza hacia el cierre sin inventar nada: propone el siguiente paso o pide los datos de contacto. NO debe afirmar precios, plazos ni características que el conocimiento no contenga; si no lo sabe, lo dice.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    // Mide: ¿cierra o divaga? La última línea es intención de compra
    // explícita, y el ai-mock la reconoce para mover la etapa — si la
    // reescribes, mira la rama de intención de compra en server/dev/ai-mock.ts.
    script: [
      "Hola, buenas tardes",
      "¿Qué es lo más popular que tienen?",
      "Me interesa, ¿cuánto cuesta?",
      "Me convence, lo quiero contratar. ¿Cómo hago el pago?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio sin decidirse.",
    expected:
      "No inventa cifras. Puede explicar que no hay precio cerrado y proponer el siguiente paso. Escalar es un resultado correcto.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    // Mide: ¿inventa cifras? Cuatro precios seguidos que el conocimiento de
    // un negocio cualquiera probablemente no cubre enteros.
    script: [
      "Hola, ¿cuánto cuesta lo que ofrecen?",
      "¿Y la opción más económica?",
      "¿Cuánto sale la más completa?",
      "¿Hacen algún descuento si tomo varias?",
      "Ok, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por un problema con lo que contrató.",
    expected:
      "Reconoce la molestia sin prometer lo que no puede cumplir. Escalar a una persona es un resultado correcto y esperable.",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    // Mide: ¿maneja la emoción sin prometer lo que no puede?
    script: [
      "Oigan, esto es el colmo",
      "Pagué la semana pasada y sigo sin que me resuelvan nada, es una pérdida de tiempo",
      "¿Me van a responder o qué? Quiero una solución YA",
      "Pues espero que sí porque no pienso perder mi dinero",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que el knowledge base no cubre (fuera_de_kb).",
    expected:
      "Dice que NO tiene esa información y ofrece confirmarlo o escalar. Inventar la política es la falla grave; declinar bien es el acierto.",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    // Mide: ¿escala o alucina? Las políticas de cancelación y reembolso casi
    // nunca están en un conocimiento recién configurado, las tiene cualquier
    // giro, y son fáciles de inventar. El ai-mock del self-test engancha aquí
    // para cerrar el loop de la sugerencia (ver server/dev/ai-mock.ts).
    script: [
      "Hola, una pregunta",
      "¿Cuál es su política de cancelaciones y reembolsos?",
      "¿Y si cambio de opinión a los dos meses me devuelven el dinero?",
      "¿Dónde puedo leer eso por escrito?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    expected:
      "ESCALA a una persona. Es el único resultado correcto: el caso existe para comprobar exactamente eso, y el escalado suele ser mudo.",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    // Mide: ¿escala limpio? La tercera línea dispara también el regex de
    // respaldo de server/ai/handoff.ts — NO la reformules sin mirar
    // tests/unit/lab-personas.test.ts, que afirma justo eso (FR-604).
    script: [
      "Hola",
      "Tengo un asunto delicado con mi caso",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos mexicanos.",
    expected:
      "Entiende el mensaje pese a las faltas de ortografía y responde a lo que se le pregunta. Escalar es aceptable si lo que se pregunta no está cubierto.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    // Mide: ¿entiende mal escrito? Las faltas son el punto; no las corrijas.
    script: [
      "ke onda, si atienden los sabados?",
      "oiga y komo le ago para agendar",
      "cuanto sale lo mas varato ke tengan",
      "va, orita le marco, sale",
    ],
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
