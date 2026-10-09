# Quickstart — 034 De qué anuncio llegó cada conversación

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Las unitarias de la feature viven en `tests/unit/anuncio-origen.test.ts`
(normalización, URL permitida, descarga, bandera, freno de reparación, etiquetas).

## 2. Arnés, con la bandera apagada y encendida

Una base nueva por corrida (el ingest idempotente salta lo que ya vio), `next dev` con
los mocks y las rutas calientes:

1. `DATABASE_URL` → `uniko_dev_034_off` y `pnpm db:dev`; `pnpm dev` **sin**
   `ATRIBUCION`; `pnpm test:e2e`.
2. `DATABASE_URL` → `uniko_dev_034_on` y `pnpm db:dev`; `ATRIBUCION=on` en `.env`;
   reiniciar `pnpm dev`; `pnpm test:e2e`.

La sección `034` de `e2e-selftest.mjs` corre en las dos (captura, `hasCtwaClid` según la
bandera, el `ctwa_clid` que no sale, fuente deducida, reentregas, imagen compartida, las
cuatro URLs hostiles, el reintento y la reparación). La 016 apagada comprueba además que
el origen se ve sin el clic.

## 3. Guion de navegador

Con la app de la corrida anterior viva (después del arnés: el guion conecta WhatsApp
con su propio número, `PN-ANUNCIO-UI`):

```bash
node --env-file=.env scripts/e2e-anuncio-origen-ui.mjs
```

Lista, filtro, panel y cajón, en claro y oscuro, a 1440 y 390 px; capturas en
`scratch/anuncio-origen/`.

## 4. Ensayo del Principio X (antes de `main`)

Un Postgres **desechable** local con respaldos reales restaurados. Nunca contra una
instancia viva.

1. Crear una base desechable por respaldo y restaurar (`pg_restore --no-owner`).
2. Contar filas por tabla y, en `ad_attribution`, las filas con `ctwa_clid` y con imagen
   en el `raw`.
3. Aplicar las migraciones de la rama (`node scripts/migrate.mjs` con `DATABASE_URL` →
   la desechable).
4. Comprobar: la columna existe, es nullable, con su clave `ON DELETE SET NULL` y su
   índice; **todas** las filas siguen con `image_asset_id` nulo; los conteos no
   cambiaron; el `raw` y el `ctwa_clid` de las filas de 016 quedan intactos.
5. Re-ejecutar las migraciones: no hace nada (idempotente).
6. Con las filas reales: la consulta de la lista y la del detalle las traen como
   anuncio, el `ctwa_clid` no aparece en lo serializado, y el host de la URL de imagen
   que Meta mandó pasa `urlDeCreativoPermitida` (sin imprimir contenido de clientes:
   solo conteos, booleanos y hosts).
7. Arrancar la app contra esa base (`/api/health` 200).
8. Borrar las bases desechables.

Reversión declarada: redesplegar el commit anterior. La columna, su clave y su índice
quedan sin uso; el código viejo no los nombra.

### Registro del ensayo (2026-10-09, antes de `main`)

Postgres 16 local, tres bases desechables con volcados reales:

- `ensayo_034_iltu`: ILTU, «Back up now» del 2026-10-01 (`pg-dump-uniko-1790863580.dmp`).
- `ensayo_034_nuria`: NuriaAndrea, «Back up now» del 2026-10-01 (`pg-dump-uniko-1790863669.dmp`).
- `ensayo_034_d1006`: respaldo programado del 2026-10-06 03:00 UTC
  (`pg-dump-uniko-1791255607.dmp`), con una organización que no es ni la de ILTU ni la
  de NuriaAndrea: por descarte, la instancia de pruebas (`uniko-lanco`).

| | ILTU | NuriaAndrea | uniko-lanco |
|---|---|---|---|
| `pg_restore` | exit 0 | exit 0 | exit 0 |
| Migraciones registradas | 17 → 20 | 17 → 20 | 18 → 20 |
| Tablas / filas por tabla | 34, idénticas | 34, idénticas | 34, idénticas |
| Filas de `ad_attribution` (con `ctwa_clid`) | 0 | 2 (2) | 0 |
| Huella de `ad_attribution` (`id`, `ctwa_clid`, `raw`) | igual | igual | igual |
| `image_asset_id` | `text`, nullable, todas nulas | ídem | ídem |
| Clave foránea / índice | `SET NULL` / `ad_attribution_org_source_idx` | ídem | ídem |
| Re-ejecutar las migraciones | sin cambios | sin cambios | sin cambios |
| La build de producción arranca (`/api/health`) | 200 | 200 | 200 |

- El SQL de la `0019` corrido **a mano dos veces más** sobre la base de NuriaAndrea: exit
  0 con los avisos «ya existe, omitiendo»; una sola clave y un solo índice.
- **Paso 6, con las 2 filas reales de NuriaAndrea** (el código de la rama corriendo en
  proceso contra la base restaurada): la lista trae 2 de 84 conversaciones como anuncio;
  el detalle, con titular, enlace https, tipo `ad` y medio `image`; `hasCtwaClid` es
  `true` con la bandera y `false` sin ella; el valor del `ctwa_clid` no aparece en nada
  de lo serializado. Las URLs de imagen que Meta mandó son de
  `scontent.*.fna.fbcdn.net` y **pasan** el filtro de hosts; la descarga sale
  `permanente` porque Meta ya las caducó (son de septiembre): esas dos tarjetas quedan
  sin imagen, como prevé la spec.
- Dato de la flota que salió aquí: **NuriaAndrea también atribuye** (sus 2 filas traen
  `ctwa_clid`).
- El respaldo de ILTU es anterior a sus anuncios (empezaron el 2 de octubre): sus filas
  reales no entraron al ensayo. Sus conversaciones de anuncio tienen la misma forma que
  las de NuriaAndrea (mismo webhook, mismo `raw`).

Bases de ensayo borradas al terminar.

## 5. Tras el merge

- `uniko-lanco`: `/api/health` con el commit nuevo y `[migrate] migraciones aplicadas`.
- Tras la promoción, en ILTU (`ATRIBUCION=on`): las conversaciones de anuncio que 016 ya
  guardó salen con su tarjeta y la marca «Anuncio · titular»; su imagen aparece al abrir
  el contacto solo si Meta no caducó la URL. Un clic nuevo trae su creativo (SC-006).
