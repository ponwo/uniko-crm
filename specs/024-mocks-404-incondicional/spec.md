# 024 — Los mocks devuelven 404 antes de que Next mire el método

**Feature Branch**: `024-mocks-404-incondicional`

**Created**: 2026-09-10

**Status**: Draft

**Carril**: **ligero** (`spec.md` únicamente). No toca el modelo de datos —sin
migración— ni un contrato publicado: `/api/dev/*` no es `/api/bot/*`, ni el
webhook, ni SSE, y en producción su único comportamiento contractual es *no
existir*. El Constitution Check vive aquí abajo, como exige el Principio VI
para este carril.

**Banda de requisitos**: FR-9xx, derivada del número de feature —`(24−15)×100`—
según la constitución 1.6.0.

---

## El problema, en una frase

**En producción, `/api/dev/*` responde 404 solo a los métodos que cada ruta
exporta; a los demás Next responde 405 antes de llegar a la guardia, y esa
diferencia confirma qué rutas de mock existen en la instancia.**

---

## Problema

Medido en vivo el 2026-09-10 contra `https://uniko.lanco.cloud` (producción,
commit `a616aea`):

| Petición | Respuesta | Qué dice |
|---|---|---|
| `GET /api/dev/wa-mock/outbox` | 404 | `mockGuard()` funciona |
| `DELETE /api/dev/wa-mock/outbox` | 404 | `mockGuard()` funciona |
| `PUT /api/dev/wa-mock/outbox` | **405** | la ruta existe |
| `GET /api/dev/wa-mock/status` | **405** | la ruta existe y no exporta `GET` |
| `PUT /api/dev/inexistente-de-verdad` | 404 | ruta que no existe |

La causa es dónde vive la guardia. `mockGuard()` (`src/lib/dev-guard.ts`) se
llama **dentro** de cada handler, pero el App Router resuelve el método
**antes** de invocar el handler: si `route.ts` no exporta `PUT`, Next responde
405 por su cuenta y la guardia nunca corre. La promesa de `mockGuard()` es ser
*indistinguible de una ruta inexistente*, y un 405 la rompe exactamente igual
que el 401 que la [023](../023-seed-demo-fuera-de-produccion/spec.md) cerró
para el seed demo: allí el gate corría después de la autenticación; aquí corre
después del enrutado por método.

**No da acceso.** Todo método que sí existe sigue bloqueado por la guardia. Es
fuga de información, no brecha. Pero la constitución ("Restricciones de
Plataforma y Seguridad") dice *404 incondicional*, y 405 no es incondicional.

---

## Lo que se decide, y por qué un perímetro y no dieciséis parches

Dos opciones sobre la mesa:

1. **Un middleware** que atienda `/api/dev/*` antes del enrutado y responda 404
   cuando `isMockEnabled()` es falso.
2. **Exportar los métodos que faltan** en cada ruta dev, cada uno con
   `mockGuard()` primero.

**Se elige la 1.** La 2 es explícita pero se erosiona sola: la próxima ruta de
mock que alguien añada —y se añaden, la 015 dejó escrito el patrón
`src/app/api/dev/<id>-mock/`— volverá a filtrar por el método que olvide
exportar, y ningún test unitario por ruta lo atrapa porque el 405 lo produce
Next, no el código de la ruta. La 1 mueve la guardia al único sitio que corre
**antes** del enrutado, y cubre por prefijo lo que exista hoy y lo que exista
mañana. Es el mismo razonamiento con el que la 023 puso el gate antes de la
autenticación: la guardia va delante de todo lo que pueda responder distinto.

Lo que **no** se hace: no se quita `mockGuard()` de los handlers. El middleware
es el perímetro; la guardia dentro de cada ruta se queda como segunda capa, y
además es lo que protege en desarrollo sin la bandera (`next dev` sin
`WA_MOCK_ENABLED`), donde el middleware también actúa pero no debe ser el único
que lo haga.

### Lo que hay que saber del middleware en Next 15 App Router

- Vive en `src/middleware.ts` (junto a `app/`, no dentro) y corre **antes** de
  resolver la ruta y el método. Un `Response` devuelto desde él se entrega tal
  cual al cliente, sin pasar por ningún `route.ts`.
- `config.matcher` acota a `/api/dev/:path*`: el resto de `/api/*` —webhook,
  bot, SSE, auth, health— ni siquiera pasa por él. Es la forma de garantizar que
  no interfiere: no hay lógica que decida "no es dev, sigue", hay una lista de
  rutas a las que no aplica por construcción.
- Corre en el runtime Edge. Ahí no hay `Buffer`, y `src/lib/env.ts` lo usa al
  cargar, así que la bandera se lee desde un módulo hoja sin dependencias
  (`src/lib/mock-flag.ts`) que `env.ts` re-exporta; `dev-guard.ts` y el
  middleware leen la misma función. `process.env.NODE_ENV` queda fijado a
  `production` en el bundle de un `next build`, y `WA_MOCK_ENABLED` se lee del
  entorno en tiempo de ejecución, que es lo que se comprueba en vivo abajo.

---

## Requisitos

- **FR-901** En producción, toda petición a cualquier ruta bajo `/api/dev/`
  MUST responder 404 **con independencia del método** (`GET`, `HEAD`, `POST`,
  `PUT`, `PATCH`, `DELETE`, `OPTIONS`), exista o no la ruta y exporte o no ese
  método. Extiende FR-080 de `001-uniko-core`, que hablaba de "las rutas" y no
  contemplaba que Next respondiera por ellas.
- **FR-902** Esa respuesta MUST producirse **antes** del enrutado por método,
  en `src/middleware.ts`, acotado por `matcher` a `/api/dev/:path*`. Ninguna
  otra ruta de `/api/*` MUST pasar por él.
- **FR-903** `mockGuard()` MUST permanecer en cada handler de `/api/dev/*`.
  El middleware añade una capa; no sustituye la existente.
- **FR-904** Todo archivo de `src/app/` que llame a `mockGuard()` MUST vivir
  bajo `src/app/api/dev/`. Si no, el perímetro no lo cubre y el 405 vuelve. Se
  afirma con test sobre el árbol, igual que FR-802.
- **FR-905** Con `WA_MOCK_ENABLED=true` fuera de producción, los mocks MUST
  seguir funcionando exactamente igual: los arneses `scripts/e2e-selftest.mjs` y
  `scripts/e2e-lab.mjs` dependen enteros de ellos y son la prueba.

---

## Constitution Check

Evaluado antes de escribir código, como exige el carril ligero.

- **I (Seguridad de datos)** — Es la razón de ser: cierra una fuga de
  información en la instancia pública. Ningún secreto nuevo, ninguno expuesto.
- **II (Soberanía)** — Sin cambios: no entra ni sale ninguna dependencia. El
  middleware es de Next, que ya está.
- **III (Multi-tenancy)** — No toca datos ni queries.
- **IV (Idempotencia)** — No aplica: no hay escritura.
- **V y IX (Calidad)** — Gate técnico completo, test unitario falsificado a
  propósito, verificación contra `next build && next start` (no razonada), y
  los dos arneses que dependen de los mocks en verde.
- **VI (Specs antes de código)** — Carril declarado arriba, antes de escribir.
- **VII (Trazabilidad)** — FR-080 queda extendido y referenciado desde aquí.
- **X (Irreversibilidad)** — **No toca `drizzle/`.** Sin migración y sin ensayo.
  Reversión: redesplegar el commit anterior quita el middleware; el resto del
  sistema no lo nota.

**Sin violaciones que registrar.**

---

## Criterios de éxito

- **SC-001** Contra una app en modo producción (`next build && next start`),
  los siete métodos sobre varias rutas de `/api/dev/*` —con métodos que
  exportan, que no exportan, y rutas que no existen— responden todos 404. Se
  conduce con `scripts/e2e-mocks-404.mjs`, que deriva la lista de rutas del
  árbol `src/app/api/dev/` para que una ruta nueva entre sola.
- **SC-002** El mismo guion contra la misma app **en desarrollo con mocks**
  demuestra que el perímetro deja pasar: al menos una ruta responde distinto
  de 404.
- **SC-003** El resto de `/api/*` no cambia: `/api/health` responde 200 en
  producción; `PUT /api/inexistente` responde lo mismo antes y después.
- **SC-004** Un test unitario, puesto en rojo a propósito rompiendo el
  middleware, atrapa la regresión.
- **SC-005** `scripts/e2e-selftest.mjs` y `scripts/e2e-lab.mjs` en verde con
  el middleware puesto.

---

## Cómo salió — 2026-09-10

**SC-001 medido contra una app en MODO PRODUCCIÓN de verdad**: `pnpm build`,
`pnpm start -p 3100`, y `scripts/e2e-mocks-404.mjs` contra ella — las 16
rutas del árbol `src/app/api/dev/`, la raíz `/api/dev` y una inexistente, con
los siete métodos: **404 en las 126 combinaciones** (20/20 checks). Las
cabeceras y el cuerpo (vacío) son idénticos para `PUT /api/dev/wa-mock/outbox`
(existe, no exporta `PUT`), `PUT /api/dev/wa-mock/status` (existe, solo
`POST`) y `PUT /api/dev/inexistente-de-verdad`. `/api/health` → 200;
`PUT /api/inexistente-de-verdad` → 404 con el not-found de Next, como antes.

**SC-002, el perímetro deja pasar**: el mismo guion con `--expect=open` contra
`pnpm dev` y `WA_MOCK_ENABLED=true` muestra la tabla completa de métodos por
ruta (200/201/204/401/405/422 según cada mock), la ruta inexistente en 404, y
el guion en verde. Esa tabla es, de paso, la fuga entera fotografiada: cada 405
de ahí era lo que producción devolvía antes del middleware.

**SC-004, el test falsificado tres veces**, y las tres en rojo con su mensaje:
(1) middleware que deja pasar siempre → *"debió ser 404 en producción; el
middleware es el único que corre antes del enrutado por método"*; (2) `matcher`
recortado a `/api/dev/wa-mock/:path*` → falla la igualdad exacta; (3) una ruta
`src/app/api/fuera/route.ts` que llama a `mockGuard()` → *"Estas rutas llaman
a mockGuard() fuera de /api/dev: el middleware no las cubre"*.

| Gate | Resultado |
|---|---|
| `typecheck` · `lint` · `build` | limpios; el build reporta `ƒ Middleware 34.1 kB` |
| `test` (unidad) | **550 pasan**, 66 archivos (6 nuevos) |
| `scripts/e2e-mocks-404.mjs` (producción, 3100) | **20/20** |
| `scripts/e2e-mocks-404.mjs --expect=open` (desarrollo) | **4/4** |
| `scripts/e2e-selftest.mjs` | **103/103** (base limpia) |
| `scripts/e2e-lab.mjs` | **20/20** (base limpia) |

Una cosa que el guion enseñó al escribirse: `GET /api/dev/sse-mudo` es un
stream que por diseño no termina, así que el guion lee el estado de las
cabeceras y cancela el cuerpo; leerlo entero colgaba la primera pasada.

**Contra LanCo desplegada (`e64a164`, mismo día)**:
`scripts/e2e-mocks-404.mjs --base=https://uniko.lanco.cloud` → **20/20**. Las
dos peticiones que abrieron esto —`PUT /api/dev/wa-mock/outbox` y
`GET /api/dev/wa-mock/status`— pasaron de 405 a 404 en la instancia real.

Una lección del camino: la primera corrida, lanzada en cuanto `/api/health`
reportó el commit nuevo, salió con 18 fallos mezclando 405 y 502. No era el
código: el proxy alternaba entre el contenedor viejo (los 405) y el que
arrancaba (los 502), una petición sí y una no. `/api/health` en 200 **una
vez** no significa que el relevo terminó; hay que verlo estable (10/10) antes
de medir nada contra la instancia. Con ~1 min de espera, la segunda corrida
fue la buena.

Queda pendiente el mismo guion contra las otras dos instancias cuando
`production` reciba este commit; es parte del cierre de la promoción.

---

## Fuera de alcance

- **Igualar byte a byte el 404 de Next.** Dentro de `/api/dev/` toda respuesta
  es idéntica exista la ruta o no, que es lo que la constitución pide. Fuera
  del prefijo, Next sirve su not-found en HTML; que `/api/dev` reciba un trato
  distinto no es secreto: el repositorio es público.
- **Las superficies opcionales (agenda, push, atribución, canales).** Sus
  banderas responden 404 desde el handler y, por tanto, 405 a los métodos que
  no exportan — la misma fisonomía. No son mocks: la constitución exige el 404
  incondicional a las rutas de desarrollo, y esas otras existen en el código
  público de todas formas. Si algún día se decide que también deben ser
  indistinguibles, el patrón de aquí (matcher por prefijo + bandera) sirve tal
  cual; es otra feature.
