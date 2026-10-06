---
name: catalogo-pdf-032
description: "032 (catálogo PDF, send_catalog + cierre con más de 10): implementada en la rama 032-catalogo-pdf con gate y arnés verdes en ambas configuraciones y probada contra MS-Stock real en local (2026-10-05); falta PR, deploy a uniko-lanco y la prueba por WhatsApp del dueño. Gotchas del arnés que salieron aquí."
metadata:
  type: project
---

Lado Uniko de la 006 de MS-Stock (contrato v2, §4 y §4b, desplegado 2026-10-04).
Rama `032-catalogo-pdf`; gate verde (104 archivos / 993 tests, build); `pnpm test:e2e`
verde con `INVENTARIO=on` (selftest 189/189, lab 40/40) y apagada (119/119, 32/32);
contra MS-Stock local con stub S3: documento con el nombre real y, sin catálogo, solo la
frase. Pendiente (2026-10-05): PR, merge = señal del dueño, deploy a `uniko-lanco` ↔
`stock.lanco.cloud` y la prueba por WhatsApp (SC-006). NO promover sin señal aparte.

Decisiones (no reabrir): el umbral del ofrecimiento es **más de 10** con existencia (de
6 a 10, «Hay más coincidencias…» sin consultar el catálogo); el motor *ofrece* y el
cliente acepta con «sí» (no se manda sin pedirlo, para no pasar del tope de 5 envíos);
el respaldo a texto (pie + enlace) cubre rechazo, tiempo, `failed` tardío y canales sin
documentos; el enlace queda en el hilo pero `stripCatalogLink` lo quita del prompt.

Gotchas verificados en esta máquina:
- **Estado de mocks en `globalThis`**: en `next dev` cada ruta compila su copia de un
  módulo y la reevalúa al recompilar. `ai-mock-state` usaba una variable de módulo y la
  ruta `_state` nunca veía lo anotado por completions (`lastModel` de la 015 tampoco
  funcionaba; su check solo corre con `AGENDA_MODEL`). Todo estado compartido entre
  rutas de mocks va en `globalThis`, como el wa-mock y el stock-mock.
- **`next dev` descarta rutas inactivas** y las recompila a mitad del arnés (6 s el
  ai-mock): el primer turno de inventario cayó fuera de la ventana. Para corridas
  completas sirvió un GET de lectura cada 10 s a completions del ai-mock (405, no anota),
  `stock-mock/_state` y `wa-mock/graph/v21.0/ping/pong` (devuelve `{}`).
- **`e2e-plantillas-por-canal` deja WhatsApp conectado con `PN-031`**: un guion propio
  sobre la misma base debe mandar entrantes a ese número, no a `PN-E2E-1`. Su check
  «con el selector de plantillas aprobadas» (30 s) se cae si `next dev` compila varias
  rutas a la vez; repetido con las rutas calientes pasa.
- **Vitest: una función devuelta por `beforeEach` es un teardown**: `beforeEach(() =>
  spy.mockResolvedValue(…))` devuelve el espía y Vitest lo LLAMA al terminar cada test
  (una llamada fantasma que contamina `toHaveBeenCalled` del siguiente). Siempre llaves.
- **El navegador integrado no muestra PDF**: lo ofrece como descarga (diálogo al
  dueño). Para revisar un documento, comprobar el `href` y no abrirlo ahí.
- Panel del navegador oculto ⇒ la pestaña no dibuja: `resize_window` para capturas y
  `javascript_tool` para clics que `computer` no puede dar.

**Why:** la feature quedó verificada en local; lo que falta depende del dueño (merge,
WhatsApp). Los gotchas costaron una corrida cada uno.
**How to apply:** al retomar, ir a T053–T055 de `specs/032-catalogo-pdf/tasks.md`. Antes
de una corrida completa del arnés en esta máquina, mantener calientes las rutas de mocks
y usar base nueva. Ver también [[respuesta-por-talla-028-pr31]] y
[[worktree-y-arneses-en-la-maquina-de-desarrollo]].
