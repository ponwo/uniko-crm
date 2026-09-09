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

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

**7 de 16.** Y ese número, tal cual, engaña: la mayoría de los fallos son
deliberados y uno solo es un hueco de verdad. Va desglosado abajo.

## Notas de la validación

### Seis fallos DELIBERADOS: esta lista está calibrada para specs de producto

Cinco de las nueve casillas sin marcar dicen variantes de lo mismo — "sin detalle
de implementación", "para no técnicos", "criterios de éxito agnósticos de la
tecnología"— y la sexta ("secciones obligatorias") es su consecuencia.

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

### Un fallo REAL, y es accionable

**"All functional requirements have clear acceptance criteria" — sin marcar, y con
motivo.** Al mapear los nueve requisitos contra los trece criterios aparecen dos
huérfanos:

| Requisito | Criterios que lo cubren |
|---|---|
| FR-601 — qué comprueba la guardia | AC-1, AC-2, AC-3, AC-4, AC-5, AC-9 |
| FR-602 — devuelve el hallazgo | AC-10, AC-11 |
| **FR-603 — una sola función, render y ejecución** | **ninguno** |
| FR-604 — transacción y cerrojo | AC-7, AC-13 |
| FR-605 — 409 con detalle | AC-10, AC-12 |
| FR-606 — el estado vacío explica | AC-10 + verificación manual |
| FR-607 — la etiqueta dice lo que hace | verificación manual |
| FR-608 — `--force` cuenta lo que destruye | AC-11 |
| **FR-609 — sin migración** | **ninguno** |

- **FR-603** es justo el que más barato se rompe con el tiempo: dos caminos que
  comprueban "casi" lo mismo es el fallo original de esta feature repetido en
  otra capa. Necesita un criterio que afirme que **el render y la ejecución
  llaman a la misma función**, no a dos.
- **FR-609** es una restricción negativa ("no toca `drizzle/`") y se puede
  afirmar mirando el diff, pero hoy nadie lo afirma.

**Esto no se ha arreglado en la spec**: se reporta para que se decida. Añadir dos
criterios es trabajo pequeño; hacerlo sin pedirlo sería absorber una decisión.

### Lo que esta spec activa y conviene no olvidar

- **No hay migración** (FR-609) → **no hay ensayo del Principio X**. Es la
  diferencia grande con la 020, y es lo que permite que esta feature aterrice
  rápido.
- **Sí cambia comportamiento observable** (una organización con conocimiento y sin
  contactos pasa de 200 a 409), así que **no es carril exento**: va con esta
  mini-spec, decidido por el dueño.
- **Dos requisitos se verifican a mano** (FR-607 y la mitad visual de FR-606) y la
  spec dice dónde: en local, con una organización recién dada de alta. **No en
  LanCo**, porque la pantalla vacía sólo existe con cero conversaciones.
