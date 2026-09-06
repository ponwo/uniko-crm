---
description: "Tareas de la 018 — Reconexión resiliente del SSE"
---

# Tasks: 018 — Reconexión resiliente del SSE

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) · [quickstart.md](quickstart.md)

**Tests**: SÍ se generan tareas de prueba. La spec las exige explícitamente
(Principio IX y su sección "Verificación", en tres niveles), así que no son
opcionales aquí.

**Organización**: por historia de usuario, en orden de prioridad. Cada fase de
historia es un incremento entregable y probable por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1, US2, US3

---

## ⛔ La restricción que ordena todo: el heartbeat va en DOS ENTREGAS

El cliente va a declarar muerta una conexión que lleve 60 s sin tráfico. La
señal de vida es el heartbeat **con nombre**, que hoy no existe: el servidor
manda un comentario `: ping` que el cliente no puede ver (research R1).

Por tanto: **si el cliente sale antes que el servidor, o a la vez con un
despliegue que no respeta el orden, el vigilante declarará muerta cada conexión
a los 60 segundos.** Reconectará, volverá a no ver nada, y volverá a declararla
muerta. Sería el fallo que la feature existe para evitar, provocado por la
feature, y en bucle.

De ahí el orden, que no es una recomendación:

1. **Entrega 1 (Fase 2)**: el evento con nombre en el servidor. Se mergea a
   `main`, llega a **LanCo desplegada**, y se **verifica ahí** que se emite.
2. **Entrega 2 (Fases 3-6)**: el cliente empieza a depender de él.

La tarea **T007 es una puerta**: hasta que no esté marcada, ninguna tarea de la
Fase 3 en adelante puede empezar.

Es además la forma que el Principio X pide para lo irreversible — primero
agregar, después depender — aplicada aquí por la misma razón de fondo, aunque no
haya migración.

---

## Phase 1: Setup

**Purpose**: lo compartido que no depende de nada.

- [x] T001 [P] Crear `src/lib/sse-constants.ts` con el intervalo del heartbeat, el margen de silencio (60 s, research R5) y la escala de reintento (1→15 s, research R6), en un solo sitio para que servidor y cliente no se desincronicen
- [x] T002 [P] Añadir el guion de la historia en `tests/e2e/us-reconexion-sse.md` con los pasos del quickstart (niveles 2 y 3), incluida la casilla de "¿se reprodujo el fallo en iOS?" que exige SC-009

---

## Phase 2: ENTREGA 1 — Heartbeat observable (BLOQUEANTE)

**Purpose**: dar al cliente una señal de vida que pueda ver. Todo lo demás
depende de que esto esté **desplegado**, no solo escrito.

**Alcance**: solo servidor y contrato. Ni una línea de cliente.

- [x] T003 Emitir un evento con nombre junto al `: ping` existente en `src/app/api/events/route.ts`, en el mismo tic del heartbeat, sin carga útil de dominio y **sin quitar el comentario** (contrato aditivo, `contracts/sse-heartbeat.md`)
- [x] T004 [P] Actualizar `specs/001-uniko-core/contracts/sse.md` con el añadido, dejando escrito que es aditivo y que el servidor sigue sin garantizar replay
- [x] T005 [P] Test en `tests/unit/sse-heartbeat.test.ts`: el stream emite el evento con nombre al ritmo del heartbeat, y sigue emitiendo el comentario `: ping`
- [x] T006 Gate técnico completo desde la ruta real (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`), PR y merge a `main`

### 🚦 T007 — PUERTA DE DESPLIEGUE (no se salta)

- [x] T007 ✅ VERIFICADA POR EL DUEÑO (2026-09-06, cuatro tics limpios en LanCo). Verificar en **LanCo desplegada** que el evento con nombre se está emitiendo: `curl -N https://uniko.lanco.cloud/api/events` con sesión válida y observar el evento llegando cada ~25 s. Comprobar además que `/api/health` reporta el commit de la Entrega 1

**Hasta que T007 esté marcada, NO empezar la Fase 3.** Si la Entrega 1 no está
viva en LanCo, el vigilante del cliente no tendrá nada que ver y declarará
muertas conexiones sanas.

**Checkpoint**: en este punto el servidor emite una señal nueva que nadie
escucha todavía. Eso es correcto y es el objetivo de la entrega: nada cambia
para el usuario, y el terreno queda preparado.

---

## Phase 3: US1 — Detectar la muerte silenciosa y recuperar (Priority: P1)

**Goal**: que volver a la app tras una suspensión deje la bandeja al día, y que
una conexión que muere sin avisar se detecte y se restablezca.

**Independent Test**: con el simulador de muerte silenciosa, la bandeja detecta
el silencio, reconecta y muestra los mensajes del hueco — sin tocar nada más de
la interfaz.

**Why this priority**: es la feature. Sin esto, lo demás no tiene sobre qué
apoyarse.

### Lógica pura primero (es lo que hace posible probarla)

- [x] T008 [US1] Extraer la decisión a una función pura con reloj inyectable en `src/lib/sse-watchdog.ts`: dado `lastTrafficAt`, visibilidad, `readyState` y número de intentos → qué hacer (esperar / reconectar / sesión terminada)
- [x] T009 [P] [US1] Tests en `tests/unit/sse-watchdog.test.ts` con reloj falso: silencio bajo el margen no dispara; por encima sí; visibilidad fuerza comprobación inmediata; `CONNECTING` espera; `CLOSED` no reintenta en bucle; el backoff crece y se reinicia al conectar; oculta no reintenta

### Cablearlo al transporte

- [x] T010 [US1] En `src/components/use-events.ts`, registrar el evento de heartbeat y actualizar `lastTrafficAt` con **cualquier** dato recibido (heartbeat o evento de dominio)
- [x] T011 [US1] En `src/components/use-events.ts`, añadir el vigilante: intervalo de comprobación + `visibilitychange` + `pageshow`, comparando **sellos de tiempo** y no si el intervalo disparó (research R3)
- [x] T012 [US1] En `src/components/use-events.ts`, implementar la reconexión: cerrar y construir un `EventSource` nuevo registrando los listeners **una sola vez**, con la espera creciente de T001 y sin insistir con la página oculta
- [x] T013 [US1] En `src/components/use-events.ts`, tratar `error` según `readyState` (research R4): `CONNECTING` esperar; `CLOSED` un intento controlado y, si vuelve a cerrar, sesión terminada sin más reintentos (FR-306)
- [x] T014 [US1] Disparar `onReconnect` al quedar la conexión abierta de nuevo, y exponer desde el hook el estado de conexión y si el catch-up sigue en curso (lo consumirá US2)

### Poder probarlo en escritorio

- [x] T015 [P] [US1] Simulador de muerte silenciosa en `src/app/api/dev/sse-mudo/route.ts`: stream SSE válido que deja de escribir sin cerrarse, tras el gate existente `src/lib/dev-guard.ts` (404 incondicional en producción) — con tests en `tests/unit/sse-mudo.test.ts` que fijan que **no** cierra el stream
- [ ] T016 [US1] **DIFERIDA A LA FASE 4.** Extender `scripts/e2e-selftest.mjs` con el camino completo: conectado → enmudece → se detecta → reconecta → catch-up → los mensajes del hueco están y no hay duplicados (FR-308)

  **Por qué se mueve**: su enunciado incluye "se detecta" en el sentido de *que el usuario lo ve*, y el aviso no existe hasta US2 (T017-T020). Escrita en la Fase 3 solo podría comprobar media cosa, y habría que volver a tocarla. Es un defecto de secuenciación de esta lista, detectado al implementar. Se ejecuta junto a T021, que ya vive en la Fase 4 y cubre el mismo camino.

**Checkpoint**: la bandeja ya se recupera sola. Todavía no lo cuenta — eso es US2.

---

## Phase 4: US2 — Decir la verdad mientras tanto (Priority: P2)

**Goal**: que el usuario nunca vea una bandeja que parece al día sin estarlo.

**Independent Test**: con el simulador, aparece el aviso durante la caída y
**desaparece solo cuando el catch-up ha terminado**, no al reconectar.

**Why this priority**: US1 arregla el fallo; US2 es lo que impide que vuelva a
ser silencioso. Va después porque necesita el estado que expone T014.

- [ ] T017 [US2] Componente de estado de conexión en `src/components/inbox/connection-status.tsx` con los dos estados visibles: *reconectando* y *sin conexión* ("al día" no se adorna, FR-310)
- [ ] T018 [US2] Montarlo en `src/components/inbox/inbox-client.tsx` consumiendo el estado del hook (T014)
- [ ] T019 [US2] Retardar la aparición del aviso lo justo para que una reconexión limpia no produzca parpadeo (FR-312), en `src/components/inbox/connection-status.tsx`
- [ ] T020 [US2] Atar la desaparición del aviso al **fin del catch-up** y no a la reconexión (FR-311), en `src/components/inbox/inbox-client.tsx`
- [ ] T021 [P] [US2] Añadir al arnés de `scripts/e2e-selftest.mjs`: el aviso aparece durante la caída, no parpadea en una reconexión rápida, y se retira solo tras el refresco

**Checkpoint**: el fallo silencioso deja de ser silencioso.

---

## Phase 5: US3 — Las otras tres vistas (Priority: P3)

**Goal**: que el contador de no leídos, el Laboratorio y la agenda también
queden al día tras un hueco.

**Independent Test**: tras una caída y recuperación, el contador de la barra
coincide con la bandeja; una corrida del Lab terminada durante el hueco deja de
verse en curso; una cita creada en el hueco aparece.

**Why this priority**: es un fallo preexistente e independiente de iOS, pero sin
él la promesa de US2 queda a medias — el aviso se retira y el contador sigue
mintiendo en todas las pantallas.

**Alcance verificado**: **cero trabajo de servidor**. Las tres llaman a
endpoints que ya existen (`/api/conversations`, `/api/lab/runs`, `/api/bookings`
+ `/api/calendar/availability`) mediante funciones de recarga ya escritas. Si al
implementar aparece necesidad de servidor, es que el alcance se ensanchó:
**parar y avisar**.

> **T022-T025 se adelantaron a la Fase 3.** No fue una decisión de alcance sino
> una consecuencia: al hacer `onReconnect` obligatorio (T025), el compilador
> señaló las tres vistas que lo olvidaban y el proyecto dejó de compilar hasta
> cablearlas. La alternativa —dejarlo opcional ahora y obligatorio en la Fase 5—
> significaba entregar una versión con el fallo todavía dentro y cambiar el tipo
> dos veces. El trabajo es el mismo y sale de una pieza.
>
> Vale la pena anotar que **T025 funcionó exactamente como se esperaba**: era el
> intento de que olvidar el catch-up dejara de ser el camino fácil, y lo primero
> que hizo fue convertir un fallo silencioso de tres vistas en un error de
> compilación.

- [x] T022 [P] [US3] Cablear el catch-up en `src/components/app-nav.tsx` llamando a `refetchUnread` existente
- [x] T023 [P] [US3] Cablear el catch-up en `src/components/lab/lab-client.tsx` llamando a `refetchRuns` (y al detalle si hay corrida seleccionada)
- [x] T024 [P] [US3] Cablear el catch-up en `src/components/bookings/bookings-client.tsx` llamando a `refresh` existente
- [x] T025 [US3] Hacer que olvidar el catch-up no sea el camino fácil en `src/components/use-events.ts`: que el comportamiento por defecto sea el correcto en vez de depender de que cada consumidor se acuerde (tres de cinco lo olvidaron)
- [ ] T026 [P] [US3] Añadir al arnés: tras la recuperación, el contador de no leídos coincide con la bandeja (SC-004)

**Checkpoint**: ninguna vista se queda con datos viejos sin avisar.

---

## Phase 6: Pulido y verificación en vivo

- [ ] T027 Alinear documentación y código sobre el catch-up: el contrato y el comentario de `use-events.ts` dicen `since=` mientras la bandeja hace refetch completo. Decidir que gana el refetch completo y corregir `specs/001-uniko-core/contracts/sse.md` y el comentario del hook
- [ ] T028 Gate técnico completo desde la ruta real: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] T029 PR de la Entrega 2 con el Constitution Check escrito, mencionando que el contrato SSE se amplió de forma aditiva
- [ ] T030 Desplegar a LanCo (merge a `main`) y esperar el redespliegue; verificar por `/api/health` que corre el commit

### Nivel 3 — dispositivo real (OBLIGATORIO, Principio IX)

- [ ] T031 **iOS**: reproducir el fallo en un iPhone contra LanCo — segundo plano varios minutos, mensaje entrante durante el hueco, volver a primer plano. Registrar **si el fallo se reprodujo**; si no, repetir alargando el tiempo o anotarlo como "no reproducido" (SC-009). Un verde sin fallo reproducido no cuenta
- [ ] T032 **Android**: comprobar no regresión en Chrome contra LanCo — el ciclo normal deja la vista al día incluido el contador, no hay reconexiones espurias ni parpadeo (FR-312), y el aviso sale y se va con la red. **No forzar la narrativa**: si el fallo no se reproduce, es lo esperado y así se registra
- [ ] T033 Anotar en el PR y en `tests/e2e/us-reconexion-sse.md` lo observado: si se reprodujo en iOS, cuánto tiempo en segundo plano, versiones de iOS y Android, y qué se vio al volver

---

## Dependencias

```text
Fase 1 (Setup)
   ↓
Fase 2 (ENTREGA 1: servidor) ──► 🚦 T007 puerta de despliegue
   ↓                              (LanCo emitiendo el evento)
Fase 3 (US1) ◄── requiere T007 marcada
   ↓
Fase 4 (US2) ◄── requiere T014 (estado expuesto por el hook)
   ↓
Fase 5 (US3) ◄── requiere T014; independiente de US2
   ↓
Fase 6 (pulido + dispositivo real)
```

- **US1** depende de la Entrega 1 desplegada (T007). Es la única dependencia dura entre entregas.
- **US2** depende de T014.
- **US3** depende de T014, pero **no** de US2: se pueden hacer en cualquier orden o en paralelo una vez cerrada US1.

## Paralelismo

- **Fase 1**: T001 y T002 en paralelo.
- **Fase 2**: T004 y T005 en paralelo tras T003.
- **Fase 3**: T009 en paralelo con T010-T014 (archivo distinto); T015 en paralelo con todo lo demás de la fase.
- **Fase 5**: T022, T023, T024 y T026 en paralelo — archivos distintos y sin dependencia entre ellos.

## MVP

**US1 sola es un MVP entregable**: la bandeja se recupera de la muerte
silenciosa. Sin US2 no lo cuenta, y sin US3 tres vistas se quedan atrás, pero el
fallo grave —mensajes de clientes que no aparecen nunca— queda resuelto.

Recomendación: no parar en el MVP. US2 es lo que impide que el fallo vuelva a
ser silencioso el día que la recuperación falle, y es barata.

## Recuento

| Fase | Tareas |
|---|---|
| 1 — Setup | 2 |
| 2 — Entrega 1 (servidor) + puerta | 5 |
| 3 — US1 | 9 |
| 4 — US2 | 5 |
| 5 — US3 | 5 |
| 6 — Pulido y dispositivo | 7 |
| **Total** | **33** |
