---
name: plantillas-027-espejo-de-meta
description: "027 (plantillas): promovida a production en 0a5c0bd el 2026-09-15 (flota 3/3) — el sync importa las creadas en Meta y crear devuelve la causa; el error del dueño era el fallback no-JSON; Meta tarda >8 s en crear; uniko.lanco.cloud SÍ va por Cloudflare"
metadata:
  type: project
---

Estado 2026-09-15: PR #30 mergeado en `main` (`8df60b5`) tras CI verde,
ensayo del Principio X con el respaldo diario de LanCo (0015 en 1,1 s) y
revisión de código. Verificada en uniko-lanco desde el navegador del dueño: el
sync importó `hello_world` (lo único que había en el WABA: los intentos
anteriores nunca llegaron a Meta) y la creación de `test` respondió 201 —
**Meta tardó entre 8 y 38 s**, lo que explica el síntoma original con el código
viejo. El dueño lo confirmó el mismo día («funciona perfectamente»:
`seguimiento_a_cotizacion` creada desde Uniko y aprobada por Meta;
`prueba_de_plantilla` creada en el Administrador de WhatsApp e importada en
revisión). Promovida a `production` en `0a5c0bd` el mismo día por señal del dueño (push `main:production` ff, flota 3/3 con migraciones aplicadas).

Hallazgos que NO están en el código:

- **El error que vio el dueño** («No se pudo crear la plantilla», captura del
  2026-09-14) es el *fallback* del cliente: la respuesta no fue el JSON de error
  de la API (fetch rechazado o cuerpo no-JSON: 502 durante un relevo, 524 de
  Cloudflare…). No es un mensaje de Meta. Sonda sin efectos (POST con salto de
  numeración desde su sesión) → 422 JSON correcto: la ruta funciona de punta a
  punta; el fallo está en el tramo que llama a Meta o en el transporte. Por eso
  la 027 puso tope de 30 s a las llamadas de plantillas (503 con causa en vez
  de HTML del proxy) y la pantalla ahora muestra el código HTTP.
- **`uniko.lanco.cloud` está proxied por Cloudflare** (`server: cloudflare`,
  IPs 104.21/172.67), aunque `docs/despliegue-flota.md` diga que resuelve
  directo a `212.28.185.186`. Un origen lento (>100 s) da 524 HTML.
- El WABA de LanCo tenía 0 plantillas locales y "Todo al día": el sync viejo
  solo actualizaba filas existentes; el nuevo importa lo que haya en Meta.
- Meta devuelve `rejected_reason: "NONE"` en las no rechazadas: se guarda
  `null`, no "NONE".
- Postgres reordena las llaves de un `jsonb`: comparar `components` con
  `JSON.stringify` tal cual rompía la idempotencia del sync (`updated: 1`
  eterno); se compara con llaves ordenadas (`canon`).

**Why:** el diagnóstico costó una hora y el dueño pidió no crear plantillas
reales sin su permiso; la próxima sesión debe partir de aquí.
**How to apply:** antes de tocar plantillas, leer
`specs/027-plantillas-espejo-de-meta/quickstart.md` (registro de verificación)
y revisar el runbook de Cloudflare. Ver [[worktree-y-arneses-en-la-maquina-de-desarrollo]].
