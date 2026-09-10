# Implementation Plan: 021 — El Laboratorio sigue al negocio

**Spec**: [spec.md](spec.md) · **Investigación**: [research.md](research.md)

**Rama**: `021-laboratorio-del-negocio`, desde `main` (`f13fd19`)

---

## Summary

Tres entregas independientes, en orden de riesgo creciente:

| | Qué | `drizzle/` | Ensayo X |
|---|---|---|---|
| **1** | Los seis genéricos dejan de ser una ferretería, y el Laboratorio entra en el arnés automático | no | no |
| **2** | El juez deja de castigar al agente por declinar correctamente | no | no |
| **3** | El negocio genera sus escenarios desde su conocimiento | **sí** | **sí** |

Este plan detalla la **Entrega 1** al nivel de tarea; las otras dos quedan
diseñadas a nivel de decisión y se detallan cuando les toque. Se hace así a
propósito: la 2 depende de mirar veredictos reales del juez con los guiones ya
neutros, y la 3 depende de la 2.

---

## Technical Context

**Lenguaje**: TypeScript estricto · **Runtime**: Node 22 · **Framework**:
Next 15 App Router · **Datos**: PostgreSQL + Drizzle · **LLM**: adaptador
OpenRouter-compatible (`chatJson<T>`) · **Pruebas**: Vitest (unidad) +
Playwright conducido por `scripts/e2e-*.mjs`.

**Lo que ya existe y no se toca en la Entrega 1**: el runner
(`src/server/lab/runner.ts`), el juez (`src/server/lab/judge.ts`), el pipeline
del agente, el esquema, y el lock de concurrencia por índice parcial UNIQUE.

**Dependencia externa nueva**: ninguna. La Entrega 3 usa el adaptador LLM que
ya existe.

---

## Constitution Check

Evaluado antes de la Fase 0 y sin cambios tras el diseño.

| Principio | Cómo queda |
|---|---|
| **I** Seguridad | Entrega 1 no toca credenciales ni datos de cliente. La comprobación de teléfono de la Entrega 3 (FR-628) existe para proteger contactos reales. |
| **II** Soberanía | Sin terceros nuevos. La generación usa `chatJson`; sin token, degrada a los seis (FR-629). |
| **III** Multi-tenancy | Entrega 1 no toca consultas. La tabla de la Entrega 3 lleva `organization_id` NOT NULL y pasa por `scoped()`. |
| **IV** Idempotencia | Sin eventos externos nuevos. |
| **V + IX** Calidad | La Entrega 1 **mete el Laboratorio en el arnés automático**, que hoy no lo cubre. Ver D3. |
| **VI** Specs antes de código | Carril declarado en el spec, antes de escribir. |
| **X** Irreversibilidad | Entregas 1 y 2 no tocan `drizzle/`. La 3 sí: migración aditiva pura, ensayo obligatorio. |

**Sin violaciones que registrar.** No hay Complexity Tracking.

---

## Diseño

### D1. Los seis se reescriben, no se re-arquitecturan

`PERSONAS` sigue siendo una constante de módulo en
`src/server/lab/personas.ts`, con `script: string[]` de líneas fijas. **El
determinismo del cliente simulado no se toca**: sigue sin usar LLM, y las
claves (`comprador_decidido`, `pregunton_precios`, …) **no cambian**.

Que las claves sobrevivan no es pereza: `agent_test_case.persona` las guarda, y
cambiarlas haría ilegible el histórico de cualquier instancia que ya haya
corrido el Laboratorio. Lo que cambia es el **texto** de los guiones.

Los de kosmo son el punto de partida —ya son agnósticos de giro y llevan
escrito qué mide cada uno—, adaptados a que aquí `pide_humano` tiene que
conservar la frase que dispara `matchesHandoffIntent()` (FR-604).

### D2. El `ai-mock` cambia de gancho, no de forma

Hoy el mock del juez despacha así: si el prompt menciona `fuera_de_kb` **y** el
conocimiento configurado no dice nada de `garant|devoluc` → `rojo` con
sugerencia; en cualquier otro caso → `verde`.

Esa pareja es el fixture de la ferretería: el KB demo omitía garantías
justamente para que el Laboratorio encontrara algo.

Se conserva **la mecánica** —es lo que hace determinista el loop del self-test:
corres, sale rojo con sugerencia, la aplicas, vuelves a correr y sube— y se
cambia **el tema** a *cancelaciones y reembolsos*, que cualquier negocio tiene
y ningún giro monopoliza.

**La aritmética no se mueve**: 5 verdes + 1 rojo sobre 6 = 83; tras aplicar la
sugerencia, 6/6 = 100, delta +17. El guion `us4-lab.md` sigue siendo válido en
sus números y solo cambia en el tema.

### D3. El Laboratorio entra en el arnés — y por qué toca ahora

La [investigación](research.md) lo dejó anotado como hallazgo 5: **el
Laboratorio no está en el arnés automático**. Su guion `us4-lab.md` es manual,
y lo único que lo ejercita solo es el escenario C del arnés de push, de refilón.

Esta entrega cambia exactamente lo que nadie cubre. Verificarlo a mano una vez
y seguir es cómo se acaba delegando la prueba —lo que la Definición de Hecho
prohíbe— así que el arnés entra aquí, no "más adelante".

`scripts/e2e-lab.mjs`, siguiendo el patrón de los diecinueve que ya existen y
reutilizando `contextoConSesion()` de `scripts/e2e-sesion.mjs` (un login por
tanda, no uno por guion). Comprueba, contra la app viva con mocks:

1. Ningún guion menciona un giro concreto — la regresión que esta entrega
   existe para impedir.
2. La corrida termina con score 83, con el hallazgo `fuera_de_kb` en la persona
   que toca.
3. `pide_humano` acabó en handoff, con el guion cortado.
4. **El outbox del wa-mock queda VACÍO**: el sandbox del Laboratorio aguanta.
   Es un guardarraíl constitucional, no un detalle.
5. Aplicada la sugerencia, la segunda corrida da 100 y delta +17.
6. Con una corrida en curso, `POST /api/lab/runs` → 409.

Entra en `pnpm test:e2e`, que hoy encadena cuatro guiones.

### D4. La rúbrica (Entrega 2) — decisión tomada, detalle aplazado

El cambio es de **prompt**, en `buildJudgePrompt` (`src/server/ai/prompts.ts`):
separar "declinó correctamente" de "contestó sin saber", y darle al juez un
**resultado esperado** por escenario (FR-612), que hoy no recibe.

Lo que hace falta antes de escribirlo es mirar veredictos reales del juez con
los guiones ya neutros. Escribir la rúbrica contra el fixture de ferretería
sería repetir el error que esta feature arregla.

**FR-613 —** que el cambio de rúbrica se vea en el histórico— se resuelve con
la misma pieza que la Entrega 3 necesita para otra cosa: el sello. Un cambio de
rúbrica no cambia el conjunto de escenarios, así que el sello no basta por sí
solo; hará falta versionar la rúbrica junto a él. **Se decide en la Entrega 2.**

### D5. La generación (Entrega 3) — forma, no detalle

- Tabla `lab_scenario` (org, clave, etiqueta, descripción, guion, teléfono,
  origen, posición, habilitado) + columna del sello en `agent_test_run`.
  Aditiva pura.
- El runner deja de leer solo `PERSONAS` y **concatena** los propios (FR-624).
- `PERSONA_LABELS` y `agent_test_case.persona` pasan a guardar una copia de lo
  que se corrió: si los escenarios se editan, una corrida vieja tiene que
  seguir siendo legible (FR-632).
- Generación con `chatJson` y **el modelo del agente** (spec, "Decisión: quién
  escribe las preguntas NO es el juez"), esquema Zod permisivo y validación
  elemento a elemento para que un escenario roto no tire los ocho.
- Rango de teléfonos reservado + comprobación bloqueante contra contactos
  reales (FR-628).

---

## Project Structure

```
src/server/lab/personas.ts      Entrega 1 — los seis, reescritos
src/server/dev/ai-mock.ts       Entrega 1 — el gancho del juez cambia de tema
src/server/ai/prompts.ts        Entrega 2 — buildJudgePrompt
scripts/e2e-lab.mjs             Entrega 1 — NUEVO, el arnés
tests/e2e/us4-lab.md            Entrega 1 — el guion, al día
package.json                    Entrega 1 — test:e2e encadena el nuevo
```

La Entrega 3 añade `src/server/lab/{escenarios,generar,conjunto}.ts`, su
migración y su superficie de API. Se detalla cuando le toque.

---

## Verificación

### Nivel 1 — Unidad

- Ningún guion de `PERSONAS` contiene términos de un giro concreto. El test
  falla si alguien vuelve a meter un producto en un guion — que es la
  regresión de esta entrega.
- `pide_humano` sigue disparando `matchesHandoffIntent()` (FR-604). Se afirma
  aquí porque el guion y el regex viven en archivos distintos y nada los ata.

### Nivel 2 — Local, contra la app viva con mocks

`node --env-file=.env scripts/e2e-lab.mjs`, con la app en `WA_MOCK_ENABLED=true`
y `OPENROUTER_BASE_URL` apuntando al ai-mock. Los seis checks de D3.

### Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

### Lo que NO se puede verificar automáticamente

Que un guion neutro **le sirva a un negocio real** es juicio: solo se sabe
mirando una corrida de NuriaAndrea o ILTU con su conocimiento cargado. Queda
marcado como pendiente de verificación humana (Principio V), y es exactamente
lo que la Entrega 3 existe para dejar de necesitar.

---

## Riesgos

**Un guion neutro mide menos que uno específico.** "¿Qué es lo más popular que
tienen?" es más flojo que una pregunta concreta del giro. Se acepta a
sabiendas: es el precio de que sirva para todos, y la Entrega 3 es la que
recupera la profundidad con escenarios del propio negocio. Los seis no
pretenden medir conocimiento — miden comportamiento.

**El `ai-mock` puede quedar acoplado al tema nuevo.** Cambiar "garantías" por
"cancelaciones" mueve el gancho, no lo quita. Mientras el mock tenga que ser
determinista, algún gancho hará falta; lo que la Entrega 3 exige es que deje de
depender de un **tema** y pase a depender de la **forma** del prompt.

---

## Fuera de alcance

Lo que el spec ya declaró fuera: borrar corridas, procedencia en `kb_entry`,
recoger conversaciones `is_test` huérfanas, que `pide_humano` llegue al modelo,
y vigencia del conocimiento.

Se añade uno propio de este plan: **el seed demo no se toca aquí.** Sus
transcripts de ferretería son datos de un negocio de demostración, coherentes
consigo mismos, y salen de producción por el cierre de la 022. Tocarlos en esta
entrega mezcla dos trabajos.
