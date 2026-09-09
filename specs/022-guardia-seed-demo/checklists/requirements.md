# Specification Quality Checklist: 022 — La guardia del seed demo

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-08
**Feature**: [spec.md](../spec.md)

> **Generado a posteriori**, sobre una spec escrita a mano y ya clarificada — no
> por `/speckit-specify`. Se contrasta la spec tal como está; no se ha tocado el
> `spec.md` para que salgan más casillas verdes.

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

**8 de 16** (era 7 antes de cerrar el hueco de abajo). Y ese número, tal cual,
engaña: los ocho fallos que quedan son **todos deliberados**. Va desglosado.

## Notas de la validación

### Los ocho fallos que quedan son DELIBERADOS: esta lista está calibrada para specs de producto

Las ocho casillas sin marcar dicen, en el fondo, lo mismo: "sin detalle de
implementación", "para no técnicos", "criterios de éxito medibles y agnósticos de
la tecnología", "escenarios de usuario". Y "secciones obligatorias" es su
consecuencia.

**La 022 no es una spec de producto: es el arreglo de una función concreta que
destruye datos.** Su contenido es, necesariamente, `pg_advisory_xact_lock`,
`db.transaction()`, nombres de tabla y de columna, rutas de archivo con número de
línea y la forma de `apiError`. Escrita "para no técnicos" no se podría
implementar ni verificar: el requisito *es* que el cerrojo sea la primera
sentencia de la transacción, y eso no tiene traducción a lenguaje de negocio.

Lo mismo con las **secciones obligatorias** de la plantilla: no hay "User
Scenarios" ni "Success Criteria (SC-)". Hay un planteamiento del problema, nueve
requisitos y trece criterios de aceptación. Los AC hacen el trabajo que la
plantilla espera de los SC, y en esta feature son **más** verificables que un SC,
porque cada uno nombra su observable.

**Forzar estas casillas a verde sería mentir sobre la naturaleza del documento.**
Se dejan rojas a propósito, y esta nota es la razón.

### El fallo REAL que había, ya cerrado

**"All functional requirements have clear acceptance criteria" — ahora marcado.**
La primera pasada de este checklist encontró dos requisitos huérfanos, y por eso
existía: **FR-703 sin ningún criterio, y FR-709 igual** (entonces numerados
FR-603 y FR-609; ver la nota de renumeración al final).
Los dos se resolvieron **antes** de planificar:

- **FR-703** tiene ahora **AC-14**, que espía la guardia y afirma que el render y
  la ejecución llaman a la misma función.
- **FR-709** pasa a "lo que se verifica a mano" como afirmación sobre el diff: no
  toca `drizzle/`, y eso se comprueba revisando el PR, no con un test que
  inspeccione el árbol de trabajo.

El mapeo, ya completo:

| Requisito | Criterios que lo cubren |
|---|---|
| FR-701 — qué comprueba la guardia | AC-1, AC-2, AC-3, AC-4, AC-5, AC-9 |
| FR-702 — devuelve el hallazgo | AC-10, AC-11 |
| **FR-703 — una sola función, render y ejecución** | **AC-14** |
| FR-704 — transacción y cerrojo | AC-7, AC-13 |
| FR-705 — 409 con detalle | AC-10, AC-12 |
| FR-706 — el estado vacío explica | AC-10 + verificación manual |
| FR-707 — la etiqueta dice lo que hace | verificación manual |
| FR-708 — `--force` cuenta lo que destruye | AC-11 |
| **FR-709 — sin migración** | verificación manual sobre el diff |

**Por qué importaba el de FR-703**: es el que más barato se rompe con el tiempo.
Dos caminos que comprueban "casi" lo mismo es el fallo original de esta feature
repetido en otra capa — la guardia vieja miraba una tabla y la operación destruía
otras cuatro.

### Lo que esta spec activa y conviene no olvidar

- **No hay migración** (FR-709) → **no hay ensayo del Principio X**. Es la
  diferencia grande con la 020, y es lo que permite que esta feature aterrice
  rápido.
- **Sí cambia comportamiento observable** (una organización con conocimiento y sin
  contactos pasa de 200 a 409), así que **no es carril exento**: va con esta
  mini-spec, decidido por el dueño.
- **Tres requisitos se verifican a mano**: FR-707 y la mitad visual de FR-706
  —en local, con una organización recién dada de alta, y **no en LanCo**, porque
  la pantalla vacía sólo existe con cero conversaciones— y FR-709, que es una
  afirmación sobre el diff y se declara al revisar el PR.

### Nota de renumeración (2026-09-08)

Los requisitos de esta feature eran **FR-601..FR-609** y pasaron a
**FR-701..FR-709**. La banda no la elige la feature: se deriva de su número
(017→2xx, 018→3xx, 019→4xx, 020→5xx, **021→6xx, 022→7xx**), y la 022 llevaba la
de la 021 por haberse escrito antes que ella. Se renumeró con nada implementado
todavía, que es el único momento en que sale gratis.
