# Implementation Plan: 020 — Notificaciones push cuando el agente escala

**Branch**: `020-notificaciones-push` · **Date**: 2026-09-07 · **Spec**:
[spec.md](./spec.md) · **ADR**: [ADR-003](../../docs/adr-003-notificaciones-push.md) ·
**Research**: [research.md](./research.md)

## Summary

Avisar al operador fuera de la app cuando el agente escala una conversación, con
un aviso **opaco** —sin ningún dato del negocio— entregado por el único camino
que existe (FCM/APNs), detrás de la bandera `PUSH` y apagado por defecto.

Dos cosas gobiernan el diseño, y no son la entrega:

1. **La migración es aditiva pura.** Dos tablas nuevas, cero cambios en lo
   existente. Es la primera feature desde la 016 que activa el Principio X, y
   sale de la manera más barata posible: agregar.
2. **El manejador de push no puede rozar la exclusión de `/api/events`.** Esa
   garantía la dejó la 019 comprobada con las dos mitades, y aquí se conserva por
   construcción, no por cuidado.

## Technical Context

**Language/Version**: TypeScript estricto sobre Node 22 · Next 15 (App Router)

**Primary Dependencies**: **ninguna nueva**. Las claves VAPID (P-256) y la firma
ES256 salen de `node:crypto`; el aviso va sin contenido, así que no hace falta
implementar el cifrado de payload (RFC 8291) ni traerse `web-push`

**Storage**: **dos tablas nuevas** (`push_subscription`, `push_key`). Nada
existente se altera

**Testing**: Vitest (nivel 1) · arnés E2E en navegador con mock del servicio de
entrega (nivel 2) · dispositivo real con app instalada y permiso (nivel 3)

**Target Platform**: Chrome/Android y Safari/iOS 16.4+ **con la app instalada**
(dependencia dura de la 019)

**Constraints**: el permiso se pide con gesto del usuario · el aviso no lleva
datos · el fallo del envío no cuesta la escalación · con la bandera apagada, nada
existe

**Scale/Scope**: tres instancias, un operador por instancia hoy

## Constitution Check

| Principio | Estado |
|---|---|
| **I. Seguridad** | El aviso es opaco: ningún dato de cliente atraviesa a un tercero. La clave privada se cifra con el mismo mecanismo que el token de WhatsApp (`token_cipher/iv/tag`) y no sale del servidor |
| **II. Soberanía** | Conector opcional con las cinco condiciones, decidido en el [ADR-003](../../docs/adr-003-notificaciones-push.md). Cero dependencias nuevas |
| **III. Multi-tenancy** | Las dos tablas llevan `organization_id` NOT NULL, índice org-first, y toda consulta pasa por `scoped()` |
| **IV. Idempotencia** | La suscripción se identifica por su `endpoint` (UNIQUE): reactivar el mismo teléfono no crea otra. Borrar una caducada dos veces da igual |
| **IX. Definición de Hecho** | Tres niveles, con el nivel 3 obligatorio y la regla de la 018: una corrida sin notificación recibida no cuenta |
| **X. Irreversibilidad** | **Aplica.** Hay migración → ensayo obligatorio contra respaldo real antes de `main`. El procedimiento no existía; se escribe en el [quickstart](./quickstart.md) |

**Complexity Tracking**: nada que declarar. La única complejidad no obvia
—firmar el JWT ES256 a mano en vez de usar `web-push`— existe para no añadir
dependencia, y es la mitad de código que tendría el camino con payload cifrado.

## Diseño

### D1. Qué se guarda: dos tablas nuevas, nada tocado

**Aditiva pura, confirmado leyendo el esquema.** No hace falta ninguna columna en
tablas existentes:

- El disparador es el handoff, que **ya se guarda** (`conversation.handoff_at`).
- No hace falta marca de "ya avisé": el pipeline calla con handoff activo, así
  que no hay segundo aviso que deduplicar (research R4).
- Las claves **no van en `organization.metadata`** aunque sea lo más corto: ese
  JSON se lee en cada render y viaja a la marca del cliente. Meter ahí una clave
  privada es ponerla a un descuido de salir al navegador.

```
push_subscription        push_key
  id            ps_…       id
  organization_id NN       organization_id NN UNIQUE
  user_id       NN         public_key
  endpoint      UNIQUE     private_cipher / private_iv / private_tag
  created_at               created_at
  last_ok_at
```

### D2. El aviso opaco, y el detalle que se pide en casa

El cuerpo que sale hacia FCM/APNs **va vacío**. El service worker, al recibirlo:

1. pide el detalle a **su propia instancia** (`GET /api/push/pendiente`), que
   responde con la conversación escalada más reciente y su nombre;
2. muestra la notificación con ese detalle;
3. si esa petición falla —sin red, sesión caducada—, muestra el texto degradado:
   **"Alguien necesita atención · El agente pasó una conversación a un humano.
   Ábrela para ver cuál."**

Que la petición salga del propio service worker tiene un efecto útil: **no
dispara su propio `fetch`**, así que no hay recursión ni interacción con el
enrutado estático.

### D3. Cómo convive el push con la exclusión de `/api/events`

Esto es lo que más importa del plan, así que va explícito.

La exclusión de la 019 vive en **dos sitios**, y el push no toca ninguno:

| Dónde | Qué hace | Qué le hace el push |
|---|---|---|
| `install` → `addRoutes(…, source: "network")` | Declara que `/api/events`, los webhooks y `/api/bot` van a la red **sin consultar al worker** | **Nada.** El bloque de push se añade *después* de las reglas, y `addRoutes` sigue siendo lo primero del `install` |
| `fetch` → salida temprana por `sw-scope` | Garantía para navegadores sin enrutado estático | **Nada.** El push llega por el evento `push`, que es otro evento: no pasa por el handler de `fetch` |

Dicho de otra forma: **un manejador de `push` no puede interceptar peticiones**.
Son eventos distintos del mismo worker. El riesgo real no es técnico sino humano
—alguien que, tocando este archivo para añadir push, reescriba el `fetch` de
paso—, y contra eso lo que hay es el arnés: **las dos mitades siguen
comprobándose en cada corrida**, y ahora también con la bandera encendida.

Se añade una comprobación más, barata: que el cuerpo servido con `PUSH` encendida
**siga conteniendo** las reglas de exclusión y la salida temprana.

### D4. Cómo se registra solo con la bandera encendida

El service worker **se genera en el servidor** (019), así que la bandera se
resuelve al servirlo:

- `PUSH` apagada → el cuerpo **no contiene** `addEventListener("push")` ni
  `notificationclick`. No hay nada que registrar y nada que pedir.
- `PUSH` encendida → el cuerpo los incluye.

Y como el cuerpo lleva el commit dentro (arreglo de la 019), **encender la
bandera cambia los bytes del archivo**: el navegador detecta versión nueva y el
worker se actualiza solo. Sin aquel arreglo, encender la bandera no habría
llegado a los teléfonos ya instalados — que es exactamente el fallo que se
arregló ayer, ahora en su primer uso real.

El resto de la superficie sigue el patrón de `agenda/flag.ts` y
`attribution/flag.ts`: `src/server/push/flag.ts` con `pushEnabled()` y el
`404` para las rutas cuando está apagada.

### D5. El adaptador, y qué sabe el dominio

`applyHandoff()` gana **una línea**: avisar de la escalación. Nada más. Detrás:

```
src/server/push/
  flag.ts        ¿existe esta feature en esta instancia?
  claves.ts      generar/leer el par VAPID (cifrado en reposo)
  vapid.ts       firmar el JWT ES256 con node:crypto
  enviar.ts      enviarAviso(suscripcion) → entregada | caducada | fallo
  avisar.ts      la capacidad de dominio: "avisa de esta escalación"
```

`avisar.ts` es el único que el dominio conoce, y su contrato está en
[contracts/push.md](./contracts/push.md). Reglas duras:

- **Nunca lanza.** Un fallo se registra y se traga: la escalación no depende de
  él (FR-504).
- **No bloquea.** El aviso sale después de que la escalación esté guardada.
- **`is_test` corta antes que nada** (FR-503): el guardarraíl del sandbox va en
  la primera línea, no en la última.
- **410 Gone → borrar la suscripción**, en el sitio.

### D6. Activar y desactivar, desde la app

Una tarjeta en Ajustes con un botón. Tres estados, decididos por una función
pura reutilizando `lib/platform` de la 019:

- **se puede** → botón "Activar avisos" (pide permiso **en el clic**, FR-509);
- **no se puede todavía** → explica que hace falta instalar la app (iOS);
- **ya está** → botón para desactivar, y el nombre del dispositivo si se sabe.

## Project Structure

```
specs/020-notificaciones-push/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
└── contracts/push.md

src/
├── server/push/{flag,claves,vapid,enviar,avisar}.ts   (N)
├── server/ai/pipeline.ts                              (M) una línea en applyHandoff
├── app/api/push/
│   ├── suscripcion/route.ts                           (N) alta y baja
│   ├── clave-publica/route.ts                         (N) la pública, para suscribirse
│   └── pendiente/route.ts                             (N) el detalle que pide el worker
├── app/api/sw/route.ts                                (M) bloque de push tras la bandera
├── components/settings/avisos-card.tsx                (N)
└── lib/db/schema.ts                                   (M) dos tablas nuevas

drizzle/0013_notificaciones_push.sql                   (N) aditiva
tests/unit/                                            (N) destinatarios · aviso opaco · vapid · claves
scripts/e2e-push.mjs                                   (N) nivel 2, con mock del servicio
```

## Verificación

### Nivel 1 — Unidad

Quién recibe (función pura, con el caso `is_test` → nadie) · el aviso construido
**no contiene** datos del negocio · el texto degradado · generación y cifrado de
claves · firma ES256 con un vector conocido.

### Nivel 2 — Local, con mock del servicio de entrega

Con la bandera **apagada**: rutas 404, el cuerpo del service worker **sin** nada
de push, y ninguna mención en la interfaz.

Con la bandera **encendida**: una escalación produce un envío y **su cuerpo va
vacío**; una escalación del Laboratorio no produce ninguno; un 410 borra la
suscripción; el servicio caído/lento no cuesta la escalación; y **las dos mitades
de la 019 siguen verdes con push activo**.

### Nivel 3 — Dispositivo real (OBLIGATORIO)

Con la regla de la 018: **una corrida sin notificación recibida no cuenta**. Las
cuatro preguntas que solo responde un teléfono están en el
[quickstart](./quickstart.md), incluida la de si iOS reemplaza o apila.

### Antes de `main`: el ensayo del Principio X

**Procedimiento nuevo, escrito en el [quickstart](./quickstart.md).** No existía:
se verificó que **ninguna de las tres bases de la flota tiene respaldos
programados en Coolify**. Ver "Riesgos".

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **La flota no tiene respaldos** (verificado: cero programaciones en las tres bases) | Excede esta feature y se reporta aparte. El ensayo del X obliga a producir uno, y de paso deja el procedimiento escrito |
| Un respaldo con datos de un cliente restaurado donde no debe | El procedimiento manda base desechable y borrado al terminar, y **prefiere el respaldo de LanCo** cuando sirva: es real y es nuestro |
| Alguien reescribe el `fetch` del worker al añadir push | El arnés comprueba las dos mitades **y** que el cuerpo conserva las reglas de exclusión |
| Rotar las claves deja al equipo sin avisos | Es requisito (FR-517): se dice donde se rota, no en la documentación |
| iOS apila en vez de reemplazar | La spec funciona en los dos casos; el nivel 3 lo registra |

## Fuera de alcance

Lo de la spec, sin cambios.

## Contradicciones con la spec

Ninguna. El plan **confirma** el supuesto que la spec daba por cierto —la
migración puede ser aditiva pura— y cierra el "dónde viven las claves" con una
tabla propia en vez de `organization.metadata`, por seguridad y no por gusto.
