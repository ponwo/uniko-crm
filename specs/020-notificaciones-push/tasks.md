---
description: "Tareas de la 020 — Notificaciones push cuando el agente escala"
---

# Tasks: 020 — Notificaciones push cuando el agente escala

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) ·
[data-model.md](data-model.md) · [contracts/](contracts/) ·
[quickstart.md](quickstart.md) · [ADR-003](../../docs/adr-003-notificaciones-push.md)

**Tests**: SÍ. La spec los exige (Principio IX, tres niveles), así que no son
opcionales.

**Organización**: por historia de usuario, en orden de prioridad.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivo distinto, sin depender de tareas incompletas)
- **[Story]**: US1, US2, US3

---

## ⛔ Tres reglas de orden que no son recomendaciones

### 1. El guardarraíl del Laboratorio va ANTES de cablear la escalación

`applyHandoff()` es lo que dispara el aviso, y **el Laboratorio escala por ese
mismo camino**. El día que se cablee esa línea sin el guardarraíl puesto,
cualquier evaluación del agente manda notificaciones **reales** a los teléfonos
del equipo.

Por eso el corte por `is_test` (T012) está en la Fase 2 con su test, y **la Fase
3 no puede empezar sin él**. No es una tarea de la historia: es su precondición.

### 2. La exclusión de `/api/events` se comprueba con la bandera ENCENDIDA

La 019 dejó comprobado, con las dos mitades en la misma corrida, que el service
worker no toca el canal de eventos. Añadir push **no puede** cambiar eso — y
técnicamente no puede, porque `push` y `fetch` son eventos distintos.

**El riesgo no es técnico, es humano**: alguien que, tocando ese archivo para
añadir push, reescriba el `fetch` de paso. El único sitio donde eso se atrapa es
el arnés, así que T014 vuelve a correr **las dos mitades con `PUSH=on`**, no solo
con la bandera apagada.

### 3. La migración es ADITIVA PURA

Dos tablas nuevas, cero cambios sobre lo existente (data-model). **Si al hacer
cualquier tarea aparece una razón para tocar una tabla existente, hay que
pararse y decirlo**: cambia el perfil de riesgo del Principio X y deja de ser el
caso barato.

---

## Phase 1: Setup

**Purpose**: la bandera y la migración aditiva.

- [x] T001 [P] Crear `src/server/push/flag.ts` siguiendo el patrón de
      `src/server/agenda/flag.ts`: `parsePushFlag`, `pushEnabled()` leyendo
      `process.env.PUSH` directo (no por `getEnv()`), y el helper de respuesta
      404 para superficies apagadas (FR-518)
- [x] T002 [P] Tests en `tests/unit/push-flag.test.ts`: valores que cuentan como
      encendida, cualquier otra cosa apagada, y que la ausencia de la variable no
      lanza
- [x] T003 Añadir a `src/lib/db/schema.ts` las **dos tablas nuevas** del
      [data-model](data-model.md): `push_subscription` (id `ps_`,
      `organization_id` NOT NULL, `user_id` NOT NULL, `endpoint` UNIQUE,
      `created_at`, `last_ok_at`) y `push_key` (id `pk_`, `organization_id`
      UNIQUE, `public_key`, `private_cipher/iv/tag`, `created_at`), con índice
      org-first en ambas
- [x] T004 Generar la migración con `pnpm db:generate` y revisar
      `drizzle/0013_*.sql` **línea por línea**: solo `CREATE TABLE` e `INDEX`.
      Si aparece un `ALTER` sobre algo existente, **parar** (regla 3)
- [x] T005 Declarar `PUSH` en `src/lib/env.ts` con su documentación, y añadirla a
      `.env.example` con guía inline

**Checkpoint**: la bandera existe y la migración está escrita. Nada visible aún.

---

## Phase 2: Foundational

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta cerrar esta fase, y en
particular T012.

### Las claves de la instancia

- [x] T006 [P] Crear `src/server/push/claves.ts`: generar el par P-256 con
      `node:crypto`, guardar la privada cifrada con `encryptSecret` (mismo
      formato `cipher/iv/tag` que el token de WhatsApp), y leerla descifrando.
      Se crea sola la primera vez que hace falta (FR-515)
- [x] T007 [P] Tests en `tests/unit/push-claves.test.ts`: se genera una sola vez
      por organización; la privada **nunca** aparece en el objeto devuelto al
      llamador que solo pide la pública; y descifrar con clave equivocada lanza
- [x] T008 [P] Crear `src/server/push/vapid.ts`: firmar el JWT ES256 con
      `node:crypto`, incluida la conversión DER → R‖S de la firma
- [x] T009 [P] Tests en `tests/unit/push-vapid.test.ts`: el JWT tiene tres
      partes, el header dice ES256, la firma son 64 bytes, y `aud` sale del
      origen del endpoint

### El adaptador y su mock

- [x] T010 Crear `src/server/push/enviar.ts` con el contrato de
      [contracts/push.md](contracts/push.md): `enviarAviso(suscripcion)` →
      `entregada | caducada | fallo`, con **cuerpo vacío** (FR-505) y sin
      reintentos
- [x] T011 Crear el mock del servicio de entrega en `src/app/api/dev/push-mock/`
      tras `dev-guard`, con sus caminos infelices: acepta, responde **410**,
      rechaza con 500, y tarda más de la cuenta

### El guardarraíl, ANTES de que exista el disparador

- [x] T012 Crear `src/server/push/avisar.ts` —la capacidad de dominio— con el
      orden del contrato: **`is_test` corta en la primera línea** (FR-503),
      después la bandera, después los destinatarios. **Nunca lanza** (FR-504)
- [x] T013 Tests en `tests/unit/push-destinatarios.test.ts`: una conversación de
      prueba **no avisa a nadie**; con la bandera apagada tampoco; con todo
      encendido avisan a los usuarios con suscripción viva; y un fallo del
      adaptador **no propaga excepción**

### La comprobación que protege a la 019

- [x] T014 Extender `scripts/e2e-pwa.mjs` (o el guion de push, según dónde
      quede más limpio) para que **las dos mitades de la exclusión de
      `/api/events` se comprueben también con `PUSH=on`**: el service worker
      controla la página, y el handler **nunca ve** el canal de eventos. Añadir
      que el cuerpo servido conserva las reglas de exclusión con push activo
      (regla 2)

**Checkpoint**: se puede avisar, no se puede avisar de una prueba, y la 019 sigue
comprobada con push encendido. **Ahora sí** se puede cablear la escalación.

---

## Phase 3: User Story 1 — El aviso llega al teléfono (P1) 🎯 MVP

**Goal**: que una escalación real llegue al teléfono de quien no tiene la app
delante, y que al tocarla se abra esa conversación.

**Independent Test**: con la bandera encendida y el mock, una escalación produce
un envío con cuerpo vacío; una del Laboratorio no produce ninguno.

- [x] T015 [US1] Cablear el aviso en `applyHandoff()` de
      `src/server/ai/pipeline.ts`: **una línea**, después de que la escalación
      esté guardada y sin esperarla (FR-501, FR-504)
- [x] T016 [P] [US1] Crear `src/app/api/push/pendiente/route.ts`: devuelve la
      conversación escalada más reciente y su nombre, para que el service worker
      sepa qué mostrar (FR-506). Detrás de la bandera y de sesión
- [x] T017 [US1] Añadir a `src/app/api/sw/route.ts` el bloque de `push` y
      `notificationclick` **solo cuando `pushEnabled()`** (FR-519), sin tocar el
      `install` con el enrutado estático ni la salida temprana del `fetch`
- [x] T018 [US1] En ese bloque: pedir el detalle a la propia instancia, mostrar
      la notificación, y si la petición falla mostrar el **texto degradado**
      "Alguien necesita atención · El agente pasó una conversación a un humano.
      Ábrela para ver cuál." (FR-507)
- [x] T019 [US1] `notificationclick`: enfocar una pestaña abierta si la hay, o
      abrir `/inbox?conversation=<id>`; sin id conocido, abrir la bandeja
      (FR-508)
- [x] T020 [US1] Tests en `tests/unit/sw-push.test.ts`: con la bandera apagada el
      cuerpo **no contiene** `push` ni `notificationclick`; con ella encendida sí,
      y **siguen estando** las reglas de exclusión y la salida temprana
- [x] T021 [US1] Crear `scripts/e2e-push.mjs`: con `PUSH=on`, una escalación
      produce un envío al mock y **su cuerpo va vacío**; una del Laboratorio no
      produce ninguno; con la bandera apagada las rutas dan 404
- [x] T022 [US1] Encadenar `e2e-push.mjs` en `test:e2e` de `package.json`

**Checkpoint**: US1 completa. El aviso llega (contra el mock) y el Laboratorio no
despierta a nadie.

---

## Phase 4: User Story 2 — Activar y desactivar desde la app (P2)

**Goal**: que el operador active los avisos con un gesto explícito, y pueda
quitarlos igual.

**Independent Test**: con la bandera encendida, la tarjeta ofrece activar; tras
activar, la suscripción existe; al desactivar, desaparece. Con la bandera
apagada, la tarjeta no existe.

- [ ] T023 [P] [US2] Crear `src/app/api/push/clave-publica/route.ts`: devuelve la
      clave pública de la instancia, generando el par si aún no existe
- [x] T024 [US2] Crear `src/app/api/push/suscripcion/route.ts` con alta (POST) y
      baja (DELETE), idempotentes por `endpoint` (FR-511, Principio IV)

      **Adelantada desde la Fase 4**, y conviene decir por qué: el arnés de US1
      no puede probar nada sin un dispositivo suscrito, y meterlo por una puerta
      de pruebas habría sido inventar una superficie para no reordenar dos
      tareas. La parte de US2 que sigue pendiente es la de verdad: la tarjeta de
      Ajustes, el permiso en el clic y el texto de iOS.
- [ ] T025 [P] [US2] Crear `src/components/settings/avisos-card.tsx` con los tres
      estados, decididos con `lib/platform` de la 019: se puede / hace falta
      instalar la app / ya están activados (FR-513)
- [ ] T026 [US2] Pedir el permiso **dentro del manejador de clic** (FR-509): en
      iOS no vale pedirlo al cargar. Y ofrecer desactivarlos (FR-510)
- [ ] T027 [US2] Montar la tarjeta en la pantalla de Ajustes, visible **solo** con
      la bandera encendida
- [ ] T028 [US2] Añadir a `scripts/e2e-push.mjs`: la tarjeta no existe con la
      bandera apagada; con ella encendida, suscribirse crea **una** fila y
      repetir la suscripción del mismo endpoint **no crea otra**; desactivar la
      borra

**Checkpoint**: US1 y US2 funcionan por separado.

---

## Phase 5: User Story 3 — Los caminos infelices (P3)

**Goal**: que un teléfono que ya no está desaparezca solo, y que ningún fallo del
servicio cueste una escalación.

**Independent Test**: con el mock respondiendo 410, la suscripción desaparece;
con el mock caído, la escalación se guarda igual.

- [ ] T029 [US3] Borrar la suscripción cuando el adaptador devuelve `caducada`
      (410), en el sitio y sin ceremonia (FR-514)
- [ ] T030 [US3] Registrar los `fallo` sin ruido de alarma y **sin reintentos**
      (contrato), sellando `last_ok_at` solo en las entregadas
- [ ] T031 [US3] Añadir a `scripts/e2e-push.mjs`: con 410 la fila desaparece; con
      el mock caído, lento y rechazando, **la conversación queda escalada igual**
      y la bandeja lo enseña
- [ ] T032 [US3] Añadir a `scripts/e2e-push.mjs`: rotar las claves invalida las
      suscripciones y la app lo dice donde se rota (FR-517)

**Checkpoint**: las tres historias funcionan por separado.

---

## Phase 6: El ensayo del Principio X, y el cierre

> **T033 bloquea el merge a `main`.** No es una tarea de documentación: es la
> condición 4 de la puerta de promoción.

- [ ] T033 **Ensayo del Principio X** siguiendo la Parte 1 del
      [quickstart](quickstart.md): producir el volcado a mano (no hay respaldos
      programados), restaurarlo en una base **desechable**, correr solo las
      migraciones contra esa copia, comprobar que la app arranca, y **borrar la
      base y el volcado**. Anotar instancia, fecha del respaldo, duración y
      resultado
- [ ] T034 [P] Escribir el guion de la historia en `tests/e2e/us-push.md` con los
      tres niveles y el hueco para registrar las corridas, incluida la regla de
      la 018: **una corrida sin notificación recibida no cuenta**
- [ ] T035 [P] Actualizar `docs/desarrollo-local.md` (los guiones del arnés) y
      `.env.example` con `PUSH`
- [ ] T036 Gate técnico completo desde la ruta real:
      `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] T037 **Nivel 3 en dispositivo real**: app instalada, permiso concedido y
      escalación real (escribir "quiero hablar con alguien" al número de la
      instancia). Responder las cuatro preguntas del quickstart, incluida si iOS
      **reemplaza o apila** el segundo aviso de la misma conversación
- [ ] T038 Registrar la corrida del nivel 3 en `tests/e2e/us-push.md`, diciendo
      **si llegó la notificación**. Si no llegó, se repite o se anota como *no
      reproducida*: un verde sin notificación no cuenta

---

## Dependencies

```
Fase 1 (bandera + migración)
   │
   ▼
Fase 2 (claves · adaptador · GUARDARRAÍL T012 · arnés con PUSH=on T014)
   │
   ├─────────────► Fase 3 (US1) ──► Fase 4 (US2) ──► Fase 5 (US3)
   │                                                      │
   └──────────────────────────────────────────────────────┴──► Fase 6
```

- **T012 bloquea la Fase 3 entera.** Cablear `applyHandoff` sin el corte por
  `is_test` convierte cualquier prueba del Laboratorio en notificaciones reales.
- **T014 no espera al final**: la protección de la 019 se comprueba desde que
  existe la bandera, no cuando ya está todo escrito.
- **T033 bloquea el merge**, no la implementación: puede hacerse en cuanto la
  migración de T004 esté escrita.
- US2 y US3 dependen de US1 solo por la ruta de suscripción y el adaptador.

## Parallel opportunities

- Fase 1: T001/T002 en paralelo con T003.
- Fase 2: T006-T009 son dos módulos puros con sus tests, en archivos distintos.
- Fase 4: T023 y T025 en paralelo.
- Fase 6: T034 y T035 en paralelo.

## MVP

**US1** (Fases 1, 2 y 3). Con eso una escalación real ya llega al teléfono, que
es lo que la feature existe para dar. US2 la hace activable por el operador y US3
la hace resistente.

Ninguna se entrega sin la Fase 2 completa — **T012 incluida**.
