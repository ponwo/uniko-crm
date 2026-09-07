# E2E — 018: reconexión resiliente del SSE

Guion de la historia. Los niveles 1 y 2 están (o estarán) automatizados en
`scripts/e2e-selftest.mjs`; el nivel 3 es manual y **obligatorio** por el
Principio IX: el fallo no se reproduce en `localhost`.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

## Nivel 2 — escritorio, con muerte silenciosa simulada

Con la app viva y los mocks encendidos, `pnpm test:e2e` conduce esto contra la
app real usando el simulador (`/api/dev/sse-mudo`, tras `dev-guard`, 404 en
producción).

- [ ] La bandeja arranca conectada y sin aviso.
- [ ] El stream enmudece **sin cerrarse**: no llega `error` y `readyState` sigue
      en OPEN.
- [ ] Pasado el margen de silencio, la app lo detecta y **muestra el aviso**.
- [ ] Reconecta sola.
- [ ] Hace el catch-up y el aviso **desaparece solo entonces**, no al reconectar.
- [ ] Los mensajes que entraron durante el hueco están, **sin duplicados**.
- [ ] Camino infeliz: sin red aparece *sin conexión*, no se reintenta en bucle
      apretado, y se recupera al volver la red.
- [ ] Una reconexión limpia y rápida **no** produce parpadeo del aviso.

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

### Android — comprobar no regresión

El fallo silencioso **no está reportado** en Android. Si no se reproduce, es lo
esperado: **no fuerces la narrativa**.

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

### Android — pendiente

Criterio de **no regresión**, no de reproducción. Ver la lista de arriba.

| Dato | Valor |
|---|---|
| Fecha | |
| Commit desplegado en LanCo | |
| ¿Ciclo normal deja la vista al día? | |
| ¿Contador de no leídos coincide? | |
| ¿Avisos espurios o parpadeo? | |
| Versión de Android | |
