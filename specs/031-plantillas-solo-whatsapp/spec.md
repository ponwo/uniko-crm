# 031 — Las plantillas son de WhatsApp: fuera de él, la ventana cerrada no bloquea

**Feature Branch**: `031-plantillas-solo-whatsapp`

**Created**: 2026-10-02

**Status**: Implementada y verificada en local (2026-10-02); falta en vivo en uniko-lanco

**Carril**: **ligero** (`spec.md` únicamente). No toca el modelo de datos —sin
migración: el canal ya vive en `contact.channel` y `conversation.channel` desde la
014— ni un contrato publicado: `ConversationDto` y el contacto de `/api/contacts` son
DTOs de la propia app, y `/api/bot/*`, el webhook y el SSE no cambian. El Constitution
Check vive aquí abajo, como exige el Principio VI para este carril.

**Banda de requisitos**: FR-16xx, derivada del número de feature —`(31−15)×100`—.

---

## El problema, en una frase

**Con la ventana de 24 h cerrada, la Bandeja le pide al operador una plantilla
aprobada también en Instagram y Messenger, donde las plantillas no existen y la
respuesta sí está permitida.**

---

## Problema

Pedido del dueño (2026-10-02): *«la restricción de plantillas solo es cuando la
conversación está por el canal de WhatsApp, no debería ser restricción en Messenger,
Instagram o algún otro canal que no sea WhatsApp»*.

La regla de la plantilla es de WhatsApp: fuera de las 24 h siguientes al último
mensaje del cliente, Meta solo acepta una plantilla aprobada. Instagram y Messenger no
tienen plantillas; fuera de esa ventana aceptan la respuesta del operador marcada como
de **agente humano** (`HUMAN_AGENT`), hasta 7 días después del último mensaje.

El servidor ya lo sabe. La 014 declaró las capacidades por canal
(`server/channels/capabilities.ts`: `outsideWindow: "template"` solo en WhatsApp,
`"human_agent_tag"` en Instagram y Messenger) y `prepareSend` solo exige la plantilla
donde se declara. Su FR-106 lo dice: *«Instagram no tiene plantillas, y fuera de la
ventana de 24 h usa la etiqueta `HUMAN_AGENT`»*.

La interfaz no lo sabe:

- **Bandeja** — el compositor mira solo `windowOpen`. Con la ventana cerrada esconde
  la caja de texto, dice *«WhatsApp solo permite texto libre…»* y ofrece el selector
  de plantillas, sea cual sea el canal. En una conversación de Instagram de ayer el
  operador no puede contestar, aunque el servidor sí lo enviaría.
- **Envío de plantilla** — `sendTemplate` no mira el canal: en una conversación de
  Instagram intenta una plantilla de WhatsApp. Hoy falla con *«El contacto no tiene
  teléfono ni identidad de WhatsApp utilizable»*, que no explica nada; y no sale por
  WhatsApp solo porque ningún camino le pone teléfono a un contacto de Instagram,
  no porque la ruta lo impida.
- **Contactos** — *Escribir primero (con plantilla)* se ofrece a todo contacto: a uno
  de Instagram le lista plantillas de WhatsApp y el envío termina en el mismo error.
  Y la ruta no mira el canal: si ese contacto no tuviera conversación,
  `getOrCreateConversation` le abriría una de WhatsApp.

---

## Comportamiento

La decisión es **del canal de la conversación**, y la toma el servidor con las
capacidades declaradas. Solo un canal que declara la plantilla como salida fuera de
ventana —hoy, solo WhatsApp— la exige.

| | Ventana abierta | Ventana cerrada |
|---|---|---|
| **WhatsApp** | Texto libre, adjuntos, ubicación, contacto | Solo plantilla aprobada (como hoy) |
| **Instagram, Messenger** y cualquier canal sin plantillas | Texto libre | **Texto libre** — sale como respuesta de agente humano |

- **Bandeja, fuera de WhatsApp con la ventana cerrada**: la caja de texto de siempre.
  Donde el pie dice *«Ventana abierta · quedan 3 h»*, dice *«Fuera de la ventana de
  24 h · sale como respuesta de agente humano»*, con el porqué completo al pasar el
  cursor (el límite de 7 días de Meta).
- **Si la plataforma rechaza la respuesta** (pasaron más de 7 días): el error se
  muestra bajo la caja, en español y diciendo la causa, y el texto vuelve al campo.
  Nada se cuelga ni se pierde.
- **Plantillas fuera de WhatsApp**: el envío se rechaza con un mensaje claro y sin
  tocar WhatsApp. *Escribir primero (con plantilla)* no se ofrece a contactos de
  Instagram ni Messenger: a ellos se les responde desde la Bandeja cuando escriben.
- **WhatsApp no cambia**: con la ventana cerrada, aviso + selector de plantillas.

---

## Requisitos

- **FR-1601** La conversación MUST viajar a la interfaz con `templateRequired`:
  verdadero solo si su canal declara la plantilla como salida fuera de ventana **y**
  la ventana está cerrada. MUST calcularse con la misma regla que usa `prepareSend`
  para rechazar el texto libre (`window_closed`): una sola función, no dos copias.
- **FR-1602** El compositor MUST esconder la caja de texto y ofrecer plantillas solo
  si `templateRequired`. Con la ventana cerrada en un canal sin plantillas MUST
  mostrar la caja normal (texto, pegar y soltar archivos) y el pie MUST decir que la
  respuesta sale como de agente humano.
- **FR-1603** El envío de una plantilla a una conversación de un canal sin plantillas
  MUST rechazarse antes de tocar WhatsApp (ni Graph ni credenciales), con un error
  tipado (409) que diga que las plantillas son de WhatsApp y que se responde con
  texto. La aserción del sandbox del Laboratorio MUST seguir antes.
- **FR-1604** *Escribir primero* (`POST /api/contacts/{id}/start-conversation`) MUST
  rechazar un contacto de un canal sin plantillas (409) antes de crear o tocar ninguna
  conversación. La pantalla de Contactos MUST NOT ofrecer el botón a esos contactos;
  para eso el contacto viaja con `canWriteFirst`, calculado en el servidor con las
  capacidades del canal: la pantalla no sabe reglas de canal (ADR-001).
- **FR-1605** Si Instagram o Messenger rechazan una respuesta enviada fuera de la
  ventana y pasaron más de 7 días desde el último mensaje del cliente, el error MUST
  decir esa causa en español (conservando el texto de la plataforma para
  diagnosticar). El compositor MUST mostrarlo y devolver el texto al campo.
- **FR-1606** WhatsApp MUST NOT cambiar: con la ventana cerrada, el texto libre, los
  adjuntos, la ubicación y el contacto siguen respondiendo `window_closed`, y la
  Bandeja sigue ofreciendo solo plantillas.

---

## Constitution Check

Evaluado antes de escribir código, como exige el carril ligero.

- **I (Seguridad de datos)** — Ningún secreto nuevo ni expuesto. El mensaje de error
  de la plataforma ya viajaba al operador; solo se le antepone la causa.
- **II (Soberanía)** — Sin dependencias nuevas. Los canales opcionales siguen detrás
  de `CHANNELS` (ADR-001): con la bandera apagada no hay conversaciones de Instagram
  ni Messenger que respondan, y todo queda como hoy.
- **III (Multi-tenancy)** — Sin consultas nuevas: `sendTemplate` y *Escribir primero*
  ya cargan conversación y contacto con `scoped()`; solo leen un campo más.
- **IV (Idempotencia)** — Sin cambios: el envío conserva su `Idempotency-Key`.
- **Sandbox** — Una conversación de prueba sigue lanzando `sandbox_violation` antes
  de cualquier decisión por canal (FR-1603).
- **V y IX (Calidad)** — Gate técnico completo, unitarios de la regla y de los
  rechazos, y un guion E2E nuevo que conduce la Bandeja real en el navegador contra
  los mocks de WhatsApp y Zernio, con el camino infeliz (rechazo pasados 7 días).
- **VI (Specs antes de código)** — Este documento, antes de escribir código.
- **X (Irreversibilidad)** — **No toca `drizzle/`**: ni migración ni ensayo.
  Reversión: redesplegar el commit anterior devuelve el compositor que pide
  plantilla; no hay datos que deshacer.

**Sin violaciones que registrar.**

---

## Criterios de éxito

- **SC-001** En el navegador, con la ventana cerrada:
  - una conversación de **Instagram** y una de **Messenger** muestran la caja de
    texto, sin el aviso de plantilla, y con el pie de agente humano;
  - escribir y enviar entrega el texto al mock de Zernio **con `HUMAN_AGENT`** y la
    burbuja aparece en el hilo;
  - una de **WhatsApp** sigue mostrando el aviso y el selector de plantillas, sin caja
    de texto.
- **SC-002** Por la API: enviar una plantilla a la conversación de Instagram responde
  409 y el outbox de WhatsApp no cambia; *Escribir primero* a ese contacto responde
  409 y no crea conversación; el texto libre a la de WhatsApp sigue respondiendo
  `window_closed`.
- **SC-003** Camino infeliz: con más de 7 días, la plataforma rechaza; el compositor
  muestra la causa en español, el texto vuelve al campo y la página sigue viva.
- **SC-004** Contactos no ofrece *Escribir primero* al contacto de Instagram y sí al
  de WhatsApp.
- **SC-005** Gate técnico (`typecheck`, `lint`, `build`, `test`) y los guiones E2E de
  Instagram, Messenger y alta manual sin regresión.

---

## Cómo salió — 2026-10-02

Desde un worktree (`.claude/worktrees/031-plantillas-solo-whatsapp`, app en el puerto
3005 con bases desechables propias), para no tocar el checkout de otras sesiones.

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` · `build` | limpios |
| `test` (unidad), configuraciones `default` y `completo` de la CI | **924 pasan** en las dos, 100 archivos (12 casos nuevos en `plantillas-por-canal.test.ts`) |
| `scripts/e2e-selftest.mjs`, base limpia | **170/170** |
| `scripts/e2e-plantillas-por-canal.mjs`, los tres canales | **58/58**, repetido sobre la misma base |
| el mismo, con `CHANNELS` vacía | **11/11**: solo afirma que WhatsApp no cambió |
| regresión: Instagram · Messenger · plantillas (sync y multivariable) · alta manual · envío instantáneo | 58/58 · 42/42 · 80/80 y 21/21 · 14/14 · 12/12; Instagram con el canal apagado, 8/8 |

**SC-001 a SC-004**, en el navegador del guion: con la ventana cerrada hace dos días,
Instagram y Messenger enseñan la caja y el pie *«Fuera de la ventana de 24 h · sale como
respuesta de agente humano»*; la respuesta llega al mock de Zernio con
`MESSAGE_TAG`/`HUMAN_AGENT` y queda `sent` en el hilo. WhatsApp sigue con el aviso y el
selector, y la plantilla sale. La de Instagram de hace 9 días se rechaza con *«Instagram
ya no acepta respuestas en esta conversación: pasaron más de 7 días…»* más el texto
original de Meta, el texto vuelve al campo y no queda burbuja. Plantilla y *Escribir
primero* a Instagram o Messenger: 409 `channel_without_templates`, sin mover el outbox
de WhatsApp ni abrir otra conversación. A 375 px el pie se parte en dos renglones, sin
scroll horizontal.

Lo que costó, todo del arnés y no del producto: `isVisible()` no espera (el selector
carga sus plantillas aparte), en `next dev` la primera `GET /api/templates` tras editar
código tardó 5 s en compilar, y la vista previa de una conversación de la corrida
anterior ya decía el texto que se esperaba. El guion espera con holgura y usa textos
únicos por corrida.

---

## Fuera de alcance, y por qué

- **El agente de IA fuera de la ventana sigue sin responder**, en todos los canales
  (traspaso `ventana`). La etiqueta `HUMAN_AGENT` es, por política de Meta, para
  respuestas de una persona: que el agente la usara pondría en riesgo la cuenta del
  negocio. Dentro de la ventana responde como siempre.
- **El límite de 7 días no se aplica en Uniko.** El dueño pidió que fuera de WhatsApp
  la ventana no restrinja; la plataforma es la autoridad, y si rechaza, Uniko lo
  explica (FR-1605) en vez de adivinar antes.
- **Los atajos de plantilla del compositor se quedan en todos los canales.** Con la
  ventana abierta pegan el cuerpo como texto libre: son un atajo de escritura, no la
  restricción, y siguen sirviendo en Instagram.
- **Adjuntos, ubicación y contacto en Instagram y Messenger** siguen como hoy: el
  servidor los rechaza con un mensaje claro. Habilitarlos es otro trabajo.
- **`/api/bot/*` no cambia.** `windowOpen` en `/api/bot/context` sigue describiendo
  la ventana de 24 h. Hallazgo anterior a esta feature, anotado para tratarlo
  aparte: `POST /api/bot/messages` hoy **sí** deja salir un texto fuera de la
  ventana en Instagram y Messenger —con la etiqueta de agente humano aunque lo
  mande un bot—, porque `prepareSend` no distingue quién envía.
