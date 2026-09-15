---
name: foto-producto-026-pr28-pendiente
description: "Extensión de la 026 (foto del producto en check_stock, image_url de MS-Stock 004) — verificada por el dueño por WhatsApp real y PROMOVIDA a production en 8d91b78 el 2026-09-14 (flota 3/3, INVENTARIO apagada en clientes); decisiones de diseño fuera del contrato"
metadata:
  type: project
---

Estado 2026-09-14: PR #28 **mergeada a `main`** (`2fa5714`) y **desplegada en
`uniko-lanco`** (Coolify, deployment `dgjadmxf86mwxsvdl0tycaji`, 01:27 UTC); después
entró la PR #29 (tallas, `3c38120`), que es lo que corre. **T048 cerrada**: el dueño
pidió "FOTO-TEST" por WhatsApp real y **llegó la foto** (texto + imagen en el mismo
turno); el log del contenedor no tiene líneas `[agente] inventario:` ni
`[agente] foto:` (el camino feliz no escribe; la degradación sí). Registrado en
`quickstart.md`. **Promovida a `production` el 2026-09-14** (`8d91b78`, toda la 026 con
foto y tallas; `verify-fleet.sh` 3/3, 10/10 por instancia); `INVENTARIO` sigue
apagada en `uniko-iltu` y `uniko-nuriaandrea` (ni la bandera ni `STOCK_*` existen
en su Coolify) — para ellos no cambió nada.

Decisiones de diseño que no están en el contrato y conviene no reabrir:
- UN mensaje de imagen por link con el texto como pie; el mensaje se persiste
  `type: image` + `text: <pie>` + asset `payload.url` (sin archivo).
- Límite de 5 s a Meta por la foto; pie > 1024 ⇒ texto aparte y foto sin pie;
  `failed` tardío ⇒ `status.ts` manda el pie como texto una vez.
- El stock-mock arma `image_url` con el origen de la petición (`/icon-192.png`);
  el wa-mock tiene `media-mode` (`ok | reject | slow`).

**Why:** tres sesiones tocaron esto (implementación, deploy, cierre); sin la nota,
otra podría rehacer la verificación o dudar de si ya está en la instancia de pruebas.
**How to apply:** al tocar la foto, leer primero estas decisiones y el contrato; para
diagnosticar en vivo, buscar `[agente] foto:` en el log del contenedor (solo aparece
al degradar). Ya está en `production`; encender `INVENTARIO` en un cliente exige antes cargar
sus tres `STOCK_*` (si falta una, `/api/health` da 503). Ver
[[conector-inventario-consume-el-contrato-de-ms-stock]] y [[tallas-026-pr29]].
