# E2E — 022: la guardia del seed demo

Guion de la historia. El nivel 1 y la parte automatizable del 2 están hechos; la
verificación visual es **manual y local por necesidad**, no por comodidad.

> Trabaja desde `C:\G\gApps\LanCo\Uniko-CRM`, no desde el alias `G:\`.

> ### Lo que esta feature impide
>
> `seedDemo()` destruye cuatro cosas: el **conocimiento entero** de la
> organización, su **historial del Laboratorio**, la **personalidad configurada
> del agente** y los contactos de los teléfonos demo. La guardia que lo protegía
> miraba **una sola tabla** —`contact`— y encima la única que está
> garantizadamente vacía en el negocio al que debía proteger: un contacto sólo
> existe cuando alguien te escribe.
>
> El accidente era **un clic sin confirmación** desde el estado vacío de la
> bandeja, que es justo lo que ve un negocio recién desplegado.

## Nivel 1 — Unidad ✅

`pnpm test`. **43 criterios** en dos archivos:

- `tests/unit/seed-demo-guardia.test.ts` (39) — las cuatro comprobaciones, los
  seis casos del perfil por separado, los invariantes del esquema, la
  transacción con su cerrojo y los textos.
- `tests/unit/seed-demo-una-guardia.test.ts` (4) — AC-14, en archivo propio
  porque aquí se sustituye la guardia por un doble.

Y `tests/unit/seed-demo-tenant.test.ts` sigue vigilando el Principio III: que
**ninguna** consulta del seed salga sin `organization_id`, salga por donde salga.

### Lo que se falsificó, en vez de suponerse

| Qué se rompió a propósito | Qué se puso rojo |
|---|---|
| Devolver el `UPDATE` de `agent_profile` al final del seed | 3 tests de AC-7, con *"expected 'db' to be 'tx'"* |
| Que el fake no ejecute el callback de `transaction()` | las **dos** mitades del ancla de vitalidad |
| Meter una referencia a `schema.kbEntry` en la ruta | AC-14 (ii), "no hay una segunda implementación" |
| Quitar el `scoped()` de la consulta de contactos | 2 tests del Principio III |

## Nivel 2 — Arnés, contra HTTP real ✅

En `scripts/e2e-selftest.mjs`, cinco comprobaciones (AC-12) contra la
organización del arnés, que **no es virgen**: el propio arnés le crea perfil y
una entrada de conocimiento antes de llegar ahí.

- [x] `POST /api/seed/demo` responde **409**.
- [x] El cuerpo trae el **detalle estructurado** de qué se perdería.
- [x] El detalle **nombra el conocimiento** configurado.
- [x] Y el conocimiento **sigue ahí** después: la guardia habló y nadie borró.
- [x] La lectura del render (`GET`) coincide: **no es virgen**.

Es seguro precisamente porque **lo esperado es que no pase nada**.

### Corrida — 2026-09-09 ✅

Contra el servidor de desarrollo con los mocks encendidos: **99/108 checks**, y
los **5 nuevos en verde**.

**Los 9 fallos restantes son previos a esta feature y están comprobados como
tales**, no supuestos: corriendo el MISMO arnés contra `main` salen **12**
fallos — los mismos 9, más **3 de los nuevos**, que sin la implementación se
ponen rojos. Es decir, la atribución está hecha por diferencia y AC-12 queda
falsificado de paso.

Los 9 previos son una cascada de `window_closed` y BSUID: huelen a artefacto de
re-corrida sobre una base local sucia (la ventana de 24 h de contactos creados
en corridas anteriores). **No lo he verificado contra una base limpia**, así que
queda dicho como sospecha y no como diagnóstico.

> **Ojo con arrancar la app**: el arnés necesita `pnpm dev`. Con `pnpm start` el
> gate de mocks —que exige `NODE_ENV !== "production"`— deja wa-mock en 404 y
> todo lo que dependa de WhatsApp cae en cascada. Perdí una corrida así.

## Nivel 3 — Manual, en local (OBLIGATORIO)

**No se puede hacer en ninguna instancia de la flota.** La pantalla que hay que
ver sólo aparece con **cero conversaciones**, y hace falta además una
organización **recién dada de alta**, sin nada configurado. LanCo tiene
conversaciones reales desde hace semanas; las de clientes son de clientes.

El procedimiento completo —base desechable, alta real, y qué mirar— está en
[`specs/022-guardia-seed-demo/quickstart.md`](../../specs/022-guardia-seed-demo/quickstart.md).

### Las cuatro pantallas

- [ ] **1. Organización virgen**: sale el botón, su etiqueta dice que **sustituye
      la configuración del agente**, y al pulsarlo la demo se carga. La guardia
      no puede estorbar al caso para el que existe.
- [ ] **2. Con conocimiento y cero contactos** (el caso de NuriaAndrea): **no hay
      botón**, hay una frase que nombra lo que está configurado.
- [ ] **3. Sólo el perfil tocado**: la frase se lee como una frase —*"Ya tienes
      el agente configurado"*— y **no como una enumeración de un elemento**.
- [ ] **4. Mientras la comprobación viaja**: en ningún momento aparece un botón
      que luego desaparezca.

> **El caso 3 es el que hay que juzgar con calma.** Es el más probable en un
> despliegue nuevo —el negocio configura su agente antes de recibir su primer
> mensaje— y el único que no se puede aprobar leyendo código: o suena a español
> o no suena. Los tests comprueban que la plantilla no degenera; que la frase
> esté **bien escrita** lo dice una persona.

### El CLI

- [ ] `pnpm seed:demo` sobre una organización con datos: **se niega y dice qué
      encontró**.
- [ ] `pnpm seed:demo --force`: carga la demo, y **antes imprime los conteos de
      lo que va a destruir**.

### Qué anotar

| Dato | Valor |
|---|---|
| Fecha y base usada | |
| Caso 1 — ¿botón, etiqueta y carga? | |
| Caso 2 — ¿frase en vez de botón? | |
| **Caso 3 — ¿la frase se lee bien?** | |
| Caso 4 — ¿ningún botón fantasma? | |
| CLI sin `--force` | |
| CLI con `--force` | |

## Registro de corridas

*(pendiente: el nivel 3 lo corre el dueño)*

<!--
Regla de siempre, heredada de la 018: lo que no se vio no se marca. Si una
pantalla no se llegó a mirar, se dice "no verificada" en vez de dejar la casilla
en blanco o marcarla por parecer razonable.
-->

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Los cuatro, desde la ruta real. **No hay ensayo del Principio X**: esta feature
no toca `drizzle/` (FR-709), y eso se declara al revisar el PR.
