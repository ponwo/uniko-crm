---
name: foto-producto-026-pr28-pendiente
description: "Extensión de la 026 (foto del producto en check_stock, image_url de MS-Stock 004) — PR #28 con CI verde el 2026-09-13, pendiente de merge a main, deploy a uniko-lanco y verificación con FOTO-TEST por WhatsApp real"
metadata: 
  node_type: memory
  type: project
  originSessionId: 912de0a5-04d5-4de0-8769-809790cb7bf7
  modified: 2026-09-14T00:43:40.527Z
---

Estado 2026-09-13: la foto del producto (`image_url` que MS-Stock devuelve desde
su feature 004; contrato `uniko-integration.md` §4 "Foto del producto") está
implementada en la rama `026-foto-producto` → [PR #28](https://github.com/ponwo/uniko-crm/pull/28),
CI verde en `default` y `completo`, verificada en local (arnés 147/147 on, 112/112
off; Laboratorio 36/36). Sin variables ni migración nuevas. **No** está en `main`
(el merge lo bloquea el clasificador y es señal del dueño) ni desplegada.

Decisiones de diseño que no están en el contrato y conviene no reabrir:
- UN mensaje de imagen por link con el texto como pie; el mensaje se persiste
  `type: image` + `text: <pie>` + asset `payload.url` (sin archivo) para que el
  historial del agente y el transcript del Laboratorio conserven lo dicho.
- Límite de 5 s a Meta por la foto (`AbortSignal.timeout`); pie > 1024 ⇒ texto
  aparte y foto sin pie; `failed` tardío ⇒ `status.ts` manda el pie como texto
  una vez (monotónico).
- El stock-mock arma `image_url` con el origen de la petición (`/icon-192.png`);
  el wa-mock tiene `media-mode` (`ok | reject | slow`).

Pendiente al retomar (T048 en tasks.md): merge → deploy automático de
`uniko-lanco` → `/api/health` 10/10 (ver [[relevo-de-contenedor-en-coolify]]) →
por WhatsApp real "FOTO-TEST" ⇒ texto + imagen; producto sin foto ⇒ solo texto;
registrar en `quickstart.md` y marcar T048.

**Why:** el trabajo quedó a una señal del dueño; sin esta nota, otra sesión
podría rehacer la verificación local o dudar de si ya está desplegado.
**How to apply:** empezar por la PR #28 (rebase si `main` avanzó), no por el
código. Ver [[conector-inventario-consume-el-contrato-de-ms-stock]].
