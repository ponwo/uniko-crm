# Quickstart — 027 Plantillas: verificación

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Tareas**: [tasks.md](tasks.md)

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Registro 2026-09-15 (rama `027-plantillas-espejo-de-meta`, máquina de
desarrollo, Node 22): typecheck ✓ · lint ✓ · test **721/721** (83 archivos;
57 nuevos entre `templates.test.ts`, `template-errors.test.ts` y
`meta-client.test.ts`) · build ✓.

## 2. Arnés de comportamiento (mocks)

Con `pnpm dev` vivo, `WA_MOCK_ENABLED=true` y `META_GRAPH_BASE_URL` apuntando
al wa-mock:

```bash
node --env-file=.env scripts/e2e-templates-sync.mjs
node --env-file=.env scripts/e2e-templates-multivar.mjs
```

Registro 2026-09-15: **80/80** y **21/21**, TODO VERDE; `e2e-selftest.mjs` contra base limpia (`uniko_dev_027`): **153/153**. Los escenarios están
numerados en [`tests/e2e/us6-templates.md`](../../tests/e2e/us6-templates.md)
(15–25). Comprobación de UI en `/settings/templates` con el Browser pane: aviso
rojo en vivo al escribir `Hola {{1}}` con el botón deshabilitado; filas con
«Ya no está en Meta» / «Antes de desaparecer, Meta la tenía así (PAUSED)…».

## 3. Ensayo del Principio X (toca `drizzle/`)

Procedimiento: el de
[`specs/020-notificaciones-push/quickstart.md`](../020-notificaciones-push/quickstart.md)
(parte 1), con base `uniko_ensayo_027_<fecha>` y el respaldo diario de LanCo
descargado del panel de Coolify.

Qué mirar además de que aplique:

```sql
select status, meta_status, count(*) from template group by 1, 2;
```

Toda fila `approved` debe salir con `meta_status = 'APPROVED'` (el backfill);
las demás con `NULL`. `missing_since` y `components` en `NULL` en todas: se
rellenan con el primer sync.

**Registro 2026-09-15** (hecho, con autorización del dueño):

- Volcado: el diario de LanCo de las 03:00 UTC (`pg-dump-uniko-1789441205.dmp`,
  147.510 B), descargado del panel de Coolify (pestaña Backups → Executions →
  icono de descarga; la ruta `/download/backup/<uuid>` directa responde
  «Failed to download backup» aunque haya sesión).
- Restaurado en `uniko_ensayo_027_20260915` (Postgres 16 local, base
  desechable) en 974 ms: **46 conversaciones, 339 mensajes, 0 plantillas**, 15
  migraciones previas.
- `scripts/migrate.mjs` (el mismo runner del contenedor) aplicó la 0015 en
  **1.100 ms**: 16 migraciones, las tres columnas creadas y nullable, los
  conteos intactos.
- Como LanCo no tiene plantillas, el backfill se ejercitó a mano sobre la copia:
  una fila `approved` insertada → `meta_status = 'APPROVED'`; una `pending` →
  `NULL`; segunda pasada del `UPDATE` → 0 filas (re-ejecutable).
- La app (build de producción, `pnpm start -p 3100`) arrancó contra la copia y
  `/api/health` respondió `{"ok":true}`.
- Tirado todo al terminar: `dropdb`, el volcado, y de paso el volcado del
  2026-09-08 que seguía en Descargas.

## 4. En vivo (uniko-lanco, tras merge a `main`)

1. `/api/health` 10/10 tras el relevo del contenedor.
2. `/settings/templates`: el sync automático debe **importar** lo que haya en el
   WABA de LanCo (antes: "Todo al día" con la lista vacía). Anotar el resumen.
3. Crear una plantilla real desde la pantalla. Si Meta la rechaza, el mensaje
   debe traer la causa y el código, no "No se pudo crear la plantilla"; si la
   acepta, queda `pending` con la categoría que Meta respondió, y aparece en el
   Administrador de WhatsApp.
4. Logs del contenedor: si hubo rechazo, una línea
   `[templates] Meta rechazó la creación de «…» (100/…): …` sin token.

**Registro 2026-09-15** (hecho, desde la sesión del dueño en su navegador):

1. PR [#30](https://github.com/ponwo/uniko-crm/pull/30) mergeado en `8df60b5`;
   deploy automático de uniko-lanco (`fn6dgsae2skekyeletef7i4n`), migraciones
   aplicadas al arrancar, `/api/health` con `commit: 8df60b5` **10/10**.
2. `/settings/templates`: el sync automático reportó **«1 importada(s) de
   Meta»**: `hello_world` (en_US · UTILITY, aprobada, «Encabezado: texto · Pie
   de página», lista para enviar). Antes: lista vacía y "Todo al día". Es la
   única plantilla que había en el WABA: los intentos anteriores del dueño
   **nunca llegaron a Meta**, lo que confirma que el fallo era del tramo
   CRM→Meta/transporte y no una validación de Meta.
3. Creación real desde la pantalla: `test` (es_MX, UTILITY, «Hola {{1}}, esta
   es tu confirmación de cita para el {{2}} a las {{3}}. Saludos»). Meta tardó
   **entre 8 y 38 s** en responder (la petición seguía `pending` a los 8 s);
   respondió **201**, la fila quedó «Pendiente de Meta» y un Sincronizar
   posterior dijo «Todo al día» (las dos presentes en Meta). Ese tiempo de
   respuesta explica el síntoma original: con el código viejo, cualquier
   corte del proxy/CDN durante esa espera llegaba como HTML y la pantalla
   solo podía decir «No se pudo crear la plantilla»; ahora hay tope de 30 s
   con causa y el código HTTP se muestra.
4. Logs del contenedor: solo el arranque (camino feliz, sin líneas
   `[templates]`).

**Confirmado por el dueño (2026-09-15)**: «funciona perfectamente». Creó
`seguimiento_a_cotizacion` desde Uniko y Meta **ya la aprobó** (la pantalla
la muestra aprobada y enviable); creó `prueba_de_plantilla` **desde el
Administrador de WhatsApp** y el CRM la trajo y la muestra en revisión. Es la
evidencia de "uso real en la instancia de pruebas" que pide la puerta de
promoción a `production`; la promoción sigue esperando su señal explícita.
