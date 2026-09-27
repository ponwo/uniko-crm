# Propuesta de enmienda constitucional — La app de la agencia (1.7.0 → 1.8.0)

**Feature**: `029-google-por-link` · **Fecha**: 2026-09-27 · **Estado**: **PROPUESTA**,
pendiente de ratificación por el responsable del proyecto (Governance: "toda
enmienda se propone por escrito describiendo el cambio y su motivación, se aprueba
por el responsable del proyecto"). La PR de la 029 la aplica a
`.specify/memory/constitution.md` con su Sync Impact Report; **aprobar esa PR es
ratificarla**. Sin ratificación, la 029 no entra a `main`.

## Qué se propone cambiar

**Principio II — Soberanía / Self-Hosted (ENDURECIDO)**, condición 4 de los
conectores opcionales. Hoy dice:

> 4. **Credenciales del propio negocio, cifradas en reposo** (Principio I): cada
>    instancia habla con SU cuenta del proveedor; jamás credenciales de una
>    plataforma central.

Se propone:

> 4. **Credenciales del negocio, cifradas en reposo** (Principio I): cada instancia
>    habla con SU cuenta del proveedor; jamás credenciales de una plataforma central
>    **compartidas entre negocios**. La identidad de la app puede ser del operador de
>    la flota —el **modelo agencia** de ADR-004— únicamente si se cumplen TODAS:
>    1. cada negocio tiene su **propio** cliente y secreto dentro de esa app; ningún
>       secreto se comparte entre instancias;
>    2. el **permiso** (token) es del negocio, se obtiene con su consentimiento
>       explícito y vive **solo** en su instancia, cifrado;
>    3. ningún servicio central participa en **runtime**: a lo sumo en el alta, sin
>       guardar nada, y su caída solo detiene altas nuevas — nunca la operación de
>       las instancias ya conectadas;
>    4. el camino con credenciales propias del negocio (**BYO**) sigue disponible en
>       la misma instancia.

**Bump**: MINOR (1.7.0 → 1.8.0) — expansión material de una condición, con
condiciones propias. No redefine nada de forma incompatible: una instancia default
sigue necesitando exactamente lo mismo ("un VPS con Coolify o Docker, un dominio,
credenciales de Meta y (opcional) un token de OpenRouter. Nada más"), y ningún
conector ni spec existente deja de cumplir.

## Motivación

1. **El camino BYO no lo recorre ningún cliente de la flota.** Conectar Google
   Calendar por la 015 exige crear un proyecto en Google Cloud, configurar la
   pantalla de consentimiento, publicar la app, crear un cliente OAuth y sacar un
   refresh token con OAuth Playground. LanCo lo hizo para sí mismo el 2026-09-23;
   ninguno de sus clientes puede hacerlo solo. La agenda con Meet —el diferencial— se
   queda en LanCo.
2. **El patrón ya existe en el canal core.** El alta de WhatsApp de la flota se hace
   con la app de LanCo como proveedor tecnológico (Embedded Signup en `lanco.cloud`).
   Entra porque WhatsApp Cloud API es la dependencia permitida nº 1; el mismo patrón
   para un conector opcional no tenía por dónde entrar. La condición 4 se escribió
   (1.4.0, 015) pensando en el riesgo real —un secreto central que, filtrado, abre a
   todos, y un punto central del que dependa la operación—, no en quién registró la
   app.
3. **Las cuatro sub-condiciones conservan lo que el principio protege.** El dato del
   cliente vive en su servidor (el permiso solo en su instancia); no hay punto
   central de fallo en runtime; una fuga es un negocio, no la flota; y quien opere
   Uniko fuera de LanCo nunca necesita a LanCo (BYO sigue ahí). Es exactamente la
   línea que separa esta feature de sus alternativas descartadas: un cliente OAuth
   compartido viola la 1; n8n guardando tokens viola la 2; un intermediario en
   runtime viola la 3.

## Lo que NO cambia

- La lista cerrada de dependencias del núcleo y la prohibición de terceros como
  dependencia del núcleo.
- Las otras cuatro condiciones de los conectores opcionales.
- Los principios I, III a X.

## Propagación prevista (Sync Impact Report)

- `.specify/memory/constitution.md` — II.3.4 con el texto de arriba; versión 1.8.0;
  Sync Impact Report nuevo al principio del archivo.
- `CLAUDE.md` — el resumen del Principio II menciona el modelo agencia y ADR-004.
- `docs/agenda-conectores.md` — el recuadro de las cinco condiciones remite a la
  4 enmendada.
- Plantillas (`plan`, `spec`, `tasks`, `constitution`) — sin cambios: no hablan de
  credenciales de conectores.
