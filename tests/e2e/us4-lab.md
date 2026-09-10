# Guion E2E — US4: Laboratorio (SIEMPRE contra ai-mock, determinista)

> **Automatizado desde la 021**: `node --env-file=.env scripts/e2e-lab.mjs`, y
> encadenado en `pnpm test:e2e`. Este documento sigue siendo la fuente de qué se
> comprueba y por qué; el arnés es quien lo ejecuta. Si añades un paso aquí,
> añádelo allí — un guion que solo vive en Markdown envejece hasta contradecir
> al producto.
>
> La app tiene que correr en **modo desarrollo** (`pnpm dev`). Con `next start`
> los mocks devuelven 404 **por diseño** —`isMockEnabled()` exige
> `NODE_ENV !== "production"`, y esa es la "instancia pública endurecida" de la
> constitución—, así que el juez falla con `provider_error` y el score sale
> `null`. No es un fallo del Laboratorio: es la guarda haciendo su trabajo.

> El KB inicial NO cubre cancelaciones/reembolsos (hueco intencional del guion).
> **Hasta la 021 el hueco era "garantías y devoluciones"**, calcado del negocio
> de demostración —una ferretería— cuyo conocimiento omitía justo eso. Retirada
> la ferretería de los seis guiones, el tema pasa a cancelaciones y reembolsos:
> lo tiene cualquier giro y ninguno lo monopoliza.

## Preparación

1. El conocimiento de la organización **no** menciona cancelaciones ni
   reembolsos. El arnés retira esas entradas si una corrida anterior las dejó,
   y siembra un conocimiento mínimo (horario) si la base está vacía.
2. Agente configurado (US3) y proveedor de IA (mock) activo.
3. Se **cuenta** el outbox del wa-mock en vez de vaciarlo: el `DELETE` reinicia
   todo el estado del mock, y encadenado tras otros arneses eso les borra el
   suyo.

## Corrida 1

4. En `/lab`: pulsar "Correr evaluación".
   ✅ La UI muestra el subtítulo permanente "Sandbox interno — no envía
   mensajes reales", progreso en vivo (n/6) sin bloquear la navegación.
5. Al terminar:
   ✅ Reporte con score global (5 verdes + 1 rojo = 83), tarjeta de la persona
   "Pregunta fuera del conocimiento" con hallazgo `fuera_de_kb`, evidencia y
   sugerencia; transcript visible por persona.
   ✅ **Ningún cliente simulado nombró un producto o sector concreto** (FR-601).
   Se mira el transcript de lo que de verdad se dijo, no la constante del
   módulo — eso ya lo afirma `tests/unit/lab-personas.test.ts`.
   ✅ La persona "Pide un humano" terminó en handoff (guion cortado: 4 líneas
   escritas, se dijeron menos).
   ✅ El outbox del wa-mock **no creció** (ningún mensaje salió a WhatsApp).
   ✅ Las conversaciones de prueba NO aparecen en la bandeja.

## Cerrar el loop

6. En el hallazgo: "Agregar al conocimiento" → editar/confirmar → guardado en
   el KB (visible en `/agent`).
7. Re-correr la evaluación.
   ✅ El historial muestra la nueva corrida con score 100 y delta +17.
   ✅ El outbox sigue intacto tras las dos corridas.

## Caminos infelices

8. Con una corrida en curso, `POST /api/lab/runs` → 409 `run_in_progress`.
9. Corridas huérfanas: cubierto por `src/instrumentation.ts` al boot
   (verificación en el checkpoint de compose, donde el server se reinicia).

## Lo que este guion NO prueba

Que un guion neutro **le sirva a un negocio real**. Eso es juicio: solo se sabe
mirando una corrida de una instancia con su conocimiento cargado, y queda
marcado como pendiente de verificación humana (Principio V). Es exactamente lo
que la Entrega 3 de la 021 —escenarios generados desde el conocimiento del
propio negocio— existe para dejar de necesitar.
