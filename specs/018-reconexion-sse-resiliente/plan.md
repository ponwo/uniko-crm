# Implementation Plan: 018 — Reconexión resiliente del SSE

**Branch**: `018-reconexion-sse-resiliente` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: [`specs/018-reconexion-sse-resiliente/spec.md`](spec.md) ·
[notas previas](notas-para-el-plan.md) · [Fase 0](research.md)

## Summary

La bandeja se queda callada cuando la conexión SSE muere sin avisar, y hoy nada
lo detecta: el cliente confía en que `EventSource` dispare `error`, y hay un caso
reportado en iOS 18 donde no lo hace.

El enfoque: **dejar de confiar en el aviso del navegador y medir el silencio**.
El servidor pasa a emitir un heartbeat *observable* (evento con nombre, aditivo
al `: ping` que ya manda); el cliente registra cuándo recibió tráfico por última
vez y declara muerta la conexión cuando pasa demasiado tiempo, además de
comprobarlo en cuanto la página vuelve a ser visible. Al reconectar dispara el
catch-up, ahora en **todos** los consumidores y no solo en la bandeja. Mientras
tanto, la interfaz lo dice.

La Fase 0 cambió una cosa respecto a lo previsto: **el `: ping` actual no es
observable desde el cliente** (la especificación manda ignorar los comentarios),
así que la feature no es solo de cliente. El cambio de servidor es aditivo y la
spec ya lo contemplaba en FR-313.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Next.js 15 (App Router) + React 19

**Primary Dependencies**: ninguna nueva. `EventSource` del navegador y las APIs
de visibilidad de página; sin librerías de tiempo real.

**Storage**: N/A — esta feature no toca el modelo de datos ni añade migración.

**Testing**: Vitest (unidad) para la lógica de decisión con reloj inyectable;
Playwright + mocks (`scripts/e2e-selftest.mjs`) para el camino completo en
escritorio; dispositivo real para el nivel 3.

**Target Platform**: navegadores móviles (Safari iOS y Chrome Android) y de
escritorio. Safari iOS es la plataforma que define el diseño.

**Project Type**: aplicación web monolítica (Next.js), cliente + una ruta de
servidor.

**Performance Goals**: la recuperación tras volver a primer plano debe ser
inmediata a ojo (bajo ~1 s hasta iniciar la reconexión). El heartbeat añade
~30 bytes cada 25 s por conexión: despreciable.

**Constraints**:
- No romper clientes existentes del contrato SSE (FR-313): solo cambios aditivos.
- No cambiar el comportamiento observable en escritorio con red estable (FR-314).
- Los temporizadores no corren con la página congelada (research R3): la
  detección se basa en comparar sellos de tiempo, no en que un intervalo dispare.
- `freeze`/`resume` no existen en Safari (research R2): no se pueden usar como
  base.

**Scale/Scope**: una instancia = un negocio; pocos operadores concurrentes.
Cinco consumidores de eventos en el cliente, una ruta SSE en el servidor.

## Constitution Check

*GATE: evaluado antes de la Fase 0 y de nuevo tras el diseño de la Fase 1.*

**Antes de la Fase 0** — pasa.

| Principio | Evaluación |
|---|---|
| **I. Seguridad de datos** | Sin impacto. No hay credenciales nuevas, ni secretos, ni datos nuevos. El endpoint de simulación (R7) va tras `dev-guard`: 404 incondicional en producción. |
| **II. Soberanía** | Sin impacto. Cero dependencias externas nuevas; se descartó migrar a WebSockets o a un servicio de tiempo real de terceros (fuera de alcance por la spec, y sería violación). |
| **III. Multi-tenancy** | Sin cambios: `/api/events` ya se suscribe por `organizationId` y esta feature no toca esa suscripción. |
| **IV. Idempotencia** | Aplica de lleno en el cliente (FR-308): el catch-up no debe duplicar mensajes ni perder burbujas provisionales. El heartbeat nuevo no lleva datos y repetirlo no tiene efecto. |
| **V. Calidad verificable** | Tipos, lint, build y tests; la lógica de decisión se diseña pura para que sea testeable de verdad. |
| **VI. Specs antes de código** | Ciclo completo, por criterio objetivo: toca un contrato publicado (SSE). Spec escrita antes; este plan la sigue. |
| **VII. Trazabilidad** | El supuesto que sostiene la feature —el reporte de iOS 18, sin confirmación oficial— está escrito en la spec y aquí. El diseño no depende de que sea cierto: la vigilancia por silencio protege igual contra proxies que cortan y redes que cambian. |
| **VIII. Foco vertical** | Sirve al negocio que opera la instancia: que la bandeja de WhatsApp no mienta. |
| **IX. Verificación en vivo** | El punto delicado, tratado en la spec: el fallo no se reproduce en `localhost`. **No hay violación**: el principio reserva expresamente el despliegue para "lo que el entorno local no pueda reproducir". Ver "Verificación" abajo. |
| **X. Irreversibilidad** | **No aplica**: sin migración, sin tocar `drizzle/`. El cambio de contrato es aditivo y reversible con un redeploy. |

**Tras la Fase 1** — sigue pasando. El diseño no introdujo dependencias, ni
estado nuevo, ni superficie pública sin gate. La única ampliación de contrato es
aditiva y queda documentada.

**Complexity Tracking**: sin violaciones que justificar. Tabla vacía a propósito.

## Diseño

### D1. Servidor: heartbeat observable (aditivo)

`src/app/api/events/route.ts` sigue emitiendo `: ping` cada 25 s y **añade**, en
el mismo tic, un evento con nombre. El comentario se mantiene por compatibilidad
estricta con el contrato vigente y porque es lo que documenta la defensa frente
a proxies; el evento con nombre es lo que el cliente puede ver.

Ningún cliente existente se rompe: un `EventSource` ignora los eventos con
nombre que no tiene registrados. `contracts/sse.md` de la 001 se actualiza en el
mismo PR.

### D2. Cliente: el vigilante

Toda la lógica vive en `src/components/use-events.ts`, único sitio donde se crea
el `EventSource`. Los cinco consumidores heredan el arreglo sin tocarlos.

Estado interno: `lastTrafficAt` (sello de tiempo, actualizado con **cualquier**
dato recibido: heartbeat o evento de dominio) y el estado de conexión.

Tres disparadores de comprobación:

1. Un intervalo, para el caso de la pestaña abierta y en primer plano.
2. `visibilitychange` → `visible`: comprobación inmediata (FR-302).
3. `pageshow`: cubre la vuelta desde el bfcache, que es un camino distinto.

La comprobación siempre es la misma: `now - lastTrafficAt > 60s` ⇒ muerta
(research R5). Se compara reloj, no "cuántas veces disparó el intervalo"
(research R3).

Ante `error`, se mira `readyState` (research R4): `CONNECTING` significa que el
navegador ya reintenta y basta esperar; `CLOSED` significa fallo terminal —un
intento controlado y, si vuelve a cerrar, sesión terminada sin más reintentos
(FR-306).

Reconectar es cerrar y construir un `EventSource` nuevo, volviendo a registrar
los listeners; cuidado con no duplicarlos. Espera creciente 1→15 s, sin insistir
con la página oculta (research R6).

**Extracción para poder probarlo**: la decisión (dado el sello de tiempo, la
visibilidad, el `readyState` y el contador de intentos → qué hacer) se separa
del `EventSource` en una función pura con reloj inyectable. Es lo que hace
posible el nivel 1 de la verificación, y por eso se diseña así desde el
principio y no como refactor posterior.

### D3. Cliente: el catch-up que faltaba

`app-nav.tsx`, `lab-client.tsx` y `bookings-client.tsx` reciben catch-up
(FR-307). Las tres tienen ya su función de recarga llamable sin argumentos.

**Decisión de diseño**: en vez de confiar en que cada consumidor recuerde pasar
`onReconnect`, el hook lo pide de forma que olvidarlo no sea el camino fácil.
Este fallo es la prueba: tres de cinco consumidores lo olvidaron y nadie se
enteró. La forma exacta (obligatorio en el tipo, o un refetch por defecto) se
decide al implementar; el criterio es que el estado por defecto sea el correcto.

### D4. Cliente: decir la verdad

Un indicador de estado de conexión en la bandeja (FR-309, FR-310): *reconectando*
y *sin conexión*; "al día" no se adorna. Aparece con un pequeño retardo para que
las reconexiones limpias no produzcan parpadeo (FR-312), y **no se retira hasta
que el catch-up termina** (FR-311), no al reconectar.

### D5. Simulación de muerte silenciosa

Endpoint bajo `src/app/api/dev/` tras `src/lib/dev-guard.ts`: abre un stream SSE
válido y deja de escribir sin cerrarlo. Permite ejercer detección → aviso →
reconexión → catch-up con Playwright, de forma determinista.

## Project Structure

### Documentation (this feature)

```text
specs/018-reconexion-sse-resiliente/
├── spec.md
├── notas-para-el-plan.md
├── research.md            # Fase 0
├── plan.md                # este archivo
├── data-model.md          # Fase 1 (sin modelo: documenta por qué)
├── quickstart.md          # Fase 1
├── contracts/
│   └── sse-heartbeat.md   # delta aditivo del contrato SSE
└── tasks.md               # lo genera /speckit-tasks, no este comando
```

### Source Code (repository root)

```text
src/
├── app/api/
│   ├── events/route.ts              # + heartbeat observable (aditivo)
│   └── dev/                         # + simulador de muerte silenciosa (tras dev-guard)
├── components/
│   ├── use-events.ts                # el grueso: vigilante, reconexión, estado
│   ├── app-nav.tsx                  # + catch-up (contador de no leídos)
│   ├── inbox/inbox-client.tsx       # + indicador de conexión
│   ├── lab/lab-client.tsx           # + catch-up
│   └── bookings/bookings-client.tsx # + catch-up
└── lib/dev-guard.ts                 # sin cambios: se reutiliza

tests/
├── unit/                            # lógica de decisión con reloj falso
└── e2e/                             # guion de la historia + arnés
```

**Structure Decision**: monolito Next.js existente; no se crean módulos ni
carpetas nuevas. El cambio se concentra en un archivo de cliente
(`use-events.ts`) y una ruta de servidor, más el cableado del catch-up en tres
componentes y el indicador en uno.

## Verificación

Los tres niveles de la spec, con lo que este plan añade:

1. **Unidad (Vitest)**: la función pura de decisión con reloj inyectable.
   Silencio por debajo del margen no dispara; por encima sí; visibilidad fuerza
   comprobación inmediata; `CLOSED` no reintenta en bucle; el backoff crece y se
   reinicia al conectar.
2. **Escritorio (Playwright + mocks)**: con el simulador de D5, el camino
   completo. Extiende `scripts/e2e-selftest.mjs` en vez de dejar solo el `.md`.
3. **Dispositivo real, obligatorio**, con la feature desplegada en LanCo. **iOS
   reproduce el fallo** —y solo cuenta si se reprodujo (SC-009)—; **Android
   comprueba no regresión**. La asimetría está razonada en la spec.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El fallo de iOS no se reproduce el día de la prueba | Es el nivel 3 y depende del sistema operativo. La prueba determinista es el nivel 2; SC-009 obliga a registrar "no reproducido" en vez de dar por bueno un verde vacío. |
| Falsos positivos: declarar muerta una conexión viva | Margen de 60 s = dos heartbeats perdidos más jitter (R5); retardo del indicador (FR-312); SC-006 lo vigila en escritorio. |
| Duplicar listeners al reconectar | Reconstrucción completa del `EventSource` con registro único; cubierto en unidad. |
| Que el catch-up masivo al volver dispare recargas pesadas | Los refetch ya existen y son los mismos que se usan hoy; no se añade carga nueva por evento, solo en la reconexión. |

## Fuera de alcance

Lo de la spec, sin cambios: PWA (019), push (020), rediseñar el transporte,
replay en servidor, y notificar con la app en segundo plano.
