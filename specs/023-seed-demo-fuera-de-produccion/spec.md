# 023 — El seed demo sale de producción

**Feature Branch**: `023-seed-demo-fuera-de-produccion`

**Created**: 2026-09-10

**Status**: Draft

**Carril**: **ligero** (`spec.md` únicamente). No toca el modelo de datos —sin
migración— ni un contrato publicado: `POST /api/seed/demo` no es `/api/bot/*`,
ni el webhook, ni SSE, y su único consumidor es `scripts/screenshots.mjs`,
dentro de este repositorio. El Constitution Check vive aquí abajo, como exige
el Principio VI para este carril.

**Banda de requisitos**: FR-8xx, derivada del número de feature —`(23−15)×100`—
según la constitución 1.6.0.

---

## El problema, en una frase

**La única operación destructiva del producto está viva en las instancias de
clientes, detrás de un botón sin confirmación y de una guardia que mira la
tabla equivocada.**

---

## Problema

`seedDemo()` no "carga datos de ejemplo". Leído del código:

| Qué | Cómo | Alcance |
|---|---|---|
| Conocimiento del negocio | `DELETE FROM kb_entry` | **todo**, no solo lo de la demo |
| Historial del Laboratorio | `DELETE` de `agent_test_case` y `agent_test_run` | **todo** |
| Personalidad del agente | `UPDATE agent_profile` (nombre, tono, instrucciones, reglas de escalado, saludo) | **sin guardia de ningún tipo** |
| Contactos, conversaciones, mensajes, leads | `DELETE` acotado a los teléfonos demo | solo los de la demo |

Se llega por `POST /api/seed/demo`, protegido por `isDomainEmpty()`, **que solo
comprueba si la organización tiene contactos**. Un contacto solo existe cuando
alguien escribe al número. Así que un negocio que ya configuró su agente y su
conocimiento pero todavía no ha recibido su primer mensaje **pasa la guardia** —
y es exactamente el negocio con algo que perder.

El camino al accidente es **un clic sin confirmación**: el botón "Cargar datos
de demostración" vive en el estado vacío de la bandeja, que es justo lo que ve
un negocio recién desplegado.

Y no es hipotético dónde está: el botón y la ruta viajan hoy en `production`,
es decir en las instancias de I Love The Universe y NuriaAndrea.

---

## Lo que se decide, y por qué no es una guardia

La [022](#el-cierre-de-la-022) iba a arreglar la guardia: comprobar las ocho
cosas que la operación destruye en vez de una sola, dentro de una transacción y
con cerrojo. Se implementó entera y **no se mergea**.

**Se retira el camino en vez de blindarlo.** El seed solo sirve para demostrar
el producto, y el proyecto ya tiene el patrón para lo que no debe existir en
producción: `src/app/api/dev/*` tras `mockGuard()`, **404 incondicional**. Ahí
viven los mocks de WhatsApp, IA, Zoom, Google, Zernio y push. El seed demo es
la misma clase de cosa y se quedó fuera por historia, no por diseño.

Quitar la puerta **elimina el riesgo entero**; una guardia solo lo acota. Y con
la puerta desaparece la guardia que había que construir, mantener y probar.

---

## Requisitos

- **FR-801** El botón "Cargar datos de demostración" MUST desaparecer del
  estado vacío de la bandeja. Deroga en parte FR-075 de `001-uniko-core`,
  marcado allí y en sus artefactos.
- **FR-802** `POST /api/seed/demo` MUST dejar de existir. La operación se sirve
  desde `POST /api/dev/seed-demo`, tras `mockGuard()`.
- **FR-803** En producción, esa ruta MUST ser **indistinguible de una ruta
  inexistente**: 404, no 401 ni 403. El gate MUST evaluarse **antes** que la
  autenticación — un 401 ya delata que la ruta existe.
- **FR-804** El seed MUST seguir funcionando por CLI (`pnpm seed:demo`, con
  `--force`) y desde `scripts/screenshots.mjs`, que lo llama para poblar una
  instancia local antes de regenerar las capturas del README.
- **FR-805** Ninguna consulta de `seedDemo()` MUST salir sin `organization_id`.
  Los teléfonos de la demo son constantes del repositorio —los mismos en todas
  las instancias del mundo—, así que buscar contactos solo por teléfono
  encuentra los de otro negocio. Hoy es inerte porque una instancia es un
  negocio, y es justo la suposición que el Principio III prohíbe meter en una
  query.
- **FR-806** Toda mención del botón MUST desaparecer de la documentación de
  usuario (`README.md`, `INSTALL-IA.md`) y quedar marcada como derogada en los
  artefactos de la `001`.

---

## El cierre de la 022

La rama `022-guardia-seed-demo` queda **cerrada sin mergear**, con 18 commits
implementados y verdes. Se registra aquí porque una rama abandonada en silencio
hace creer, dentro de un año, que la feature se olvidó.

**Qué la cerró**: la decisión de que el peligro se elimina, no se valla. Su
propia spec ya había recorrido medio camino sola —a mitad de implementación
retiró el botón en vez de protegerlo, escribiendo que *"quitar el botón elimina
el riesgo entero en vez de acotarlo"*—. Esta feature termina ese razonamiento.

**Qué sobrevive de ella**:

| Pieza | Dónde acabó |
|---|---|
| `93b7022` — el arreglo del Principio III | **Rescatado aquí** por cherry-pick (FR-805) |
| La eliminación del botón | Rehecha aquí, más pequeña (FR-801) |
| Los sitios de documentación que descubrió | Reutilizados: `README.md`, `INSTALL-IA.md` y cuatro artefactos de la `001` |
| Guardia de ocho comprobaciones (FR-701, FR-702, FR-703) | Se disuelve: no hay operación destructiva en producción que guardar |
| Transacción + `pg_advisory_xact_lock` | Se disuelve |
| FR-706, FR-707 | Ya derogados por la propia 022 |

**Su análisis no se pierde**: el defecto de la guardia —comprobar la única
tabla garantizadamente vacía— está transcrito en el "Problema" de arriba, que
es la parte que había que conservar. El resto vive en la rama, cuya cabeza es
`76ff482`.

---

## Constitution Check

Evaluado antes de escribir código, como exige el carril ligero.

- **I (Seguridad de datos)** — Es la razón de ser de esta feature: retira de las
  instancias de clientes el único camino que borra su conocimiento y su
  historial sin vuelta atrás. FR-805 cierra además un cruce entre
  organizaciones que hoy es inerte.
- **II (Soberanía)** — Sin cambios: no entra ni sale ninguna dependencia.
- **III (Multi-tenancy)** — FR-805 es exactamente este principio: el tenant
  tiene que **verse** en la query, no deducirse de dónde salió una lista.
- **IV (Idempotencia)** — El seed sigue siendo idempotente. Sin cambios.
- **V y IX (Calidad)** — Gate técnico completo, más los arneses que esta
  superficie puede alcanzar. El self-test del Laboratorio y el principal siguen
  verdes.
- **VI (Specs antes de código)** — Carril declarado arriba, antes de escribir.
- **VII (Trazabilidad)** — El cierre de la 022 y la derogación de FR-075 quedan
  escritos, no enterrados.
- **X (Irreversibilidad)** — **No toca `drizzle/`.** Sin migración y sin ensayo.
  Reversión: redesplegar el commit anterior devuelve el botón y la ruta.

**Sin violaciones que registrar.**

---

## Criterios de éxito

- **SC-001** En una instancia de producción, `POST /api/seed/demo` y
  `POST /api/dev/seed-demo` responden 404, con sesión y sin ella.
- **SC-002** El estado vacío de la bandeja no ofrece cargar nada.
- **SC-003** En desarrollo con mocks, el seed sigue poblando la instancia y
  `scripts/screenshots.mjs` sigue funcionando.
- **SC-004** Ninguna consulta del seed sale sin tenant, comprobado renderizando
  cada `WHERE` con el dialecto de Postgres.

---

## Cómo salió — 2026-09-10

**SC-001 comprobado contra una app en MODO PRODUCCIÓN de verdad**, no razonado:
build real, `next start`, y las dos rutas consultadas sin sesión.

| | modo producción | modo desarrollo |
|---|---|---|
| `POST /api/seed/demo` | **404** | **404** (ya no existe) |
| `POST /api/dev/seed-demo` | **404** | 401 (existe y pide sesión) |

El 401 en desarrollo es la prueba de que el gate deja pasar donde debe; el 404
en producción, de que ahí la ruta no existe.

**FR-803 falsificado.** Se movió el gate dentro del `withAuth` —el error exacto
que el test existe para atrapar— y el test se puso rojo con su mensaje: *"El
gate corrió DESPUÉS de la autenticación: en producción una petición anónima
recibiría 401 y eso delata que la ruta existe."*

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` · `build` | limpios |
| `test` (unidad) | **544 pasan**, 65 archivos |
| `scripts/e2e-selftest.mjs` | **103/103** (base limpia) |
| `scripts/e2e-lab.mjs` | **20/20** (base limpia) |

`e2e-sse-reconexion.mjs` y `e2e-pwa.mjs` no se corrieron: no hay camino por el
que este cambio los alcance.

**Pendiente de verificación humana**: `scripts/screenshots.mjs` end-to-end. Se
comprobó que la ruta que llama responde en desarrollo, pero regenerar las
capturas del README exige Playwright con Chromium y juicio visual sobre el
resultado. No está en `package.json` y se corre a mano.

---

## Fuera de alcance

- **Borrar el seed entero.** Sigue siendo la única forma de poblar una
  instancia para regenerar las capturas del README, y `screenshots.mjs` no está
  en `package.json`: matarlo lo rompería en silencio.
- **Limpiar datos demo de la flota.** No hay ninguno: el dueño confirmó el
  2026-09-09 que las tres instancias están en cero, y el ensayo del Principio X
  del 2026-09-08 lo había medido en LanCo (1 contacto, 1 conversación).
- **La guardia de la 022.** Se disuelve con la puerta; ver el cierre.
