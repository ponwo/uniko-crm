# Quickstart — 028 Respuesta por talla y fotos por producto

Guía de **verificación en vivo** (Principio IX): con los mocks primero, contra MS-Stock
local después y contra la instancia de pruebas al final, con los cuatro modelos
reales. Contratos: [turno-check-stock.md](contracts/turno-check-stock.md) ·
[forma-exacta-delta.md](contracts/forma-exacta-delta.md) · MS-Stock:
[`uniko-integration.md`](../../../MS-Sotck/specs/003-sso-uniko/contracts/uniko-integration.md) §4.

## 0. Prerrequisitos

- Los de la 026 ([quickstart §0](../026-conector-inventario/quickstart.md)): Node 22
  (`eval "$(fnm env --shell bash)" && fnm use 22`), Postgres 16, `.env` con los mocks
  y el conector apuntando al stock-mock (`INVENTARIO=on`, `STOCK_BASE_URL=http://localhost:3000/api/dev/stock-mock`, …).
- **MS-Stock ya con el contrato §4 y el plural mergeados** (PR propio del repo hermano):
  es el orden que exige FR-1310.
- Windows: antes de relanzar `pnpm dev`, matar el anterior con `taskkill //F //PID <pid>
  //T` (o `//IM node.exe`); `pkill` no lo mata y el arnés le pegaría al viejo.

## 1. Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Tests nuevos/ampliados: `check-stock-turn` (conjunto, tope, dedupe, frases, un producto
idéntico), `stock-client` (`limit=25`), `inventario-prompt` (singular), `stock-mock`
(catálogo ampliado, plural), `wa-mock-media` (rechazo por link).

## 2. App viva y self-test automatizado

```bash
pnpm dev            # http://localhost:3000, con INVENTARIO=on
pnpm test:e2e       # scripts/e2e-selftest.mjs, sección "== 028: respuesta por talla y fotos =="
```

Lo que verifica la sección 028 (catálogo del stock-mock, [contrato §3](contracts/turno-check-stock.md)):

| Pregunta | Salientes esperados |
|---|---|
| "¿tienen playeras en G?" (plural) | `image` NEG con pie `Déjame revisar.\nPlayera negra (PLY-NEG): 7 pieza — $199 MXN` · `text` `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN` · `image` GRS con pie `Playera gris (PLA-GRS) talla G: 3 pieza — $250 MXN`; nada más; ningún texto contiene "agotad", "no viene" ni otra talla |
| "¿tienen playeras en M?" | `image` NEG · `image` VRD (`talla M: 10 pieza — $200 MXN`); roja (M 0), gris (M 0), azul y amarilla (sin M) ausentes |
| "¿tienen playeras en XCH?" / "… en extra chica" | `image` NEG · `image` AZL (`talla XCH: 1 pieza — $800 MXN`) |
| "¿tienen pantalones en 40?" | un solo `text`: `Déjame revisar.\nPor ahora no tengo pantalones en talla 40.` |
| "¿tienen pantalones en 32?" | `image` PAN-AZ (`talla 32: 4 pieza — $650 MXN`) · `text` PAN-NG (`talla 32: 1 pieza — $650 MXN`) |
| "¿tienen playeras?" (sin talla) | 5 mensajes (NEG img, ROJ txt, AZL img, VRD img, GRS img; blanca agotada ausente) + `text` `Hay más coincidencias, ¿me dices cuál te interesa?`; ≤ 5 `image` y sin `link` repetido |
| `media-mode {reject, link:"m=grs"}` + "¿tienen playeras en G?" | `image` NEG · `text` ROJ · `text` GRS (la línea, sin foto), en ese orden; `[agente] foto:` en el log; ningún mensaje `failed` en el hilo |
| Laboratorio (conversación de prueba) "¿tienen playeras en M?" | dos mensajes `image` persistidos con `media.payload.url` y el pie como `text`, sin tocar Graph |
| Casos 1–8 y 10–17 de la 026 | texto **idéntico** al esperado hoy; el caso 9 pasa a la regla nueva |

Con la bandera **apagada** (`INVENTARIO=` vacío, base desechable nueva): el arnés
completo pasa sin cambios (nada de esto existe).

## 3. Self-test manual en el Laboratorio

1. Laboratorio → conversación de prueba → "¿tienen playeras en G?": aparecen dos
   burbujas de imagen (negra, gris) con su pie y una de texto (roja) entre ellas, en
   ese orden; la frase de entrada solo en la primera.
2. "¿tienen playera roja en M?": una sola burbuja de texto con `agotada — … Con
   existencia: CH 4, G 7, XG 1` (regla de un producto, sin cambio).
3. Inbox: el hilo enseña las imágenes como `image` con la URL pública y el pie, marcadas
   IA, sin `failed`.

## 4. Contra MS-Stock real en local

MS-Stock local (`uv run uvicorn app.main:create_app --factory --port 8000` en el repo
hermano) con un catálogo réplica del real (`PLA-AZL`, `PLA-NGO`, `PLY-ROJ`, `PLA-VRD` con
foto vía el stub S3 o sin foto); `.env` de Uniko con `STOCK_BASE_URL=http://localhost:8000`
y su llave. Preguntar en el Laboratorio "¿tienen playeras en G?" → Negra y roja; "¿en
M?" → Negra y verde; "¿en XCH?" → solo roja; "¿en 24?" → `Por ahora no tengo playera en
talla 24.` (la consulta tal como la mandó el modelo: en singular por el prompt); "¿tienen playeras negras?" (plural doble) → Negra. Confirma D1 (plural) y D2
(forma) del contrato contra el servicio de verdad.

## 5. Despliegue e instancia de pruebas (SC-007)

1. PR → CI verde (`default` y `completo`) → merge a `main` = **señal del dueño** →
   Coolify despliega `uniko-lanco`; `GET /api/health` reporta el commit.
2. En WhatsApp (número de pruebas) o en el Laboratorio de `uniko.lanco.cloud`, contra
   `stock.lanco.cloud` con los cuatro modelos reales:
   - "¿tienen playeras en G?" → foto Negra + `Playera Negra (PLA-NGO) talla G: 8 pieza
     — $300 MXN`; foto roja + `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN`.
   - "¿en M?" → Negra (M 9) y verde (M 10) con foto; sin roja ni Azul.
   - "¿en XCH?" → solo la roja (XCH 2).
   - "¿tienen playeras en 24?" → `Por ahora no tengo playera en talla 24.` (sin fotos).
   - "¿tienen playera roja en M?" → `agotada — $219 MXN. Con existencia: XCH 2, CH 4, G
     7, XG 1` con foto (026 intacta).
3. Registrar aquí los resultados (mensajes recibidos, `ms`, log de `uniko-lanco` sin
   `[agente] inventario:` de error) y cerrar la T057 de la 026 con la misma evidencia.
4. **No promover a `production`**: eso es otra señal del dueño (puerta de promoción de
   la constitución).

## Criterio de "Hecho"

Gate verde · arnés verde en ambas configuraciones · §3 y §4 observados · SC-007 en la
instancia de pruebas con los cuatro modelos · derogaciones marcadas en la 026 ·
contrato §4 de MS-Stock actualizado antes del código · docs (`inventario-conector.md`,
`us-inventario.md`, README, CLAUDE.md) al día.

## Resultados del self-test local — 2026-09-16 (T036–T037)

- **Gate**: `pnpm typecheck`, `pnpm lint`, `pnpm build` limpios; `pnpm test` **744** (85
  archivos; nuevos: `deliver-replies` ×6, `wa-mock-media` ×3; `check-stock-turn` 28).
- **Arnés con `INVENTARIO=on`** (base `uniko_dev_028e`): **163/163**. Sección 028: G (plural)
  → negra img · roja txt · gris img; M → negra · verde; extra chica → negra · azul (XCH);
  pantalones en 40 → «Por ahora no tengo pantalones en talla 40.»; en 32 → azul img ·
  negro txt; hilo del Inbox con 3 salidas IA sin `failed`; rechazo por link de la gris
  → image · text · text; foto lenta de la verde → negra img + verde txt en 12.4 s. Caso 9
  reescrito: «¿tienen playera?» → 6 salientes (5 modelos con existencia, 4 fotos distintas,
  cierre «Hay más coincidencias…»), la blanca agotada ausente.
- **Arnés con la bandera vacía** (base `uniko_dev_028off`): **112/112**, sin cambios.
- **Contra MS-Stock real en local** (`uv run uvicorn … --port 8000` con el stub S3 de
  `tests/s3_stub.py` como R2, base `ms_stock_028` desechable, réplica de los 4 modelos
  con foto; Uniko con `STOCK_BASE_URL=http://localhost:8000`, base `uniko_dev_028ms2`,
  wa-mock + ai-mock): «¿tienen playeras en G?» → **Negra** (img, `talla G: 8 pieza —
  $300 MXN`) y **roja** (img, `talla G: 7 pieza — $219 MXN`); «en M» → Negra (M 9) y
  verde (M 10); «en XCH» → solo roja (2); «en 24» → «Por ahora no tengo playeras en
  talla 24.»; «playeras negras» (plural doble) → Negra sola con sus tallas (D1 del
  contrato, resuelto por MS-Stock); «playera roja en M» → `agotada — … Con existencia:
  XCH 2, CH 4, G 7, XG 1` (026 intacta); «playeras» → 4 imágenes, una por modelo;
  «playera roja en XXG» → `no viene en talla XXG. Tallas: …, 24 agotada`. Turnos de 6.8–11.6
  s (coalesce 6 s). Sin ninguna línea `[agente]` en el log.
- Gotchas del entorno (para no perder tiempo): (1) el arnés necesita base **nueva** por
  corrida (los leads y `wa_message_id` se repiten); (2) `next dev` compila cada ruta al
  primer uso: calentar `/api/inventario/status` y `POST /api/dev/ai-mock/v1/chat/
  completions` antes de correrlo, o el primer `check_stock` se sale del límite de 14 s;
  (3) `DELETE /api/dev/wa-mock/outbox` reinicia el contador de wamids del mock: sobre una
  base con mensajes persistidos, las imágenes nuevas chocan con
  `message_wa_message_id_unique` y salen como texto (falso rojo); (4) un `wa_message_id`
  repetido se descarta por idempotencia: un guion que se relanza debe generar los suyos.

## Resultados en la instancia de pruebas — 2026-09-17 (T039–T040, SC-007)

- PR #31 mergeada por el dueño el 2026-09-16 20:41 UTC (`4d3662f`); CI `default` y
  `completo` verdes en `8497ba5`. Coolify desplegó `uniko-lanco` a las 20:48 UTC
  (`[migrate] migraciones aplicadas`, `Ready in 1100ms`); `/api/health` **10/10** con
  `commit: 4d3662f`. Log del contenedor sin ninguna línea `[agente]` (el camino feliz
  no escribe).
- **WhatsApp real** (el dueño, 2026-09-17 10:29–10:35 hora local; capturas en el chat),
  contra los cuatro modelos reales de `stock.lanco.cloud`:
  - «tienes playeras talla grande» → **dos mensajes de imagen**: foto de la Negra con pie
    `Claro, déjame revisar qué playeras tenemos en talla grande, un momentito 😊` +
    `Playera Negra (PLA-NGO) talla G: 8 pieza — $300 MXN`; foto de la roja con pie
    `Playera roja (PLY-ROJ) talla G: 7 pieza — $219 MXN`. Azul y verde (sin G) no se
    mencionan. La equivalencia «grande» ⇒ G funcionó con el modelo real.
  - «y en talla m» → foto de la Negra (`talla M: 9 pieza — $300 MXN`, con la frase de
    entrada) y foto de la verde (`talla M: 10 pieza — $200 MXN`); la roja (M agotada) y
    la Azul (sin M) ausentes. **Observación**: en el teléfono la verde apareció (10:34)
    antes que la Negra (10:35) aunque el motor las manda en ese orden: Meta descarga
    cada imagen por URL y entrega cuando la tiene; la frase de entrada quedó en el
    segundo globo. Ver "Ajuste pendiente" abajo.
  - «y en rojo talla m» → un solo mensaje con foto: `Playera roja (PLY-ROJ) talla M:
    agotada — $219 MXN. Con existencia: XCH 2, CH 4, G 7, XG 1` (026 intacta).
  - Log de `ms-stock`: las tres consultas del agente (16:30:02, 16:34:50, 16:35:53 UTC)
    llegaron como `GET /v1/agent/products/PLAYERA` → 404 → `GET /v1/agent/search` 200
    (la palabra en singular, como pide el prompt; el primer intento como SKU es el
    comportamiento vigente de `lookup`) y `GET /v1/agent/search` 200 para «playera
    roja». Latencias 48–312 ms.
  - No ejercidos por WhatsApp (sí en el arnés y contra MS-Stock local): «en XCH» (solo la
    roja) y «en 24» (`Por ahora no tengo … en talla 24.`).
- **Cierra la T057 de la 026** con esta misma evidencia (modelo real con tallas
  respondido en la instancia de pruebas).
- **Ajuste pendiente (decisión del dueño, fuera de la 028)**: garantizar el orden de
  llegada de las fotos. Meta entrega cada imagen por URL cuando termina de
  descargarla, así que dos fotos enviadas seguidas pueden llegar invertidas y la frase
  de entrada aparecer en el segundo globo. Opciones: (a) esperar a que Meta reporte
  `sent` del mensaje anterior (webhook de estado, ya se procesa) con tope de ~2 s antes
  de mandar el siguiente; (b) una pausa fija corta (~1 s) entre imágenes — más simple,
  sin garantía. Ninguna cambia el contrato.
- **No se promueve a `production`** (puerta de promoción: señal explícita del dueño).

