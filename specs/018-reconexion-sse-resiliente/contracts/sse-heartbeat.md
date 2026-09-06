# Contrato — delta aditivo del canal SSE

Amplía [`specs/001-uniko-core/contracts/sse.md`](../../001-uniko-core/contracts/sse.md).
**Solo añade.** Nada de lo que ese contrato ya promete cambia de forma ni
desaparece.

## Por qué hace falta

El heartbeat actual es un **comentario** (`: ping`) cada ~25 s. Mantiene viva la
conexión frente a proxies que cortan por inactividad —para lo que se puso— pero
la especificación HTML manda ignorar las líneas que empiezan por `:`, sin
despachar evento ni tocar estado observable. Es decir: **el cliente no puede
saber que llegó**, y por tanto no puede distinguir "conexión sana y silenciosa"
de "conexión muerta".

Ver [`research.md` R1](../research.md).

## El añadido

Junto al `: ping` que se sigue enviando en el mismo tic, el servidor emite un
**evento con nombre**. La forma concreta (nombre del evento y contenido de
`data`) la fija la implementación; el contrato exige tres cosas:

1. **Es un evento con nombre**, no un comentario, para que un
   `addEventListener` del cliente pueda verlo.
2. **Se emite al mismo ritmo que el heartbeat existente** (~25 s), de modo que
   el silencio prolongado signifique lo mismo que hoy significa a nivel de red.
3. **No transporta información de dominio.** Es una señal de vida. Un cliente
   que lo reciba y lo descarte se comporta correctamente.

## Compatibilidad

**Aditivo, sin ruptura.** Un `EventSource` solo entrega los eventos con nombre
para los que hay un `addEventListener` registrado; los demás los descarta en
silencio. Un cliente escrito contra el contrato anterior —que no conoce este
evento— sigue funcionando exactamente igual.

Se mantiene el `: ping` en vez de sustituirlo. Sustituirlo también sería seguro
a nivel de aplicación, pero la spec lo excluye a propósito (FR-313) y el coste
de conservar ambos es de unas decenas de bytes cada 25 s por conexión.

## Lo que NO cambia

- Cabeceras de la respuesta y anti-buffering.
- Formato y nombres de los eventos de dominio (`message.new`,
  `message.status`, `conversation.updated`, `lab.run`, `booking.updated`).
- El `: conectado` inicial.
- **El servidor sigue sin garantizar replay.** El catch-up es del cliente, por
  refetch — decidido en la spec y no revisado aquí.
- La autenticación: `/api/events` sigue exigiendo sesión y respondiendo **401**
  sin ella. El cliente se apoya en ello (FR-306) sin que haga falta añadir nada.

## Al implementar

`specs/001-uniko-core/contracts/sse.md` se actualiza en el **mismo PR** para
recoger este añadido, y el Constitution Check del PR lo menciona: es un contrato
publicado, aunque el cambio sea aditivo.
