import { describe, expect, it } from "vitest";
import { PERSONAS } from "@/server/lab/personas";
import { matchesHandoffIntent } from "@/server/ai/handoff";

/**
 * 021 — Los seis clientes simulados del producto son AGNÓSTICOS DEL GIRO
 * (FR-601, FR-602, FR-604).
 *
 * Por qué existe este archivo: hasta la 021, los seis guiones eran una
 * ferretería —taladros, martillos, tíner— porque el Laboratorio se construyó
 * contra el negocio de demostración y nunca se re-apuntó al inquilino. Una
 * instancia que no vende herramienta tenía su agente evaluado con preguntas de
 * tlapalería, y el score no medía nada suyo.
 *
 * El test no comprueba que los guiones sean BUENOS —eso es juicio, y se mira
 * en una corrida real—: comprueba que no vuelvan a nombrar un giro.
 */

/** Todos los mensajes de los seis, en una sola cadena para buscar. */
const TODO_EL_TEXTO = PERSONAS.flatMap((p) => p.script)
  .join("\n")
  .toLowerCase();

/**
 * Sustantivos de un giro concreto. DELIBERADAMENTE TONTA, igual que la lista
 * de comienzos dependientes del contexto: detectar de verdad si una línea
 * presupone un sector exigiría entender la línea, es decir otro modelo con su
 * propia falibilidad. Esta lista atrapa lo evidente y no promete más.
 *
 * La primera mitad es la regresión que de verdad ocurrió (ferretería). La
 * segunda son otros giros, para que "hagamos que sean de un restaurante" se
 * caiga igual de rápido.
 *
 * Lo que de verdad sostiene FR-601 es que alguien LEE los seis guiones antes
 * de darlos por buenos. Esto solo evita el descuido.
 */
const TERMINOS_DE_GIRO = [
  // La ferretería que esta feature retiró.
  "taladro", "martillo", "desarmador", "clavo", "lijadora", "pintura",
  "tiner", "thinner", "barniz", "broca", "cemento", "herramienta",
  "tornillo", "pinza", "ferreter", "tlapaler",
  // Otros giros, por si el péndulo se va al otro lado.
  "pizza", "hamburguesa", "platillo", "restaurante", "menú",
  "corte de pelo", "manicure", "masaje",
  "consulta médica", "receta", "medicamento",
  "habitación", "hotel", "vuelo",
];

describe("021 — los seis clientes simulados no tienen giro", () => {
  it("ningún guion nombra un producto o sector concreto (FR-601)", () => {
    const encontrados = TERMINOS_DE_GIRO.filter((t) =>
      TODO_EL_TEXTO.includes(t)
    );
    expect(
      encontrados,
      `Los guiones de PERSONAS nombran un giro concreto: ${encontrados.join(", ")}. ` +
        `Los seis del producto se corren en TODAS las instancias, así que tienen ` +
        `que servir a cualquier negocio. Lo específico del negocio son los ` +
        `escenarios generados desde su conocimiento (Entrega 3), no estos.`
    ).toEqual([]);
  });

  /**
   * Las claves NO son cosmética: `agent_test_case.persona` las guarda, así que
   * cambiarlas hace ilegible el histórico de cualquier instancia que ya haya
   * corrido el Laboratorio. Se reescribe el texto, nunca la clave.
   */
  it("las seis claves siguen siendo las de siempre (D1)", () => {
    expect(PERSONAS.map((p) => p.key)).toEqual([
      "comprador_decidido",
      "pregunton_precios",
      "cliente_enojado",
      "fuera_de_kb",
      "pide_humano",
      "errores_modismos",
    ]);
  });

  /**
   * FR-604. El guion y el regex viven en archivos distintos y nada los ata:
   * sin este test, reescribir `pide_humano` puede dejar de disparar el
   * respaldo de escalado sin que nada se ponga rojo.
   */
  it("pide_humano sigue disparando el respaldo de escalado (FR-604)", () => {
    const persona = PERSONAS.find((p) => p.key === "pide_humano");
    expect(persona).toBeDefined();
    const disparan = persona!.script.filter((l) => matchesHandoffIntent(l));
    expect(
      disparan.length,
      "Ninguna línea de pide_humano dispara HANDOFF_BACKUP_REGEX. " +
        "El respaldo de escalado dejó de cubrir a esa persona."
    ).toBeGreaterThan(0);
  });

  /** FR-602: los seis siguen midiendo seis cosas distintas. */
  it("cada persona declara qué mide", () => {
    for (const p of PERSONAS) {
      expect(p.description.trim().length, `${p.key} sin descripción`).toBeGreaterThan(0);
      expect(p.script.length, `${p.key} sin guion`).toBeGreaterThan(1);
    }
  });
});
