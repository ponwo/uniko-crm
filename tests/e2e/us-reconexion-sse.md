# E2E — 018: reconexión resiliente del SSE

Guion de la historia. El nivel 1 son los tests unitarios; el nivel 2 está
automatizado en `scripts/e2e-sse-reconexion.mjs` (navegador real, encadenado en
`pnpm test:e2e`); el nivel 3 es manual y **obligatorio** por el Principio IX: el
fallo no se reproduce en `localhost`.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

## Nivel 2 — escritorio, con muerte silenciosa simulada ✅ AUTOMATIZADO

Con la app viva y los mocks encendidos, `pnpm test:e2e` conduce esto contra la
app real usando el simulador (`/api/dev/sse-mudo`, tras `dev-guard`, 404 en
producción). Sale distinto de cero si algo falla.

- [x] La bandeja arranca conectada y sin aviso.
- [x] El stream enmudece **sin cerrarse**: no llega `error` y `readyState` sigue
      en OPEN — se comprueba por sus consecuencias: el navegador no reconecta por
      su cuenta y el mensaje del hueco no aparece.
- [x] Pasado el margen de silencio, la app lo detecta y **muestra el aviso**.
- [x] Reconecta sola.
- [x] Hace el catch-up y el aviso **desaparece solo entonces**, no al reconectar.
- [x] Los mensajes que entraron durante el hueco están, **sin duplicados** (en
      pantalla y en la base).
- [x] Camino infeliz: sin red se avisa, no se reintenta en bucle apretado, y se
      recupera al volver la red trayendo lo del hueco.
- [x] Una reconexión limpia y rápida (~200 ms) **no** produce parpadeo del aviso.

> Matiz encontrado al automatizarlo: sin red y con la pestaña delante el aviso
> dice *Reconectando…*, no *Sin conexión*. El navegador sigue reintentando solo
> (`readyState` CONNECTING) y el vigilante lo deja —no duplicar reconexiones es
> deliberado (research R4)—. *Sin conexión* corresponde a la pestaña oculta. El
> operador se entera igual, que es lo que la historia pedía.

### Corrida — 2026-09-07 ✅ VERDE (25/25)

| Dato | Valor |
|---|---|
| Dónde | máquina de desarrollo, `localhost:3000` con `WA_MOCK_ENABLED=true` |
| Commit | rama `infra/desarrollo-local` |
| Detección de la muerte silenciosa | a los **71 s** del hueco (margen 60 s + pasada del vigilante) |
| Qué se vio | *Poniendo al día…* durante el refresco, y el aviso retirándose al terminar |
| Mensaje del hueco | recuperado, **una sola vez** en pantalla y en la base |
| Sin red | *Reconectando…* a los ~3 s; ~1 reintento cada 3 s por suscripción |

## Nivel 3 — dispositivo real (OBLIGATORIO)

Contra **LanCo desplegada** (`https://uniko.lanco.cloud`), nunca `localhost`.
No se comprueba lo mismo en cada plataforma.

### iOS — reproducir el fallo

- [ ] Abrir la bandeja en Safari en un iPhone.
- [ ] Mandar la app a segundo plano varios minutos, lo bastante para que el
      sistema la congele.
- [ ] Que entre un mensaje real durante el hueco.
- [ ] Volver a primer plano.
- [ ] **El mensaje aparece**, y en ningún momento la pantalla afirmó estar al día
      sin estarlo.

**¿Se reprodujo el fallo silencioso?** → ☑ **Sí** (2026-09-06) ☐ No

Si **No**, esta corrida **no cuenta** como verificación (SC-009): se ejerció el
camino que ya funcionaba antes. Repetir alargando el tiempo en segundo plano, o
registrarlo explícitamente como "no reproducido". Un verde sin fallo reproducido
es ruido.

### Android — reproducir el fallo, igual que en iOS

*(Corregido 2026-09-07 con la corrida real: aquí decía que el fallo no estaba
reportado en Android y que bastaba comprobar no regresión. Se reprodujo.)*

Mismo criterio que en iOS: una corrida en la que el fallo **no** se reproduzca no
cuenta como verificación. Además, lo propio de esta plataforma:

- [ ] El ciclo normal (segundo plano → mensaje → volver) deja la vista al día.
- [ ] El **contador de no leídos** de la barra coincide con la bandeja.
- [ ] No aparecen reconexiones espurias ni parpadeo del aviso.
- [ ] El aviso sale cuando de verdad no hay red, y se va al volver.

## Registro de la corrida

### iOS — 2026-09-06 ✅ VERDE

| Dato | Valor |
|---|---|
| Fecha | 2026-09-06 |
| Commit desplegado en LanCo | `3838181` |
| **¿Fallo reproducido?** | **Sí** |
| Tiempo en segundo plano | varios minutos |
| Versión de iOS | *no registrada* |
| Qué entró durante el hueco | un mensaje de WhatsApp real, al número conectado de LanCo |
| Qué se vio al volver | primero el aviso de **reconectando**, después el mensaje en la bandeja |

**Lectura**: es un verde de los buenos, no un falso positivo. El aviso apareció
*antes* que el mensaje, lo que significa que la conexión estaba efectivamente
muerta al volver, que se detectó, y que el catch-up trajo lo que se había
perdido. Si el mensaje hubiera aparecido sin aviso previo, habría sido un "no
reproducido" y no contaría (SC-009).

El fallo silencioso de iOS se reprodujo y la feature lo resolvió.

### Android — 2026-09-07 ✅ VERDE, **y el fallo también se reprodujo**

| Dato | Valor |
|---|---|
| Fecha | 2026-09-07 |
| Commit desplegado en LanCo | `3838181` |
| **¿Fallo reproducido?** | **Sí** — no se esperaba |
| Tiempo en segundo plano | unos minutos |
| Versión de Android | *no registrada* |
| Qué entró durante el hueco | un mensaje de WhatsApp real, al número conectado de LanCo |
| Qué se vio al volver | primero el aviso de **reconectando**, después el mensaje en la bandeja |

**Esto contradice lo que habíamos escrito.** La spec asumía que Chrome en
Android normalmente sí notifica el cierre, y por eso esta plataforma se planteó
como criterio de *no regresión* y no de reproducción. En la práctica se comportó
igual que iOS: la conexión murió en silencio y hubo que detectarla.

La suposición era nuestra, no de una fuente. El reporte de iOS 18 documentaba
iOS, y de ahí dedujimos —sin comprobarlo— que Android estaba a salvo. Corregido
en la spec.

**Consecuencia buena**: la feature sirve para más plataformas de las que
creíamos. Vigilar el silencio protege en las dos, y eso refuerza la decisión de
no apoyarse en `error` ni en `readyState` en ninguna.
