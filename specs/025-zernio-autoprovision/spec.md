# 025 — Uniko registra su webhook en Zernio y gestiona comentario→DM

**Feature Branch**: `claude/instagram-messenger-inboxes-a8a5d5` (misma rama que #24/#25)

**Created**: 2026-09-10

**Status**: Draft

**Carril**: **ligero** (`spec.md` únicamente). Sin migración: la automatización
se identifica en Zernio por `accountId` + nombre, y el webhook por su URL; no
hay id nuevo que guardar. El Constitution Check vive aquí abajo.

**Banda de requisitos**: FR-10xx (`(25−15)×100`).

---

## El problema, en una frase

**Conectar Instagram o Messenger por Zernio hoy deja el trabajo a medias: Uniko
enseña la URL del webhook pero no lo registra, y quien olvida ese paso ve una
conexión "guardada" por la que jamás entra un mensaje.**

## Problema

El 2026-09-10, primera conexión real de LanCo: la pantalla dijo "Conexión
guardada", el operador escribió DMs y no llegó nada. Diagnóstico por API:
`GET /webhooks/settings → {"webhooks": []}`. Zernio no entrega nada hasta que
se le da de alta el endpoint, y ese alta vive en OTRO panel. Es el peor modo de
fallo: silencioso, y con la pantalla afirmando que todo está bien.

Además, el dueño eligió atender los comentarios con la automatización nativa
comentario→DM de Zernio (spec 014 deja los comentarios fuera de Uniko). Esa
configuración también vive en el panel de Zernio, y es por cliente: cada
instancia tiene su propia cuenta. Hacerla a mano N veces es el mismo tipo de
paso olvidable.

## Decisión

La API key de Zernio que Uniko ya guarda cifrada tiene permiso para todo lo
anterior (comprobado en vivo). Así que:

1. **Al guardar una conexión Zernio, Uniko registra (o actualiza) su webhook
   en Zernio.** Con el secreto que el operador escribió; si no escribió
   ninguno, Uniko genera uno y lo guarda. Instagram y Messenger comparten el
   webhook y el secreto (Zernio firma por endpoint).
2. **La pantalla del canal gestiona la automatización comentario→DM** de esa
   cuenta: encendida/apagada, palabras clave, texto del DM y respuesta pública.

Ambas cosas son **conector opcional** (Constitución II): si Zernio falla, la
conexión se guarda igual y la pantalla dice qué quedó pendiente y cómo hacerlo
a mano. Nada del core depende de que el alta funcione.

## Requisitos

- **FR-1001** `PUT /api/settings/{instagram|messenger}` con `source: zernio`
  registra en Zernio un webhook con la URL de callback de ESE canal, el evento
  `message.received` y el secreto compartido; si ya existe uno apuntando a
  cualquiera de las dos URLs de callback de la instancia, lo actualiza (secreto,
  evento, activo) en vez de crear otro.
- **FR-1002** El secreto compartido es, en orden: el que escribió el operador;
  el que ya tenga guardado el otro canal Zernio de la organización; el que ya
  tenía este canal; uno generado (24 bytes hex). Tras registrar, ambos canales
  Zernio de la organización quedan con el mismo secreto guardado.
- **FR-1003** El resultado del alta viaja en la respuesta del `PUT`
  (`webhook: { registered, url, generatedSecret, error? }`) y el `GET` del
  canal comprueba en Zernio si el webhook existe (`registered | missing |
  unknown`). Un fallo de Zernio nunca hace fallar el guardado (422 solo por
  credenciales; el alta degrada a `registered: false` con motivo).
- **FR-1004** `GET/PUT /api/settings/{canal}/comment-automation` lee y crea o
  actualiza la automatización comentario→DM de la cuenta conectada: `enabled`,
  `keywords[]` (modo palabra + tolerancia a errores), `dmMessage`,
  `commentReply` opcional. Se identifica por `accountId` + nombre `Uniko ·`;
  apagar es `isActive: false`, nunca borrar (conserva estadísticas).
- **FR-1005** Con el canal apagado (`CHANNELS`) toda esta superficie es 404;
  con conexión Meta directa responde `available: false`. Solo el propietario
  escribe.
- **FR-1006** El mock de Zernio implementa webhooks y automatizaciones en
  memoria y el arnés E2E afirma: alta al guardar, un solo webhook para los dos
  canales, secreto compartido verificable por firma, y crear/actualizar/apagar
  la automatización sin duplicarla.

## Fuera de alcance

Comentarios dentro de la bandeja de Uniko; botones/plantillas del DM;
segmentación por seguidores (`audience`): se usa `whenUnknown: send`, el único
valor que no deja mudo al negocio en Instagram.

## Constitution Check

- **II (soberanía)**: Zernio sigue siendo conector opcional tras `CHANNELS`;
  su fallo degrada a "hazlo a mano" con la URL en pantalla. Credenciales
  cifradas como antes; el secreto generado se guarda en la misma columna.
- **I (seguridad)**: el secreto y la API key nunca salen en respuestas; el
  `GET` solo dice si el webhook existe.
- **IV (idempotencia)**: registrar dos veces no crea dos webhooks; guardar la
  automatización dos veces no la duplica.
- **X**: sin migración.
