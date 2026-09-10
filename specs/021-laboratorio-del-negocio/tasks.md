# Tasks: 021 — El Laboratorio sigue al negocio

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## Format: `[ID] [P?] Description`

`[P]` = puede ir en paralelo con las demás marcadas `[P]` del mismo bloque.

---

## ⛔ Dos reglas de orden

### 1. El test de la regresión va ANTES de reescribir los guiones

T004 escribe el test que afirma que ningún guion nombra un giro concreto, y se
ve **fallar contra los guiones de ferretería** antes de tocarlos. Un test
escrito después de la corrección pasa a la primera y nunca demuestra que
detecta nada.

### 2. El arnés se falsifica antes de darlo por bueno

T012 no está hecha cuando el arnés pasa: está hecha cuando se ha comprobado que
**falla** si se rompe a mano lo que dice comprobar. Un arnés verde que no
falsifica nadie es un arnés que afirma sin mirar.

---

## Entrega 1 — Los seis dejan de ser una ferretería

### Fase 1: La red, antes del cambio

- [x] **T001** Leer `src/server/lab/personas.ts` entero y anotar, por persona,
      qué mide hoy. Es la entrada de FR-602: la reescritura tiene que conservar
      la medición, no solo el nombre.
- [x] **T002** Confirmar contra `src/server/ai/handoff.ts` qué frase exacta de
      `pide_humano` dispara `HANDOFF_BACKUP_REGEX` (FR-604).
- [x] **T003** [P] Confirmar que ningún test de unidad afirma hoy el contenido
      de un guion. Si alguno lo hace, entra en el alcance.
- [x] **T004** `tests/unit/lab-personas.test.ts`: (a) ningún guion contiene
      términos de giro concreto; (b) las seis claves siguen siendo las de
      siempre; (c) `pide_humano` dispara `matchesHandoffIntent()`.
      **Se corre y se ve FALLAR (a) contra los guiones actuales.**

### Fase 2: Los guiones

- [x] **T005** Reescribir los seis `script` de `PERSONAS` agnósticos de giro
      (FR-601). Claves, `phone`, `label` y `contactName` **sin tocar** (D1).
- [x] **T006** Añadir a cada persona el comentario de **qué mide** y qué se
      rompe si se reescribe (FR-603).
- [x] **T007** Correr T004: los tres checks en verde.

### Fase 3: El mock deja de hablar de ferretería

- [x] **T008** `src/server/dev/ai-mock.ts`: el gancho del juez pasa de
      `garant|devoluc` a cancelaciones/reembolsos (D2, FR-605). La mecánica y
      la aritmética (83 → 100, delta +17) no cambian.
- [x] **T009** Comprobar que la rama de `pide_humano` del mock sigue
      disparando con el guion nuevo.

### Fase 4: El arnés — lo que hoy no existe

- [x] **T010** `scripts/e2e-lab.mjs` nuevo, siguiendo el patrón de
      `scripts/e2e-push.mjs` y reutilizando `contextoConSesion()`. Los seis
      checks de D3, incluido el **outbox vacío** del sandbox.
- [x] **T011** Encadenarlo en `test:e2e` (`package.json`).
- [x] **T012** **Falsificar el arnés**: romper a mano cada cosa que dice
      comprobar y ver que se pone rojo. Sin esto T010 no está hecha (regla 2).
- [x] **T013** `tests/e2e/us4-lab.md` al día: el tema cambia, los números no.
      Anotar que ya tiene arnés y cuál.

### Fase 5: El gate y el cierre

- [x] **T014** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
      verde.
- [x] **T015** Los arneses que este cambio puede alcanzar, en verde contra la
      app viva con mocks: `e2e-selftest.mjs`, `e2e-lab.mjs` y `e2e-push.mjs`
      (por su escenario C del Laboratorio). `e2e-sse-reconexion.mjs` y
      `e2e-pwa.mjs` quedan fuera con su razón — ver el registro al final.
- [x] **T016** Marcar como **pendiente de verificación humana** lo único que no
      se puede automatizar: que un guion neutro le sirva a un negocio real
      (plan, "Lo que NO se puede verificar automáticamente").

---

## Entrega 2 — El juez deja de castigar al agente por obedecer

Se detalla al empezarla. Depende de mirar veredictos reales del juez con los
guiones ya neutros (D4): escribir la rúbrica contra el fixture de ferretería
sería repetir el error que esta feature arregla.

Alcance conocido: FR-610, FR-611, FR-612, FR-613 · `buildJudgePrompt` en
`src/server/ai/prompts.ts` · sin tocar `drizzle/`.

---

## Entrega 3 — El negocio genera sus escenarios

Se detalla al empezarla. Depende de la Entrega 2.

Alcance conocido: FR-620..FR-632 · tabla `lab_scenario` + columna del sello ·
**toca `drizzle/`**, así que arrastra el ensayo del Principio X
([procedimiento](../020-notificaciones-push/quickstart.md)) y plan de reversión
declarado en el PR.

---

## Dependencies

- T004 antes que T005 (regla 1).
- T005 antes que T007, T008, T010.
- T010 antes que T011 y T012.
- T014 y T015 al final, sobre todo lo anterior.
- **Fuera de esta rama**: `gobernanza/bandas-fr` entra antes que el PR de esta
  feature — de ahí sale la banda FR-6xx.

## MVP

**Fases 1 a 3.** Con eso el Laboratorio ya deja de evaluar a NuriaAndrea e ILTU
con preguntas de tlapalería, que es el problema que abrió esta feature. Las
fases 4 y 5 son lo que impide que vuelva a pasar sin que nadie se entere — y
por la Definición de Hecho del proyecto, no son opcionales para declararla
terminada.

---

## Cómo salió de verdad — Entrega 1, 2026-09-09

Registrado tal como pasó, no como estaba escrito.

**Las dos reglas de orden se cumplieron, y sirvieron.**

- **T004 antes que T005**: el test se vio fallar contra los guiones de
  ferretería, señalando siete términos (`taladro`, `martillo`, `desarmador`,
  `clavo`, `lijadora`, `pintura`, `tiner`). Sin eso no habría forma de saber
  que detecta algo.
- **T012, la falsificación**, encontró lo que se buscaba en dos frentes:
  reintroducir `taladros inalámbricos` en un guion pone rojo **el test de
  unidad Y el arnés** (18/19, `— taladro`); cambiar la expectativa del outbox a
  `outboxAntes + 1` pone rojos los dos checks del sandbox (17/19). Los checks
  de score, veredicto, sugerencia y delta se falsificaron **solos**, ver abajo.

**Un fallo de montaje que valió la pena.** La primera corrida del arnés se hizo
contra la app en `next start` y dio 8 fallos con `score: null`. La causa no era
el Laboratorio: `isMockEnabled()` exige `NODE_ENV !== "production"`, así que en
modo producción **los mocks devuelven 404 por diseño** —la "instancia pública
endurecida" de la constitución— y el juez fallaba con `provider_error`. La
guarda hacía exactamente su trabajo. Quedó anotado en `tests/e2e/us4-lab.md`
para que nadie lo diagnostique dos veces, y de paso falsificó cinco checks.

**La base reutilizada mintió, y hubo que descartarlo.** El arnés principal daba
11 fallos contra `uniko_dev` —`window_closed`, medios, estado de handoff—.
Ninguno tocaba el Laboratorio, pero "no parece mío" no es una verificación. Se
creó una base desechable (`uniko_e2e_021`, creada y migrada con `db:dev`, y
borrada al terminar) y ahí el arnés principal dio **103/103**. Los once eran
datos viejos.

| Gate | Resultado |
|---|---|
| `typecheck` | limpio |
| `lint` | limpio |
| `build` | 0 errores |
| `test` (unidad) | **528 pasan**, 62 archivos |
| `scripts/e2e-selftest.mjs` | **103/103** (base limpia) |
| `scripts/e2e-lab.mjs` | **19/19** (base limpia, encadenado tras el anterior) |
| `scripts/e2e-push.mjs` | **31/31**, incluido "el Laboratorio no mandó NINGUNA notificación" (FR-503) |

`e2e-sse-reconexion.mjs` y `e2e-pwa.mjs` **no se corrieron**: no hay camino por
el que este cambio los alcance. Se dice en vez de dejarlo suponer.

**Divergencia de entorno declarada**: la máquina tiene **Node 24**, no el 22 que
exigen `.nvmrc` y `engines`. No se aflojó `engine-strict` —el `.npmrc` explica
por qué no— sino que se resolvieron las dependencias del checkout principal,
que comparte lockfile. La CI corre la matriz sobre Node 22, y es ahí donde esa
verificación cuenta.

**T016 — pendiente de verificación humana**: que un guion neutro le sirva a un
negocio real. Solo se sabe mirando una corrida de una instancia con su
conocimiento cargado.
