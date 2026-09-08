# Specification Quality Checklist: 020 — Notificaciones push cuando el agente escala

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notas de la validación

Tres observaciones honestas sobre esta spec, para que quien la lea sepa dónde
aprieta:

1. **Nombra `applyHandoff()` y `src/lib/crypto`** en "Lo que encontramos en el
   código". Es detalle de implementación, y aparece a propósito: la sección
   existe para que el plan confirme o desmienta esos hallazgos, y es la
   convención de las specs 018 y 019 de este repo. El resto del documento
   describe comportamiento observable.

2. **No quedan marcadores de clarificación**, porque las cuatro decisiones que lo
   habrían sido —cuándo se avisa, a quién, qué pasa si nadie atiende, y si el
   aviso lleva contenido— las tomó el dueño antes de escribirla, y están en la
   spec con su razón.

3. **Un criterio depende de una incógnita externa** (SC de la agrupación en iOS):
   la spec está escrita para funcionar **con y sin** reemplazo de notificaciones,
   así que la incógnita no bloquea nada. El nivel 3 la resuelve y la registra.

## Lo que esta spec activa y conviene no olvidar

- **Hay migración** → el ensayo del Principio X es obligatorio antes de `main`, y
  la puerta de promoción lo va a exigir. Es la primera feature desde la 016 que
  lo activa.
- **Entra un tercero en runtime** → el ADR-003 ya está aceptado; el plan no
  reabre esa discusión.
