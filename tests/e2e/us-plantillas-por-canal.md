# E2E 031 — Las plantillas son de WhatsApp

Guion de comportamiento (Constitución IX) de
[`specs/031-plantillas-solo-whatsapp/spec.md`](../../specs/031-plantillas-solo-whatsapp/spec.md).
La parte automatizada vive en `scripts/e2e-plantillas-por-canal.mjs`: conduce la
Bandeja en el navegador con conversaciones cuya ventana de 24 h ya cerró (el
entrante llega con su hora de hace días, como una reentrega tardía). Tolera los
canales apagados: entonces solo afirma que WhatsApp no cambió.

Entorno: app con `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock y, para
Instagram y Messenger, `ZERNIO_BASE_URL` → `/api/dev/zernio-mock` y
`CHANNELS=whatsapp,instagram,messenger`. Re-ejecutable sobre la misma base: cada
corrida usa nombres, hilos y valores propios.

## WhatsApp no cambia (FR-1606)

| Comportamiento | Check |
|---|---|
| Con la ventana cerrada, la conversación viaja con `templateRequired` | "ventana cerrada y plantilla obligatoria" |
| La Bandeja enseña el aviso y el selector, sin caja de texto | "aviso de ventana cerrada visible" + "sin caja de texto libre" + "con el selector de plantillas aprobadas" |
| La plantilla sale por WhatsApp y aparece en el hilo | "la plantilla sale por WhatsApp y aparece en el hilo" |
| El texto libre sigue rechazado | "el texto libre sigue en window_closed (409)" |
| Contactos le ofrece *Escribir primero* | "al contacto de WhatsApp se le ofrece" |

## Instagram y Messenger con la ventana cerrada (FR-1601 a FR-1604)

Se corre una vez por canal encendido.

| Comportamiento | Check |
|---|---|
| La conversación viaja SIN plantilla obligatoria | "ventana cerrada, pero SIN plantilla obligatoria" |
| La Bandeja enseña la caja de siempre, sin aviso ni selector | "la caja de texto está ahí" + "sin el aviso de plantilla" + "sin selector de plantillas" |
| El pie dice que sale como agente humano, y el porqué al pasar el cursor | "el pie dice que sale como agente humano" + "y el porqué (7 días)…" |
| Escribir y Ctrl+Enter: sale por Zernio a su hilo, con `HUMAN_AGENT`, y queda `sent` | "salió por Zernio a su hilo" + "con la etiqueta de agente humano" + "queda en el hilo como enviado" |
| Una plantilla a esa conversación se rechaza sin tocar WhatsApp | "plantilla a la conversación → 409 channel_without_templates" + "el outbox de WhatsApp no se movió" |
| *Escribir primero* a ese contacto se rechaza y no abre otra conversación | "«Escribir primero» a este contacto → 409…" + "y no le abrió otra conversación" |
| Contactos no le ofrece *Escribir primero* | "al de Instagram no" / "al de Messenger no" |
| En el teléfono (375 px) el pie cabe sin scroll horizontal | "la caja y el pie se ven en el teléfono" + "sin scroll horizontal" |

## Camino infeliz: más de 7 días (FR-1605)

El mock de Zernio rechaza con el error de Meta la respuesta de agente humano en
un hilo cuyo id lleva `vencida` (no sabe del último entrante).

| Comportamiento | Check |
|---|---|
| El compositor dice la causa en español y conserva el texto de la plataforma | "el compositor dice la causa en español (más de 7 días)" + "y conserva el texto de la plataforma…" |
| El texto vuelve al campo y nada sale ni queda como burbuja fantasma | "el texto vuelve al campo…" + "nada salió por Zernio" + "y no quedó una burbuja fantasma…" |
| La página sigue viva | "la página sigue viva (se puede seguir escribiendo)" |
