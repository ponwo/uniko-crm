---
name: anuncio-de-origen-034
description: "034 (de qué anuncio llegó cada conversación, puerto de la 018 de Vocero): PR #68 MERGEADA (5e6c38c) y desplegada en uniko-lanco el 2026-10-09, 0019 aplicada; NO promovida (promoción = señal del dueño). Cómo se portó desde Vocero y gotchas que salieron."
metadata:
  type: project
---

Lado visible de la atribución: marca «Anuncio · titular» y filtro en la Bandeja, tarjeta
con el creativo en el panel y en el cajón del trato. Nació de la pregunta del dueño
«¿cómo sabemos el `ctwa_clid` de un mensaje?» (2026-10-09). **El valor del `ctwa_clid`
sigue sin salir por API** (decisión D2 heredada): para verlo hay que leer
`ad_attribution.ctwa_clid` en la base (respaldo restaurado en local). Migración `0019`.
Estado: **PR #68 mergeada** por el dueño el 2026-10-09 (`5e6c38c`, CI verde) y
desplegada en `uniko-lanco` (`/api/health` con el commit, `[migrate] migraciones
aplicadas`); **no promovida**. `uniko-lanco` no tiene conversaciones de anuncio: la
tarjeta se verá en vivo hasta un clic real o, tras la promoción, en ILTU.

Cómo se portó (sirve para traer más cosas de Vocero, `ponwo/vocero-crm`): clonar Vocero
en el scratchpad, `git fetch <clon> <rama>` desde el worktree de Uniko (solo trae los
objetos) y `git apply --3way` con el diff de sus commits: como los blobs de antes ya
están, casi todo entra limpio porque la 016 es idéntica salvo la marca. Después,
renumerar las referencias de feature (su 018 ≠ nuestra 018) y regenerar la migración con
`pnpm db:generate` (sus números de `drizzle/` chocan con los nuestros).

Gotchas verificados:
- **`plantillas-por-canal.test.ts` simula `@/lib/db` a medias** para probar
  `serializeConversation`: cualquier constante de módulo en `inbox/queries.ts` que lea el
  esquema (p. ej. `schema.adAttribution.id`) la tumba al importar. En ese archivo, las
  expresiones de Drizzle van dentro de funciones.
- **`e2e-sse-reconexion` «un corte de ~200 ms NO enseña el aviso»** cae si `next dev`
  descartó `/api/conversations`: su recompilación tarda ~5 s y el aviso aparece a los 2 s.
  No es la consulta (compilada, ~90 ms). Calentar también las rutas de la app (un GET
  sin sesión, 401, basta para mantenerlas compiladas), no solo las de los mocks.
- **Respaldos en la máquina**: `Downloads/pg-dump-uniko-1791255607.dmp` (programado,
  2026-10-06) es de **uniko-lanco**, no de ILTU; el de ILTU en `BackUps/` es del 10-01,
  anterior a sus anuncios. Para ensayar con las filas de anuncio de ILTU hace falta un
  volcado nuevo. **NuriaAndrea también atribuye**: tiene 2 filas con `ctwa_clid` (de
  septiembre; sus URLs de imagen ya caducaron).
- El guion `e2e-anuncio-origen-ui.mjs` conecta WhatsApp con `PN-ANUNCIO-UI`: correrlo
  DESPUÉS de `pnpm test:e2e`, no antes ni a la vez.

**Why:** cada punto costó una corrida; el del ensayo evita creer que se probó con los
anuncios de ILTU.
**How to apply:** para el merge y la promoción, ver el PR #68 (ensayo X y reversión).
Antes de un arnés completo en esta máquina, ver también
[[worktree-y-arneses-en-la-maquina-de-desarrollo]] y [[catalogo-pdf-032]].
