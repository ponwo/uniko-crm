# Atribución de anuncios y Conversions API

> Feature opcional (016), apagada por defecto. Se enciende con `ATRIBUCION=on`.

## El problema que resuelve

Si anuncias con **Click-to-WhatsApp**, Meta sabe qué conversaciones
**empezaron** desde un anuncio. No sabe cuáles **sirvieron**. Sin nadie que se
lo diga, el algoritmo optimiza hacia lo único que ve —que alguien abra el
chat— y te entrega el público más barato de hacer escribir, que rara vez es el
que compra. Se siente como "me llegan muchos mensajes y no cierro ninguno".

Uniko está en el único lugar donde esa verdad existe: sabe que esta
conversación vino del anuncio A, que se calificó el martes y que se ganó el
viernes por $12,000. Encender esta feature es devolverle a Meta ese desenlace,
para que el mismo presupuesto empiece a comprar clientes en vez de chats.

## Cómo se enciende

1. `ATRIBUCION=on` en el entorno (en Coolify: variable de runtime, y
   **redeploy** — reiniciar no basta).
2. Ajustes → **Anuncios**: da clic en **Obtener de Meta** (junto a "ID del
   dataset") y guarda. El CRM le pide a Meta el dataset de tu cuenta de
   WhatsApp con la conexión que ya tiene: no hay nada que copiar. Tampoco
   necesitas pegar token: se reusa el del negocio, que es el mismo que autoriza
   publicar en el dataset.
3. Elige **qué etapa de tu pipeline significa "lead calificado"**. La venta no
   se configura: se reporta sola cuando el trato entra a tu etapa ganada.

Eso es todo. A partir de ahí, cada lead que llegó por un anuncio y avanza en tu
tablero se le reporta a Meta.

### De dónde sale el ID del dataset

El dataset de mensajería **le pertenece a tu cuenta de WhatsApp, pero su ID es
otro número**: no es el ID de la cuenta (WABA) ni el del número de teléfono.
**Obtener de Meta** hace por ti lo único seguro, que es pedírselo a Meta:
`POST {waba_id}/dataset` con el token de WhatsApp. Si la cuenta aún no tiene
dataset, Meta lo crea; si ya tiene, devuelve el mismo, así que pedirlo dos veces
no crea dos. (`GET {waba_id}/dataset` no sirve para esto: con una cuenta sin
dataset devuelve una lista vacía.) El botón solo coloca el número: queda
conectado cuando das **Guardar**, y la pantalla avisa si es distinto del que ya
tenías guardado.

Si Meta lo niega, la pantalla muestra su motivo tal cual. Lo más probable es que
el token no tenga el permiso `whatsapp_business_management`.

Si lo pegas a mano, Uniko rechaza al guardar el ID de la cuenta, el del número y
lo que no sea numérico. Ojo con el Administrador de eventos: el portafolio puede
tener otros conjuntos de datos (por ejemplo, uno llamado *WhatsApp Marketing
Message Event Sharing*) que **no** son el de la cuenta. Con uno equivocado, Meta
rechaza cada evento con *"Object with ID … does not exist"*, y como cada evento
se intenta **una sola vez**, esas conversiones ya no se reportan.

## Qué se reporta, exactamente

| Cuándo | Evento de Meta | Datos |
|---|---|---|
| El lead entra a tu etapa "calificado" | `QualifiedLead` | `lead_stage: "qualified"` |
| El lead entra a tu etapa ganada | `Purchase` | `lead_stage: "won"` + `value`/`currency` si el trato tiene monto |

Ambos salen con el `ctwa_clid` del clic y el id de tu cuenta de WhatsApp.
**Nunca** viaja el teléfono, el nombre ni el texto del contacto.

Los dos eventos se disparan desde la única puerta que mueve leads de etapa, así
que da igual quién lo mueva: tú arrastrando la tarjeta, el agente incluido o tu
propio bot por `/api/bot/*`.

## Cómo saber si está funcionando

Ajustes → Anuncios → **Actividad**. Ahí está lo último que se reportó, con su
estado:

- **Enviado** — Meta acusó recibo (`fbtrace_id` es la referencia que pide su
  soporte para rastrear un evento).
- **Fallido** — Meta lo rechazó, o el token venció, o se cayó la red. El motivo
  está escrito tal cual lo dijo Meta.
- **Omitido** — no había nada que reportar: la conversación no vino de un
  anuncio, o falta configurar el dataset.

Esa tabla es la fuente de verdad, no el Administrador de eventos: sus reportes
tardan y sus APIs de estadísticas **están ciegas a los eventos de mensajería**
(devuelven vacío aunque el dataset esté recibiendo eventos).

## Gotchas de Meta que cuesta descubrir solo

Esto es lo que se aprendió operando esta integración en producción durante
meses. Ninguno aparece con esa claridad en la documentación oficial:

1. **Meta responde `200` aunque descarte tu evento.** El único acuse real es
   `events_received >= 1`. Uniko lo comprueba y marca la fila como fallida
   cuando llega en cero — si no, un evento tirado a la basura se vería idéntico
   a uno bueno.
2. **No existe el evento de prueba sintético.** Meta valida el `ctwa_clid`
   contra un clic real: cualquier valor inventado devuelve `code 100 /
   error_subcode 2804087`. La única forma de registrar una conversión es un lead
   que de verdad hizo clic en tu anuncio.
3. **`custom_data` es lo único reglable.** Si algún día envuelves estos eventos
   en una *conversión personalizada*, sus reglas solo pueden mirar `custom_data`
   y la URL — `event_name` y el origen de acción **no son parámetros
   reglables**. Por eso cada evento sale con `lead_stage`: sin él, la conversión
   personalizada se queda en cero para siempre y nada te dice por qué.
4. **El catálogo de eventos es cerrado.** `business_messaging` solo acepta
   14 nombres (`Purchase`, `QualifiedLead`, `InitiateCheckout`, `ViewContent`…).
   Un nombre propio es un `400` opaco.
5. **`QualifiedLead` solo es elegible en campañas de CLIENTES POTENCIALES.** Si
   optimizas una campaña de **ventas** con destino de mensajes, ese evento no
   aparece en el selector (ver la receta de abajo).
6. **El aviso "sin evento de conversión configurado"** que Meta pinta en el
   selector de la campaña puede quedarse ahí para siempre aunque tu dataset esté
   recibiendo eventos: ese registro es un constructo del píxel web y no se puede
   escribir para un dataset de mensajería pura. Es cosmético; la campaña publica
   igual y la atribución va por el `ctwa_clid`.

## Receta: optimizar una campaña de VENTAS

Como `QualifiedLead` no es elegible ahí, quien quiera optimizar una campaña de
ventas con destino de mensajes necesita un evento que **sí** esté en la
intersección de "campaña de ventas" y "catálogo de mensajería":
`InitiateCheckout`, `ViewContent` o `Purchase`.

Uniko **no** hace esto de fábrica a propósito: duplicar cada lead calificado
como "inició pago" es una decisión de negocio, no una verdad del CRM, y quien la
tome debe saber que lo está haciendo. Si la quieres, son tres líneas en tu fork:

```ts
// src/server/attribution/conversions.ts — dentro de reportStageChange,
// después de emitir QualifiedLead:
await emitConversion(
  input.organizationId,
  row.conversationId,
  "InitiateCheckout",           // el espejo que tu campaña de ventas sí acepta
  { lead_stage: "qualified" }
);
```

`emitConversion` es público justamente para esto: hereda el dedup, el manejo del
acuse y el registro en la actividad. Dos advertencias ganadas a golpes:

- El espejo debe acompañar a un envío **recién intentado**. Si lo emites por un
  lead calificado hace semanas, saldrá con la fecha de hoy y romperá la
  atribución.
- Deja `Purchase` para la venta cerrada. Y **jamás** dispares un `Purchase` con
  un importe de prueba: un solo valor falso envenena la optimización por valor.

## Preguntas frecuentes

**¿Y los leads de antes de encender la bandera?** No se atribuyen: sin `ATRIBUCION`
el CRM no guarda el `ctwa_clid`, y sin él no hay nada que reportar. Tampoco se
pierde gran cosa — la ventana de atribución de Meta se mide en días.

**¿Qué pasa si Meta está caído?** El lead se mueve igual. La conversión queda
registrada como fallida con el motivo. Ninguna parte de tu operación depende de
que Meta conteste.

**¿Y el Laboratorio?** Una conversación de prueba **nunca** produce un evento.
Es el mismo guardrail que impide que el Laboratorio mande WhatsApps reales.

**¿Se puede apagar?** Sí: quita `ATRIBUCION` y toda la superficie desaparece. O
desconecta el dataset desde la pantalla y deja de reportarse, conservando la
bitácora de lo que ya se dijo.
