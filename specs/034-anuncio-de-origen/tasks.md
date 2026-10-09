# Tasks — 034 De qué anuncio llegó cada conversación

Puerto de la 018 de Vocero. Las tareas siguen las de su `tasks.md`; las que dicen
«puerto» se hicieron con la fusión a tres vías de sus commits, las demás son propias de
Uniko (ver [plan.md](plan.md), Desvíos del puerto).

## Datos

- [x] T001 `image_asset_id` e índice `ad_attribution_org_source_idx` en `schema.ts` (puerto)
- [x] T002 `pnpm db:generate` → `0019_anuncio_de_origen`, editada re-ejecutable
- [x] T003 Ensayo del Principio X con respaldos reales (quickstart §4: ILTU, NuriaAndrea y uniko-lanco; registro allí)

## Servidor

- [x] T004 `referral.ts`: normalización pura del referral de WhatsApp, con cotas (puerto)
- [x] T005 `creativo.ts`: URL permitida, descarga acotada con reintento, copia única por anuncio (puerto; descargas en curso en `globalThis`)
- [x] T006 `deleteMediaFile` en `server/whatsapp/media.ts` (puerto)
- [x] T007 `store.ts`: registrar (sin `ctwa_clid` con la bandera apagada), leer, reparar con freno, serializar (puerto)
- [x] T008 Ingesta: captura siempre, antes del dedup, sin romper el mensaje (puerto)
- [x] T009 `queries.ts` y rutas: anuncio en la lista, el detalle y el evento SSE (puerto; condición y columnas como funciones)
- [x] T010 Fuente deducida «anuncio» (puerto)

## UI

- [x] T011 `lib/anuncios.ts` y `components/anuncio-origen.tsx` (puerto)
- [x] T012 Marca y filtro «Anuncios» en la lista (puerto, con el import de íconos de Uniko)
- [x] T013 Tarjeta en el panel del contacto (junto al diálogo de «Perdido» de #64) y en el cajón del trato

## Mocks, pruebas y documentación

- [x] T014 wa-mock: `referral` libre en el inbound; creativos de prueba en `media-file` (contador en `globalThis`)
- [x] T015 Unitarias: normalización, URL permitida, descarga, bandera, freno de reparación (puerto)
- [x] T016 Arnés: sección 034, `hasta()`, y la 016 apagada comprueba el origen visible sin clic
- [x] T017 Guion de navegador con capturas (llaves de Uniko)
- [x] T018 `flag.ts`, `docs/atribucion-capi.md`, `tests/e2e/us-atribucion.md`, `.env.example`, `README.md`, `CLAUDE.md`, enmienda en FR-001 de 016, `specs/README.md`
- [x] T019 Gate técnico, `pnpm test:e2e` con la bandera apagada y encendida, guion de navegador
- [ ] T020 PR con el registro del ensayo X y el plan de reversión
- [ ] T021 (dueño) Merge → `uniko-lanco`; promoción con la puerta completa; en ILTU, las conversaciones de anuncio con su tarjeta (SC-006)

## Verificación (2026-10-09, local, Postgres 16 y `next dev`, base nueva por corrida)

- Gate: `typecheck`, `lint`, `build` y `test` (112 archivos, 1079 pruebas) en verde.
- `pnpm test:e2e` con `ATRIBUCION` **apagada**: los 11 guiones en verde; el self-test
  218/218 (la sección 034 son 26 comprobaciones; la 016 apagada suma 2).
- `pnpm test:e2e` con `ATRIBUCION=on`: el self-test 239/239 y los otros 10 guiones en
  verde. La primera vuelta cortó en `e2e-sse-reconexion` (25/26: «un corte de ~200 ms
  NO enseña el aviso»): `next dev` había descartado `/api/conversations` y su primera
  llamada tardó 5,2 s en recompilar, más que los 2 s de gracia del aviso; ya compilada
  responde en ~90 ms con el `LEFT JOIN` nuevo. Con esas rutas calientes, el resto de la
  cadena (de `sse-reconexion` a `dataset-desde-meta`) salió en verde: 26/26 … 20/20.
- `scripts/e2e-anuncio-origen-ui.mjs`: 32/32 apagada y 32/32 encendida, claro y oscuro,
  1440 y 390 px.
- Ensayo del Principio X: quickstart §4.
