# Guion E2E — US6: Plantillas

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock.

## Ciclo de aprobación

1. En `/settings/templates`: crear `seguimiento_cotizacion` (es_MX, UTILITY,
   cuerpo con `{{1}}`).
   ✅ Queda en estado "Pendiente de Meta" (el mock devuelve PENDING).
2. Simular la aprobación: `POST /api/dev/wa-mock/template-status`
   `{ wabaId, name, language, event: "APPROVED" }`.
   ✅ El estado pasa a "Aprobada" (evento webhook enrutado por entry.id).
3. Camino infeliz: crear `promo_rechazada` y simular `REJECTED` con razón.
   ✅ Estado "Rechazada" mostrando la razón.
4. `POST /api/templates/sync` → 200 (pull por Graph; cubre modo agencia).

## Modo agencia: aprobación que NUNCA llega por webhook

> Automatizado en `scripts/e2e-templates-sync.mjs` (13 checks) + comprobación
> de UI con Playwright. Reproduce un fallo visto en producción.

`message_template_status_update` se entrega al callback **a nivel app**, que en
modo agencia no es el de esta instancia: sin pull, la plantilla se queda
"Pendiente de Meta" para siempre aunque Meta ya la haya aprobado.

8. Crear plantilla (UTILITY) y mover el panel simulado de Meta con
   `POST /api/dev/wa-mock/template-status` `{ event: "APPROVED",
   category: "MARKETING", notify: false }` — `notify:false` NO entrega webhook.
   ✅ El CRM sigue en "Pendiente de Meta" (el bug reproducido).
9. `POST /api/templates/sync`.
   ✅ `updated: 1`, estado "Aprobada" y categoría **MARKETING** (Meta es la
   autoridad de la categoría: reclasifica al aprobar y eso cambia el costo).
   ✅ Un segundo sync devuelve `updated: 0` (idempotente).
10. Abrir `/settings/templates` con la plantilla en pending y Meta ya aprobada.
    ✅ El badge muestra "Aprobada" **sin tocar Sincronizar** (auto-sync al
    montar); si el pull falla, la lista local se pinta igual y el error se
    calla (solo el botón manual reporta errores).

## Envío con ventana cerrada

5. Abrir una conversación con ventana cerrada en la bandeja.
   ✅ El composer bloqueado ahora lista la plantilla aprobada.
6. Elegirla, llenar la variable y enviar.
   ✅ El mensaje aparece en el hilo (tipo plantilla, cuerpo renderizado).
   ✅ El outbox del wa-mock registra `type: "template"` con `components`
   (`parameters[0].text` = valor de la variable).
7. Validaciones: enviar plantilla no aprobada → 422; variable faltante → 422.

## Varias variables por cuerpo (2026-08-09)

> Automatizado en `scripts/e2e-templates-multivar.mjs` (21 checks) + UI con
> Playwright. Antes el CRM rechazaba en su propia pantalla lo que Meta sí
> acepta: "v1 admite una sola variable {{1}} en el cuerpo".

11. En `/settings/templates`, cuerpo con `{{1}}`, `{{2}}` y `{{3}}`.
    ✅ Sin aviso rojo, el botón habilitado y la pantalla anuncia "3 variables".
    ✅ A Meta va **un `example.body_text` por variable** (sin eso responde 100).
12. Cuerpo con salto (`{{1}}` y `{{3}}`).
    ✅ Aviso "…sin saltos (falta {{2}})", botón deshabilitado y, si se fuerza
    por API, 422 — la numeración posicional contigua es requisito de Meta.
13. Con la plantilla aprobada y la ventana cerrada, el envío pide **un campo por
    variable** (`Valor de {{1}}`…`{{3}}`).
    ✅ El outbox del wa-mock trae los 3 `parameters` en orden y el hilo muestra
    el texto ya sustituido.
    ✅ Faltando un valor → 422 diciendo cuál falta; el wa-mock además replica el
    132000 de Meta si el número de parámetros no cuadra.
14. Compatibilidad: el payload viejo `{ templateId, variable }` (una variable)
    sigue enviando — lo usa el cron de recordatorios de sesión.

## 027 — Meta es la autoridad: espejo en tres direcciones y errores con causa (2026-09-15)

> Automatizado en `scripts/e2e-templates-sync.mjs` (80 checks, incluye los 13
> del modo agencia) — entra en `pnpm test:e2e`. Spec:
> [`specs/027-plantillas-espejo-de-meta/spec.md`](../../specs/027-plantillas-espejo-de-meta/spec.md).
> Reproduce lo reportado el 2026-09-14: crear "marcaba error" sin causa y las
> plantillas creadas en el Administrador de WhatsApp nunca aparecían.

15. **Ya tenía plantillas.** Sembrar en el mock (`POST /api/dev/wa-mock/seed-templates`)
    tres plantillas sin pasar por el CRM: una APPROVED de solo cuerpo, una
    PAUSED y una APPROVED con encabezado IMAGE. `POST /api/templates/sync`.
    ✅ `imported: 3`. La de solo cuerpo es enviable y se envía (200). La pausada
    entra `pending` con `metaStatus: PAUSED` y no se ofrece. La de encabezado
    conserva sus `components`; enviarla responde 422 diciendo que el encabezado
    es una imagen que el CRM no adjunta y que la salida es el Administrador de
    WhatsApp o una versión solo de texto.
16. **Paginación.** 30 plantillas en Meta ⇒ las 30 aprobadas y enviables tras el
    sync, no 25.
17. **Desaparece de Meta.** Vaciar el panel simulado y sincronizar.
    ✅ `missing ≥ 30`; la fila sigue, con `missingSince`, deja de ser enviable
    (422 "ya no existe en tu cuenta de Meta") y, si reaparece, la marca se limpia.
18. **Crear con la variable al final / al inicio / dos pegadas.**
    ✅ La pantalla lo avisa en rojo y deshabilita el botón; por API, 422 con la
    regla (`TERMINE`, `EMPIECE`, `pegadas`).
19. **`{{ 1 }}` con espacios.** ✅ Se acepta, se guarda como `{{1}}` y Meta recibe
    `{{1}}` con un ejemplo por variable.
20. **Rechazo síncrono de Meta** (el mock lo fuerza con `[meta-rechaza]` ⇒
    subcódigo 2388293). ✅ 422 con la frase traducida y `(Meta 100/2388293)`;
    sin fila local.
21. **Nombre que ya existe en Meta.** ✅ 409 `already_exists`; la plantilla queda
    importada tal como está allá y el mensaje lo dice.
22. **Estados que no son APPROVED.** Sembrar APPROVED, sincronizar, cambiar a
    PAUSED y sincronizar. ✅ `metaStatus: PAUSED`, `status` sigue `approved`, no
    enviable; el envío por API responde 422 diciendo "pausada" y qué hacer.
    Un estado inventado se guarda literal y bloquea. `IN_REVIEW` ⇒ `pending`.
23. **Webhook PAUSED** (`template-status` con `notify: true`). ✅ Bloquea en
    segundos sin esperar al sync. **Webhook REJECTED** con `reason`. ✅ Queda
    rechazada con su motivo, y el sync no lo borra.
24. **Meta caído** (WABA terminado en `-caido` ⇒ 503 del mock). ✅ El sync
    responde 503 `meta_unavailable`, crear responde 503 sin tocar la base, y la
    lista local sigue respondiendo; la pantalla dice que lo que ve es local.
25. **UI** (`/settings/templates`, Playwright/Browser). ✅ Resumen del sync
    («3 importada(s) de Meta · 1 actualizada(s)»), el error del sync visible
    aunque sea automático, insignias «Pausada por Meta» / «Ya no está en Meta»
    con su explicación, «Encabezado: imagen · Pie de página · 1 botón» en las
    importadas, y el aviso rojo en vivo al escribir un cuerpo que Meta
    rechazaría.
