---
name: borrador-por-conversacion-pr72
description: "Borrador por conversación en el compositor (PR #72): el texto ya no viaja de un contacto a otro al cambiar de hilo. Mergeada (d6f2bc3), probada por el dueño en uniko-lanco y PROMOVIDA a production en d6f2bc3 el 2026-10-10, flota 3/3. Por qué en el navegador y no en la base."
metadata:
  type: project
---

**El problema (reporte del dueño, 2026-10-10)**: la caja de escritura de la
Bandeja es una sola para todas las conversaciones y su texto se quedaba puesto
al cambiar de hilo; un Ctrl+Enter lo mandaba al contacto equivocado. Además, un
envío que fallaba DESPUÉS de cambiar de conversación devolvía el texto a la caja
de la conversación abierta, que ya era la de otro.

**La decisión**: un borrador por conversación, como WhatsApp Web, en vez de
borrar al cambiar. Borrar quitaba el riesgo igual, pero castigaba el uso más
común: ir a otro hilo a revisar algo (qué precio se le dio a otro cliente) y
volver. Lo que protege es amarrar el texto a su conversación, no borrarlo.

- Vive en el navegador (`localStorage`, llave
  `uniko.borrador.<userId>.<conversationId>`), NO en la base: un borrador es de
  quien lo escribe; en el servidor lo vería el compañero que atiende el mismo
  chat y costaría tabla + migración. Por usuario para que, en una computadora
  compartida, quien entra después no herede los del anterior. Consecuencia
  aceptada: no viaja entre dispositivos.
- Vigencia de 30 días sin tocarse (decisión mía, avisada al dueño; se cambia en
  `DRAFT_TTL_MS`). Sincronía entre pestañas por el evento `storage`. Si el
  navegador niega el almacenamiento, sigue en memoria durante la sesión.
- El compositor lee el texto del almacén con `useSyncExternalStore`
  (`src/components/inbox/drafts.ts`); la lista observa una firma que EXCLUYE la
  conversación abierta, para no repintarse al teclear. La abierta no se marca
  «Borrador:» porque ya está en la caja.
- Al cambiar de hilo también se cierran los formularios de ubicación y contacto
  (los adjuntos ya se descartaban).

**Verificación**: gate verde (1090 tests, 11 del almacén);
`scripts/e2e-borradores.mjs` 31/31, ya en la cadena `test:e2e` (usa
`page.route` para simular el POST que falla y teclea letra por letra para
comprobar que el input controlado por el almacén no pierde letras ni mueve el
cursor); `e2e-envio-instantaneo` 16/16, `e2e-plantillas-por-canal` 11/11,
`e2e-selftest` 218/218. El dueño lo probó en uniko-lanco («funciona»).

**Promoción**: puerta con `/uniko-promote` — mecanizables en verde para
`d6f2bc3` (LanCo en ese commit, CI en toda la matriz, 6 commits, sin
`drizzle/`); uso real declarado por el dueño; la condición 3 la cerró su prueba
en LanCo (los mocks dan 404 allá); reversión = revertir el commit (sin
migraciones). `git push origin main:production` (`f9605f2..d6f2bc3`) hacia las
03:21 UTC del 2026-10-11 (21:21 del 10 en hora de la máquina, UTC−6); ILTU y NuriaAndrea en
`d6f2bc3` ~8 min después, `verify-fleet.sh` 3/3 y seis lecturas seguidas
estables.

**Why:** quien toque el compositor debe saber que el texto ya no es estado
local: es el borrador del almacén, y todo lo que lo limpie o devuelva debe ir
al de la conversación de ORIGEN, no a la abierta.
**How to apply:** si piden borradores entre dispositivos, eso sí exige servidor
(y decidir qué ve el compañero). Ver [[worktree-y-arneses-en-la-maquina-de-desarrollo]].
