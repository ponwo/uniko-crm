# Guion E2E — 033: Conocimiento temporal (vigencia del conocimiento)

> Automatizado en `scripts/e2e-kb-vigencia.mjs` (encadenado al final de
> `pnpm test:e2e`). Contra la app viva con mocks: `WA_MOCK_ENABLED=true`,
> `META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock y
> `BOT_API_KEY`. Spec: [specs/033-conocimiento-temporal](../../specs/033-conocimiento-temporal/spec.md).
>
> El ai-mock contesta según el conocimiento que RECIBIÓ: si el mensaje del
> cliente trae un tema `KBTOK-…`, dice `SI_CONOZCO` solo si ese tema está en la
> sección del conocimiento de su prompt, y `NO_CONOZCO …` si no.

## Preparación

1. Conexión WhatsApp (wa-mock) y agente encendido. El «hoy» lo da el servidor
   (`GET /api/kb` → `hoy`, en la zona del negocio) y todas las fechas se
   calculan desde él.

## Camino feliz

2. **Alta (FR-1801, FR-1802)**: sin fecha → permanente (`vigente`); a 60 días →
   `vigente`; a 5 días → `por_vencer`; **hoy** → `por_vencer` (vale todo el día).
3. **Archivar a propósito**: fecha de ayer → se acepta y nace `vencida`.
4. **Contador (FR-1835)**: crear entradas vencidas no cambia `/api/kb/size`.
5. **Cerebro externo (FR-1811)**: `/api/bot/profile` trae lo vigente, no lo
   vencido, y no lleva la fecha.
6. **Agente (FR-1810, FR-1812)**: pregunta por lo vencido → `NO_CONOZCO` (no lo
   afirma; camino de «lo confirmo»); por lo vigente → `SI_CONOZCO`; por lo que
   vence hoy → `SI_CONOZCO`.
7. **Reloj (FR-1820, FR-1822)**: el prompt lleva `AHORA ES: …` y la regla del
   historial, y la sección del conocimiento no trae lo vencido.
8. **Renovar (FR-1831)**: `PATCH` con fecha futura → `vigente` sin tocar el texto,
   y el siguiente turno `SI_CONOZCO`; con `null` → permanente.
9. **Editar (FR-1832)**: `PATCH` solo del texto conserva la fecha.
10. **Corte por turno (FR-1813)**: vencer a mano una entrada que el agente ya
    usó en ESTA conversación → el siguiente turno `NO_CONOZCO`.
11. **Laboratorio (FR-1840, FR-1841)**: generar escenarios y correr una corrida:
    el prompt del generador y el del juez traen lo permanente y no lo vencido.
12. **Pantalla (FR-1830, FR-1833, US3)** en `/agent`: aviso de cuántas vencen
    pronto; la que vence pronto, con su marca, sigue en la lista; sección
    «Conocimiento obsoleto» con lo vencido y «Ya venció»; «Hacer permanente» la
    devuelve; «Poner fecha» con una fecha pasada la manda a obsoletos; editar el
    texto conserva la fecha; el alta con fecha la guarda.

## Caminos infelices

13. **Fecha basura (FR-1836)**: `"el martes"` → `422` con «AAAA-MM-DD»;
    `"2026-02-31"` → `422` con «no existe» (nunca `500`); en `PATCH`,
    `"2026-13-01"` → `422`.
14. **Todo vencido**: el agente queda como sin conocimiento (no inventa); el
    generador responde `kb_vencida` («renueva la fecha»), no `kb_vacia`
    (unitario: `tests/unit/lab-generar-vigencia.test.ts`).
15. **Borde del día en México**: «hasta el 7» vale a las 18:30 del 7 (00:30 UTC
    del 8) y deja de valer a medianoche de México (unitario:
    `tests/unit/kb-vigencia.test.ts`).

## Limpieza

16. El arnés borra sus entradas (tokens con el sufijo de la corrida) y vuelve a
    apagar el agente si estaba apagado. Usa un lead propio por corrida, así que
    se puede repetir sobre la misma base.
