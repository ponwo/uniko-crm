---
name: foto-producto-026-pr28-pendiente
description: "Extensión de la 026 (foto del producto en check_stock, image_url de MS-Stock 004) — PR #28 mergeada y desplegada en uniko-lanco el 2026-09-14; falta solo la evidencia de FOTO-TEST por WhatsApp real (T048)"
metadata:
  type: project
---

Estado 2026-09-14: PR #28 **mergeada a `main`** (`2fa5714`) y **desplegada en
`uniko-lanco`** (Coolify, deployment `dgjadmxf86mwxsvdl0tycaji`, 01:27 UTC). Lo que
sigue sin constar es la verificación en vivo de T048 (por WhatsApp real "FOTO-TEST" ⇒
texto + imagen; producto sin foto ⇒ solo texto) y su registro en `quickstart.md`.

Decisiones de diseño que no están en el contrato y conviene no reabrir:
- UN mensaje de imagen por link con el texto como pie; el mensaje se persiste
  `type: image` + `text: <pie>` + asset `payload.url` (sin archivo).
- Límite de 5 s a Meta por la foto; pie > 1024 ⇒ texto aparte y foto sin pie;
  `failed` tardío ⇒ `status.ts` manda el pie como texto una vez.
- El stock-mock arma `image_url` con el origen de la petición (`/icon-192.png`);
  el wa-mock tiene `media-mode` (`ok | reject | slow`).

**Why:** sin esta nota otra sesión podría rehacer el merge/deploy o dudar de si ya
está en la instancia de pruebas.
**How to apply:** si el dueño confirma la foto por WhatsApp, marcar T048 y anotar la
evidencia; no promover a `production` sin su señal. Ver
[[conector-inventario-consume-el-contrato-de-ms-stock]] y [[tallas-026-pr29]].
