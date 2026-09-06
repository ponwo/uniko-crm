# 018 — Notas para el plan

Decisiones de implementación que aparecieron al escribir la spec y que **no
entran en ella**: la spec dice qué ve el usuario, esto es cómo podría
conseguirse. Nada de aquí está decidido; son las preguntas que el `/plan` tiene
que resolver, con lo que ya se sabe de cada una.

## 1. Dónde vive la lógica

Todo apunta a `src/components/use-events.ts`, que hoy es el único punto donde se
crea el `EventSource`. Concentrar ahí la vigilancia y la reconexión hace que los
cinco consumidores hereden el arreglo sin tocarlos. Alternativa peor: repartirlo
por consumidor.

Consecuencia: el hook pasa de "suscríbete y olvida" a tener estado propio
(vivo / reconectando / caído). Ese estado hay que exponerlo, porque FR-309 pide
enseñarlo. Decidir la forma: valor de retorno del hook, contexto de React, o un
componente aparte que se suscriba al mismo estado.

## 2. El margen de silencio

El servidor manda `: ping` cada 25 s (`HEARTBEAT_MS` en
`src/app/api/events/route.ts`). El margen tiene que ser varias veces eso para no
declarar muerta una conexión por una pausa normal, pero no tanto que el operador
espere minutos. Rango a valorar: 60–90 s.

Ojo: **el comentario `: ping` llega al `EventSource` pero no dispara ningún
handler de evento con nombre.** Hay que comprobar si el navegador expone algo
observable al recibir un comentario. **Esto es lo primero que el plan debe
verificar**: de la respuesta depende si la feature es solo de cliente o también
de servidor.

Si no es observable, la salida es añadir un evento con nombre **junto** al
`: ping` actual. Eso está permitido dentro de esta feature (FR-313 lo dice
expresamente) porque es **aditivo**: un `EventSource` ignora los eventos con
nombre que no tiene registrados, así que ningún cliente existente se rompe. No
lo trates como un obstáculo mayor ni como motivo para replantear el alcance.
Lo que sí queda fuera es sustituir el `: ping` o cambiar el formato de los
eventos que ya existen. Si se toca, `contracts/sse.md` se actualiza en el mismo
PR.

## 3. Regreso a primer plano

`visibilitychange` es el candidato obvio; `pageshow` cubre el caso del bfcache,
que es distinto y también aplica al volver atrás en el historial. Probablemente
hagan falta los dos. Añadir `online`/`offline` es tentador y poco fiable en
móvil: no sustituye a la vigilancia por silencio, como mucho la adelanta.

## 4. Reconectar de verdad

`EventSource` no se puede "reabrir": hay que `close()` y construir uno nuevo.
Eso significa que el hook debe poder recrear la suscripción sin desmontar al
consumidor, y que los `addEventListener` se vuelven a registrar. Cuidado con
duplicar listeners si se reconecta varias veces.

Backoff (FR-305): incremental con tope, y reinicio del contador al conectar bien.
Mientras `document.hidden`, no insistir.

## 5. El catch-up que falta

`app-nav.tsx`, `lab-client.tsx` y `bookings-client.tsx` no pasan `onReconnect`.
**Ya no es un hallazgo pendiente de decidir: están dentro del alcance** (FR-307
y su decisión en la spec). Los tres tienen su función de refetch a mano
(`refetchUnread`, `refresh`, `refetchRuns`), así que es cablear lo que existe.

Cuestión de diseño que sí queda abierta: si el hook debería disparar el catch-up
**por defecto** en vez de depender de que cada consumidor pase `onReconnect`.
Este fallo es la prueba de que un contrato que se cumple recordándolo se
erosiona — tres de cinco consumidores lo olvidaron. Un diseño donde olvidarlo
sea imposible vale más que uno donde esté documentado.

## 6. `since=` contra refetch completo

El contrato y el comentario del hook dicen `since=`; la bandeja hace refetch
completo. Hay que alinear documentación y código. Recomendación: que gane el
refetch completo (más seguro ante duda sobre qué se perdió) y corregir
`contracts/sse.md` y el comentario. Si el plan prefiere `since=`, entonces hay
que decidir de dónde sale el timestamp tras un hueco largo.

Si se toca `contracts/sse.md`, recordar que es un contrato publicado: el cambio
va en el mismo PR y se dice en el Constitution Check.

## 7. El modo de prueba de muerte silenciosa

Lo que hace falta es un stream que deje de escribir sin cerrarse. Formas
posibles: un parámetro en `/api/events` que corte el heartbeat pasados N
segundos, o un endpoint aparte en `src/app/api/dev/`. Lo segundo encaja mejor
con lo que ya existe (los mocks viven ahí, tras `src/lib/dev-guard.ts`, con 404
incondicional en producción) y evita meter una rama de prueba en una ruta de
producción.

Requisito duro: no debe poder activarse en producción. El gate ya existe;
usarlo, no inventar otro.

## 8. Riesgo de parpadeo (FR-312)

Una reconexión rápida no debe pintar aviso. Sugerencia: retrasar la aparición
del indicador un par de segundos, de modo que las reconexiones limpias pasen
inadvertidas. Es la clase de detalle que decide si el aviso se lee o se ignora.

## 9. Qué se puede probar sin dispositivo

La lógica de decisión (silencio, visibilidad, 401, backoff) es pura si se separa
del `EventSource`. Extraerla a una función con reloj inyectable es lo que hace
posible el nivel 1 de la verificación. Vale la pena diseñarla así desde el
principio, no como refactor posterior.
