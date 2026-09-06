# 018 — Modelo de datos

**No hay cambios en el modelo de datos. Esta feature no añade migración y no
toca `drizzle/`.**

Se documenta expresamente en vez de omitir el archivo, porque de ello dependen
dos cosas:

- El **Principio X** (irreversibilidad) **no aplica**: no hay ensayo de
  migración que hacer, ni plan de reversión que declarar más allá del redeploy.
- La **puerta de promoción** de la constitución: su condición 4 ("si algún
  commit toca `drizzle/`, el ensayo del Principio X está hecho") **no se
  activará** para esta feature. El comando `/uniko-promote` lo detectará solo
  por el diff y no preguntará.

## Estado que sí introduce la feature

Todo es **estado efímero de cliente**, en memoria, dentro del hook
`use-events.ts`. No se persiste, no viaja al servidor y no sobrevive a una
recarga.

| Concepto | Qué es | Por qué existe |
|---|---|---|
| `lastTrafficAt` | Sello de tiempo del último dato recibido por el stream, sea heartbeat o evento de dominio | Es la señal de vida. Comparar reloj contra este valor es lo que detecta el silencio (FR-301) sin depender de que un temporizador haya disparado |
| Estado de conexión | `conectado` · `reconectando` · `sin conexión` · `sesión terminada` | Lo que la interfaz enseña (FR-309, FR-310) y lo que decide si se reintenta |
| Intentos de reconexión | Contador, para la espera creciente | FR-305: crecer hasta el tope y reiniciarse al conectar bien |
| Catch-up en curso | Booleano | FR-311: el aviso no se retira al reconectar, sino al terminar de refrescar |

Nada de esto es una entidad de dominio ni necesita esquema.

## Lo que viaja por el cable

El único añadido es el **evento de heartbeat con nombre**, sin carga útil
significativa. Su forma exacta está en
[`contracts/sse-heartbeat.md`](contracts/sse-heartbeat.md).
